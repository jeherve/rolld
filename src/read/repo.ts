/**
 * Repo reads. "My data" — my plays, my ratings — comes straight from the
 * user's OWN PDS via `listRecords`, no Constellation and no server (which is why
 * the personal dashboard keeps working even when Constellation is down). The same
 * `listRecords` reads any *public* repo for profile/play-log pages — Slingshot has
 * no list endpoint (D-23/D-26), so enumeration always hits the resolved PDS.
 *
 * A read-only public `Client` is built with `simpleFetchHandler` pointed at the
 * target PDS (from the MiniDoc); the signed-in user's own reads reuse their authed
 * agent's `Client`.
 */
import './../atproto/register.js';
import { Client, ok, simpleFetchHandler } from '@atcute/client';
import type { ActorIdentifier, Nsid } from '@atcute/lexicons/syntax';
import { COLLECTION } from '../config.js';
import type { PlayRecord, RatingRecord } from '../records/types.js';

/** A typed record as listed from a repo. */
export interface RepoRecord<T> {
  uri: string;
  cid: string;
  rkey: string;
  value: T;
}

export interface ListPage<T> {
  records: RepoRecord<T>[];
  cursor?: string;
}

/** A read-only client against a specific PDS (for public reads). */
export function pdsClient(pdsUrl: string): Client {
  return new Client({ handler: simpleFetchHandler({ service: pdsUrl }) });
}

const rkeyOf = (uri: string): string => uri.slice(uri.lastIndexOf('/') + 1);

/** Play and rating records both require a `game` snapshot the read/render path derefs. */
const isGameBearing = (collection: string): boolean =>
  collection === COLLECTION.play || collection === COLLECTION.rating;

/**
 * Does a value carry a usable `at.rolld.defs#gameRef` snapshot? Records listed/read
 * from a foreign PDS are cast `as T` here with no lexicon re-validation (see the
 * module header), so a malicious or broken writer can omit the lexicon-required
 * `game` object. Every downstream `play.game.id` / `play.game.name` would then throw
 * a `TypeError` and take down a whole feed or page region (CWE-476). We keep only
 * records whose `game` is an object with string `id` and `name` and drop the rest at
 * this read boundary — one bad record degrades to a skipped card, mirroring the
 * other defensive read guards (`asTime`, `playPhotos`, `posInt`).
 */
function hasGameRef(value: unknown): boolean {
  const game = (value as { game?: { id?: unknown; name?: unknown } } | null | undefined)?.game;
  return typeof game?.id === 'string' && typeof game?.name === 'string';
}

/** Generic `listRecords` against a repo, mapped to typed `RepoRecord`s. */
export async function listRecords<T>(
  client: Client,
  repo: string,
  collection: string,
  opts: { limit?: number; cursor?: string; signal?: AbortSignal } = {},
): Promise<ListPage<T>> {
  const data = await ok(
    client.get('com.atproto.repo.listRecords', {
      params: {
        repo: repo as ActorIdentifier,
        collection: collection as Nsid,
        ...(opts.limit ? { limit: opts.limit } : {}),
        ...(opts.cursor ? { cursor: opts.cursor } : {}),
      },
      ...(opts.signal ? { signal: opts.signal } : {}),
    }),
  );
  const records = data.records.map((r) => ({
    uri: r.uri,
    cid: r.cid,
    rkey: rkeyOf(r.uri),
    value: r.value as T,
  }));
  return {
    // Drop foreign play/rating records that lack a valid `game` before any caller
    // dereferences `game.id`/`game.name` (see `hasGameRef`). Non-game collections
    // (e.g. `at.rolld.profile`, rpg.actor stats) pass through untouched.
    records: isGameBearing(collection) ? records.filter((r) => hasGameRef(r.value)) : records,
    ...(data.cursor ? { cursor: data.cursor } : {}),
  };
}

/** List a repo's plays (most PDSes return TID-keyed records newest-last; sort on read). */
export const listPlays = (
  client: Client,
  repo: string,
  opts?: { limit?: number; cursor?: string; signal?: AbortSignal },
): Promise<ListPage<PlayRecord>> => listRecords<PlayRecord>(client, repo, COLLECTION.play, opts);

export const listRatings = (
  client: Client,
  repo: string,
  opts?: { limit?: number; cursor?: string; signal?: AbortSignal },
): Promise<ListPage<RatingRecord>> => listRecords<RatingRecord>(client, repo, COLLECTION.rating, opts);

/**
 * List a whole collection, following the cursor until the repo is exhausted. Stats
 * and full-log views need every record — a single `listRecords` page silently caps
 * a prolific user (a PDS page is ~100), so those callers use this, not `listRecords`.
 * `max` bounds a misbehaving PDS that never drops the cursor.
 */
export async function listAllRecords<T>(
  client: Client,
  repo: string,
  collection: string,
  opts: { pageLimit?: number; max?: number; signal?: AbortSignal } = {},
): Promise<RepoRecord<T>[]> {
  const pageLimit = opts.pageLimit ?? 100;
  const max = opts.max ?? 5000;
  const out: RepoRecord<T>[] = [];
  let cursor: string | undefined;
  do {
    const page = await listRecords<T>(client, repo, collection, {
      limit: pageLimit,
      ...(cursor ? { cursor } : {}),
      ...(opts.signal ? { signal: opts.signal } : {}),
    });
    out.push(...page.records);
    // A page with no records ends the walk even if the PDS still hands back a cursor.
    cursor = page.records.length > 0 ? page.cursor : undefined;
  } while (cursor && out.length < max);
  return out;
}

export const listAllPlays = (
  client: Client,
  repo: string,
  opts?: { pageLimit?: number; max?: number; signal?: AbortSignal },
): Promise<RepoRecord<PlayRecord>[]> => listAllRecords<PlayRecord>(client, repo, COLLECTION.play, opts);

export const listAllRatings = (
  client: Client,
  repo: string,
  opts?: { pageLimit?: number; max?: number; signal?: AbortSignal },
): Promise<RepoRecord<RatingRecord>[]> =>
  listAllRecords<RatingRecord>(client, repo, COLLECTION.rating, opts);

/** Read one record's value from a repo (e.g. a single entry permalink), or null. */
export async function getRecordValue<T>(
  client: Client,
  repo: string,
  collection: string,
  rkey: string,
): Promise<T | null> {
  try {
    const data = await ok(
      client.get('com.atproto.repo.getRecord', {
        params: { repo: repo as ActorIdentifier, collection: collection as Nsid, rkey },
      }),
    );
    const value = data.value as T;
    // A foreign play/rating record missing its `game` snapshot would crash every
    // render path that derefs it (entry permalink, live-tail card); treat it as
    // "not available" rather than let the `TypeError` bubble up (see `hasGameRef`).
    if (isGameBearing(collection) && !hasGameRef(value)) return null;
    return value;
  } catch {
    return null;
  }
}
