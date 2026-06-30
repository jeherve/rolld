/**
 * The friends-feed merge (D-26). Constellation can't do "recent across users"
 * (D-2), so the feed is assembled client-side: the user's own plays woven together
 * with recent plays from their rolld-using follows (D-24). This module owns the
 * pure merge/sort/dedupe — the part worth testing hard. The network assembly
 * (resolve follows, filter by the profile declaration, list each PDS) is the glue
 * in `friends.ts`.
 *
 * Because the user's own plays are always in the merge, a new user with no playing
 * follows still sees their own activity — and an empty feed becomes the onboarding
 * invitation (D-27), no separate empty screen needed.
 */
import type { PlayRecord } from '../records/types.js';

export interface FeedItem {
  /** at://<did>/<collection>/<rkey> — the record's true identity and dedupe key. */
  uri: string;
  authorDid: string;
  rkey: string;
  play: PlayRecord;
  /** True for the signed-in user's own plays (woven into the same feed, D-24). */
  isOwn?: boolean;
}

export type FeedSortKey = 'playedAt' | 'createdAt';

/**
 * The sort timestamp for an item, defended against malformed records. Plays arrive
 * from *other users' PDSes* (`repo.ts` casts them with no runtime check), so a
 * follow could publish — directly, bypassing our write-path validation — a play
 * with a missing or non-string `playedAt`. We fall back to `createdAt`, then to an
 * empty string, so a single bad record can never throw and break the whole feed
 * (the module's contract: per-follow failures degrade, they don't break the feed).
 */
function sortKey(item: FeedItem, by: FeedSortKey): string {
  const value = item.play[by] ?? item.play.createdAt;
  return typeof value === 'string' ? value : '';
}

/**
 * Merge any number of feed-item lists into one reverse-chronological feed,
 * de-duplicated by uri (a play could arrive from both the own-list and a follow's
 * list, or twice from a live prepend). Sort key defaults to `playedAt` — the feed
 * is "what your circle recently *played*" — with `createdAt` then uri as stable
 * tie-breakers.
 */
export function mergeFeed(lists: FeedItem[][], by: FeedSortKey = 'playedAt'): FeedItem[] {
  const seen = new Map<string, FeedItem>();
  for (const list of lists) {
    for (const item of list) {
      // First occurrence wins, but prefer one flagged isOwn (keeps your own marker).
      const existing = seen.get(item.uri);
      if (!existing) seen.set(item.uri, item);
      else if (item.isOwn && !existing.isOwn) seen.set(item.uri, item);
    }
  }
  return [...seen.values()].sort(
    (a, b) =>
      sortKey(b, by).localeCompare(sortKey(a, by)) ||
      sortKey(b, 'createdAt').localeCompare(sortKey(a, 'createdAt')) ||
      b.uri.localeCompare(a.uri),
  );
}

/** Prepend a live-arriving item (Spacedust) to an existing feed, de-duping. */
export function prependLive(feed: FeedItem[], item: FeedItem, by: FeedSortKey = 'playedAt'): FeedItem[] {
  if (feed.some((f) => f.uri === item.uri)) return feed;
  return mergeFeed([[item], feed], by);
}
