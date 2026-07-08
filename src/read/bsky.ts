/**
 * Public Bluesky reads via the unauthenticated AppView. rolld reuses
 * Bluesky's existing profile data (D-28) — a public profile page is just a
 * different lens on `app.bsky.actor.profile` plus rolld records, with zero new
 * profile data to store. The follows graph drives the friends-feed (D-26), and a
 * shared entry's Bluesky reply thread becomes its comments, read-only (D-40 move 5)
 * — "comments without building comments".
 */
import './../atproto/register.js';
import { Client, ok, simpleFetchHandler } from '@atcute/client';
import type { ActorIdentifier, ResourceUri } from '@atcute/lexicons/syntax';
import { APPVIEW_API, TYPEAHEAD_API } from '../config.js';

export function appviewClient(base: string = APPVIEW_API): Client {
  return new Client({ handler: simpleFetchHandler({ service: base }) });
}

/** A candidate co-player surfaced by the handle typeahead (D-56). */
export interface ActorSuggestion {
  did: string;
  handle: string;
  displayName?: string;
  avatar?: string;
}

/** One `searchActorsTypeahead` call, mapped to suggestions; [] on any failure. */
async function typeaheadOnce(client: Client, q: string, limit: number): Promise<ActorSuggestion[]> {
  try {
    const data = await ok(
      client.get('app.bsky.actor.searchActorsTypeahead', { params: { q, limit } }),
    );
    return data.actors.map((a) => ({
      did: a.did,
      handle: a.handle,
      ...(a.displayName ? { displayName: a.displayName } : {}),
      ...(a.avatar ? { avatar: a.avatar } : {}),
    }));
  } catch {
    return [];
  }
}

/**
 * Handle typeahead for tagging co-players (D-56). Queries two sources and merges
 * them by DID:
 *
 * - the AppView (`APPVIEW_API`), whose index tracks handle renames, so it returns
 *   the *current* handle and display name; and
 * - typeahead.waow.tech, which covers the *whole* network, not just one platform's
 *   curated list — so a co-player on any PDS can still be found.
 *
 * When the same account (DID) comes back from both, the AppView's record wins and
 * is listed first: it's the fresher one, which is what fixes a rename showing the
 * old handle (an account renamed from `x.pds.example` to `x.example` was surfacing
 * as the dead old handle). Accounts only the network-wide index knows are kept
 * after it. Best-effort throughout: if either source is down the other still
 * answers, and if both fail the name field is just free text (D-15).
 */
export async function searchActors(
  q: string,
  opts: { limit?: number; freshClient?: Client; networkClient?: Client } = {},
): Promise<ActorSuggestion[]> {
  const query = q.trim();
  if (!query) return [];
  const limit = opts.limit ?? 6;
  const fresh = opts.freshClient ?? appviewClient(APPVIEW_API);
  const network = opts.networkClient ?? appviewClient(TYPEAHEAD_API);
  const [freshRes, networkRes] = await Promise.all([
    typeaheadOnce(fresh, query, limit),
    typeaheadOnce(network, query, limit),
  ]);
  // Fresh first, so its up-to-date handle wins for any DID in both lists.
  const seen = new Set<string>();
  const merged: ActorSuggestion[] = [];
  for (const a of [...freshRes, ...networkRes]) {
    if (seen.has(a.did)) continue;
    seen.add(a.did);
    merged.push(a);
  }
  return merged.slice(0, limit);
}

export interface BskyProfile {
  did: string;
  handle: string;
  displayName?: string;
  avatar?: string;
  description?: string;
  banner?: string;
}

/** The bio chrome for a profile page (D-28). Null if the actor can't be fetched. */
export async function getProfile(client: Client, actor: string): Promise<BskyProfile | null> {
  try {
    const data = await ok(
      client.get('app.bsky.actor.getProfile', { params: { actor: actor as ActorIdentifier } }),
    );
    return {
      did: data.did,
      handle: data.handle,
      ...(data.displayName ? { displayName: data.displayName } : {}),
      ...(data.avatar ? { avatar: data.avatar } : {}),
      ...(data.description ? { description: data.description } : {}),
      ...(data.banner ? { banner: data.banner } : {}),
    };
  } catch {
    return null;
  }
}

