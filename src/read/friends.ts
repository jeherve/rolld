/**
 * The friends-feed assembly (D-26) — the serverless version of a social feed.
 * Constellation can't do "recent across users" (D-2), so we build it client-side:
 *   1. read the user's Bluesky follows;
 *   2. keep only those with a rolld `profile` record (D-25) — the cheap declaration
 *      filter that avoids probing every follow's repo blindly;
 *   3. list each one's recent plays (Slingshot resolves identity + PDS; enumeration
 *      hits the PDS, D-23);
 *   4. merge with the user's own plays (the pure, tested `mergeFeed`).
 *
 * The follow set is CAPPED (D-26) to bound cost; per-follow failures degrade to
 * "skip that follow", never break the feed. Spacedust live prepend is layered on
 * top later (the enhancement, added last).
 */
import { Client } from '@atcute/client';
import { COLLECTION, PROFILE_RKEY } from '../config.js';
import type { PlayRecord, ProfileRecord } from '../records/types.js';
import { appviewClient, getFollows } from './bsky.js';
import { mergeFeed, type FeedItem } from './feed.js';
import { resolveMiniDoc, type IdentityOptions } from './identity.js';
import { getRecordValue, listPlays, pdsClient, type RepoRecord } from './repo.js';

/** Map a repo's play records to feed items for one author (pure — unit-tested). */
export function playsToFeedItems(
  authorDid: string,
  records: RepoRecord<PlayRecord>[],
  isOwn: boolean,
): FeedItem[] {
  return records.map((r) => ({
    uri: r.uri,
    authorDid,
    rkey: r.rkey,
    play: r.value,
    isOwn,
  }));
}

export interface FriendsFeedOptions {
  /** How many follows to fetch + check eagerly before paginating (D-26 cap). */
  followCap?: number;
  /** How many recent plays to pull per follow. */
  playsPerFollow?: number;
  /** How many of the user's own plays to weave in. */
  ownLimit?: number;
  appview?: Client;
  identityOpts?: IdentityOptions;
  signal?: AbortSignal;
}

/**
 * Assemble the dashboard feed for the signed-in user. `myPds` comes from the user's
 * own MiniDoc (or their authed session). Returns a merged, reverse-chronological
 * feed; the user's own plays are always present (so a new user still sees activity,
 * D-27).
 */
export async function buildFriendsFeed(
  myDid: string,
  myPds: string,
  opts: FriendsFeedOptions = {},
): Promise<FeedItem[]> {
  const followCap = opts.followCap ?? 50;
  const playsPerFollow = opts.playsPerFollow ?? 10;
  const appview = opts.appview ?? appviewClient();
  const identityOpts = opts.identityOpts ?? {};

  // 1. Own plays.
  let own: FeedItem[] = [];
  try {
    const mine = await listPlays(pdsClient(myPds), myDid, { limit: opts.ownLimit ?? 50 });
    own = playsToFeedItems(myDid, mine.records, true);
  } catch {
    own = [];
  }

  // 2. Follows (capped).
  let follows: { did: string }[] = [];
  try {
    follows = (await getFollows(appview, myDid, { limit: followCap })).follows;
  } catch {
    follows = [];
  }

  // 3. Per follow: resolve PDS, require the rolld declaration, list recent plays.
  const lists = await Promise.all(
    follows.slice(0, followCap).map(async (f): Promise<FeedItem[]> => {
      try {
        const doc = await resolveMiniDoc(f.did, identityOpts);
        if (!doc) return [];
        const client = pdsClient(doc.pds);
        const profile = await getRecordValue<ProfileRecord>(
          client,
          f.did,
          COLLECTION.profile,
          PROFILE_RKEY,
        );
        if (!profile) return []; // not a rolld user — skip (the D-25 filter)
        const plays = await listPlays(client, f.did, { limit: playsPerFollow });
        return playsToFeedItems(f.did, plays.records, false);
      } catch {
        return [];
      }
    }),
  );

  // 4. Merge.
  return mergeFeed([own, ...lists]);
}
