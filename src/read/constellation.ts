/**
 * Constellation reads (D-1). Per-game social/aggregate questions are
 * answered by querying the public Constellation backlink index for records that
 * link to a game's canonical `target` URL — NOT by running our own indexer. "All
 * plays of game X" is "all records linking to `rolld.at/g/<bggId>`".
 *
 * The link field is `target` and the Constellation path is `.target` (leading dot,
 * derived from `CONSTELLATION_PATH` so the read side always matches the frozen
 * string the write side wrote). The query builders are pure (unit-tested); fetching
 * is injectable so tests mock the network at the boundary.
 */
import { CONSTELLATION_BASE, COLLECTION } from '../config.js';
import { CONSTELLATION_PATH } from '../links.js';

export interface BacklinkQuery {
  target: string;
  collection: string;
  /** json-path to the link field; defaults to `.target`. */
  path?: string;
  /** Restrict to specific linking DIDs (repeatable) — "my"/"friends'" filters. */
  dids?: string[];
  limit?: number;
  cursor?: string;
}

/** A single backlink record, as Constellation returns it. */
export interface LinkingRecord {
  did: string;
  collection: string;
  rkey: string;
}

export interface BacklinkPage {
  total: number;
  records: LinkingRecord[];
  cursor?: string;
}

export interface ConstellationOptions {
  fetchImpl?: typeof fetch;
  baseUrl?: string;
  signal?: AbortSignal;
}

/** Build a Constellation query URL. Pure — the dids array maps to repeated `did=`. */
export function buildQueryUrl(base: string, endpoint: string, q: BacklinkQuery): string {
  const params = new URLSearchParams();
  params.set('target', q.target);
  params.set('collection', q.collection);
  params.set('path', q.path ?? CONSTELLATION_PATH);
  if (q.limit !== undefined) params.set('limit', String(q.limit));
  if (q.cursor) params.set('cursor', q.cursor);
  // URLSearchParams encodes the target; append repeatable did= last.
  let url = `${base}${endpoint}?${params.toString()}`;
  for (const did of q.dids ?? []) url += `&did=${encodeURIComponent(did)}`;
  return url;
}

/** Reconstruct the at-uri of a backlink record. */
export function linkingRecordUri(r: LinkingRecord): string {
  return `at://${r.did}/${r.collection}/${r.rkey}`;
}

async function getJson<T>(url: string, opts: ConstellationOptions): Promise<T> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const res = await fetchImpl(url, { signal: opts.signal ?? null, headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Constellation ${res.status}`);
  return (await res.json()) as T;
}

const base = (opts: ConstellationOptions): string => opts.baseUrl ?? CONSTELLATION_BASE;

/** Count backlinks to a target from a collection (optionally DID-filtered). → total plays / my plays. */
export async function countBacklinks(
  q: BacklinkQuery,
  opts: ConstellationOptions = {},
): Promise<number> {
  const url = buildQueryUrl(base(opts), '/links/count', q);
  const data = await getJson<{ total: number }>(url, opts);
  return data.total;
}

/** Count distinct DIDs that link to a target. → distinct players of a game. */
export async function countDistinctDids(
  q: BacklinkQuery,
  opts: ConstellationOptions = {},
): Promise<number> {
  const url = buildQueryUrl(base(opts), '/links/count/distinct-dids', q);
  const data = await getJson<{ total: number }>(url, opts);
  return data.total;
}

/** List backlink records to a target (paginated). → the play/rating records of a game. */
export async function listBacklinks(
  q: BacklinkQuery,
  opts: ConstellationOptions = {},
): Promise<BacklinkPage> {
  const url = buildQueryUrl(base(opts), '/links', q);
  const data = await getJson<{ total: number; linking_records?: LinkingRecord[]; cursor?: string }>(
    url,
    opts,
  );
  return {
    total: data.total,
    records: data.linking_records ?? [],
    ...(data.cursor ? { cursor: data.cursor } : {}),
  };
}

/* ---- rolld-specific convenience reads (the four numbers the game page shows) ---- */

/** Total plays of a game across all of rolld (a single backlink count). */
export const gameTotalPlays = (target: string, opts?: ConstellationOptions): Promise<number> =>
  countBacklinks({ target, collection: COLLECTION.play }, opts);

/** My (or anyone's) play count for a game — the same count, DID-filtered. */
export const playCountByDids = (
  target: string,
  dids: string[],
  opts?: ConstellationOptions,
): Promise<number> => countBacklinks({ target, collection: COLLECTION.play, dids }, opts);

/** Distinct players of a game across rolld. */
export const gameDistinctPlayers = (target: string, opts?: ConstellationOptions): Promise<number> =>
  countDistinctDids({ target, collection: COLLECTION.play }, opts);

/** The play records of a game (optionally restricted to followed DIDs). */
export const gamePlays = (
  target: string,
  q: { dids?: string[]; limit?: number; cursor?: string } = {},
  opts?: ConstellationOptions,
): Promise<BacklinkPage> =>
  listBacklinks({ target, collection: COLLECTION.play, ...q }, opts);

/** The rating records of a game — symmetric with plays since rating carries the same target (D-39). */
export const gameRatings = (
  target: string,
  q: { dids?: string[]; limit?: number; cursor?: string } = {},
  opts?: ConstellationOptions,
): Promise<BacklinkPage> =>
  listBacklinks({ target, collection: COLLECTION.rating, ...q }, opts);