/**
 * Batch profile hydration — `app.bsky.actor.getProfiles` takes up to 25 actors per
 * call, so a feed of N authors costs ceil(N/25) requests instead of N. Chunks run
 * concurrently; a failed chunk degrades to "no profile for those dids" (the feed
 * card falls back to the bare DID) rather than failing the whole feed.
 */
export async function getProfiles(client: Client, actors: string[]): Promise<BskyProfile[]> {
  const unique = [...new Set(actors)];
  const chunks: string[][] = [];
  for (let i = 0; i < unique.length; i += 25) chunks.push(unique.slice(i, i + 25));
  const pages = await Promise.all(
    chunks.map(async (chunk) => {
      try {
        const data = await ok(
          client.get('app.bsky.actor.getProfiles', {
            params: { actors: chunk as ActorIdentifier[] },
          }),
        );
        return data.profiles;
      } catch {
        return [];
      }
    }),
  );
  return pages.flat().map((data) => ({
    did: data.did,
    handle: data.handle,
    ...(data.displayName ? { displayName: data.displayName } : {}),
    ...(data.avatar ? { avatar: data.avatar } : {}),
    ...(data.description ? { description: data.description } : {}),
    ...(data.banner ? { banner: data.banner } : {}),
  }));
}

export interface FollowActor {
  did: string;
  handle: string;
  displayName?: string;
  avatar?: string;
}

/** A page of the actor's follows (D-26 step 1). */
export async function getFollows(
  client: Client,
  actor: string,
  opts: { limit?: number; cursor?: string } = {},
): Promise<{ follows: FollowActor[]; cursor?: string }> {
  const data = await ok(
    client.get('app.bsky.graph.getFollows', {
      params: {
        actor: actor as ActorIdentifier,
        limit: opts.limit ?? 100,
        ...(opts.cursor ? { cursor: opts.cursor } : {}),
      },
    }),
  );
  return {
    follows: data.follows.map((f) => ({
      did: f.did,
      handle: f.handle,
      ...(f.displayName ? { displayName: f.displayName } : {}),
      ...(f.avatar ? { avatar: f.avatar } : {}),
    })),
    ...(data.cursor ? { cursor: data.cursor } : {}),
  };
}

export interface ThreadComment {
  uri: string;
  authorHandle: string;
  authorDisplayName?: string;
  authorAvatar?: string;
  text: string;
  createdAt: string;
}

export interface CommentThread {
  comments: ThreadComment[];
  likeCount: number;
  replyCount: number;
}

/**
 * The companion post's reply thread, flattened to a read-only comment list
 * (D-40 move 5). Returns null if the post isn't reachable. Only top-level replies
 * are surfaced in v1 (a "reply on Bluesky" link sends discussion there).
 */
export async function getCommentThread(client: Client, postUri: string): Promise<CommentThread | null> {
  try {
    const data = await ok(
      client.get('app.bsky.feed.getPostThread', {
        params: { uri: postUri as ResourceUri, depth: 1 },
      }),
    );
    const thread = data.thread as {
      post?: { likeCount?: number; replyCount?: number };
      replies?: {
        post?: {
          uri: string;
          author: { handle: string; displayName?: string; avatar?: string };
          record: { text?: string; createdAt?: string };
        };
      }[];
    };
    const comments: ThreadComment[] = [];
    for (const reply of thread.replies ?? []) {
      const post = reply.post;
      if (!post) continue;
      comments.push({
        uri: post.uri,
        authorHandle: post.author.handle,
        ...(post.author.displayName ? { authorDisplayName: post.author.displayName } : {}),
        ...(post.author.avatar ? { authorAvatar: post.author.avatar } : {}),
        text: post.record.text ?? '',
        createdAt: post.record.createdAt ?? '',
      });
    }
    return {
      comments,
      likeCount: thread.post?.likeCount ?? 0,
      replyCount: thread.post?.replyCount ?? 0,
    };
  } catch {
    return null;
  }
}
