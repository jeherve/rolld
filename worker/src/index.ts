/**
 * The rolld Worker — the only server-side component in all of rolld (D-3).
 *
 * It is the sole gateway to BoardGameGeek (D-31): it holds the `BGG_TOKEN` secret,
 * injects the `Authorization: Bearer` header server-side, and caches results in KV
 * so BGG is touched only on the first-ever sight of a game across the whole
 * instance. The browser calls this Worker; it never calls BGG and never sees the
 * token.
 *
 * Phase 1 routes (this file): game metadata, batch hydrate, and game search.
 * Phase 3 extends it with the per-user RSS feed (D-42), Constellation response
 * caching, and the moderation blocklist enforcement (D-41) — all consistent with
 * the Worker's "stateless code, KV holds the tiny state" shape.
 */
import { parseSearch, parseThing, parseThings } from '../../src/bgg/parse.js';
import type { GameMetadata, SearchCandidate } from '../../src/bgg/types.js';
import { BggError, fetchSearchXml, fetchThingXml } from './bgg.js';
import { corsHeaders, errorJson, json } from './http.js';

/**
 * Minimal structural view of the KV binding (the slice the Worker uses). Declaring
 * it locally — instead of the global `KVNamespace` — keeps the handler unit-testable
 * from the main suite with an in-memory fake, and is structurally satisfied by the
 * real Cloudflare KV namespace at the binding site.
 */
export interface KvStore {
  get<T = unknown>(key: string, type: 'json'): Promise<T | null>;
  get(key: string, type?: 'text'): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

export interface Env {
  /** BGG bearer token — a Worker secret, read server-side only (D-31). */
  BGG_TOKEN: string;
  /** KV cache: `bgg:<id>` (permanent metadata) + `search:<q>` (short-TTL queries). */
  BGG_CACHE: KvStore;
}

/** Board game metadata is effectively immutable, so the game cache has no expiry. */
const SEARCH_TTL_SECONDS = 60 * 60; // search queries change slowly; cache an hour.
const MAX_BATCH = 20; // BGG caps a `thing` call at 20 ids (D-31).

const gameKey = (id: string): string => `bgg:${id}`;
const searchKey = (q: string): string => `search:${q.trim().toLowerCase()}`;

async function readGameCache(env: Env, id: string): Promise<GameMetadata | null> {
  return await env.BGG_CACHE.get<GameMetadata>(gameKey(id), 'json');
}

/** Hydrate one id: cache-first, then BGG on a miss (writing the result permanently). */
async function resolveOne(env: Env, id: string): Promise<GameMetadata | null> {
  const cached = await readGameCache(env, id);
  if (cached) return cached;
  const xml = await fetchThingXml(id, env.BGG_TOKEN);
  let meta: GameMetadata;
  try {
    meta = parseThing(xml, new Date().toISOString());
  } catch {
    return null; // a valid id that returns no <item> → not found, don't cache.
  }
  await env.BGG_CACHE.put(gameKey(meta.id), JSON.stringify(meta));
  return meta;
}

/** Hydrate many ids in one BGG call for the misses; never re-fetches a cache hit. */
async function resolveMany(env: Env, ids: string[]): Promise<GameMetadata[]> {
  const unique = [...new Set(ids.filter(Boolean))];
  const found = new Map<string, GameMetadata>();
  const misses: string[] = [];
  for (const id of unique) {
    const cached = await readGameCache(env, id);
    if (cached) found.set(id, cached);
    else misses.push(id);
  }
  for (let i = 0; i < misses.length; i += MAX_BATCH) {
    const batch = misses.slice(i, i + MAX_BATCH);
    const xml = await fetchThingXml(batch.join(','), env.BGG_TOKEN);
    for (const meta of parseThings(xml, new Date().toISOString())) {
      await env.BGG_CACHE.put(gameKey(meta.id), JSON.stringify(meta));
      found.set(meta.id, meta);
    }
  }
  // Preserve requested order; drop ids BGG didn't return.
  return unique.map((id) => found.get(id)).filter((m): m is GameMetadata => m !== undefined);
}

async function search(env: Env, q: string): Promise<SearchCandidate[]> {
  const cached = await env.BGG_CACHE.get<SearchCandidate[]>(searchKey(q), 'json');
  if (cached) return cached;
  const xml = await fetchSearchXml(q, env.BGG_TOKEN);
  const candidates = parseSearch(xml);
  await env.BGG_CACHE.put(searchKey(q), JSON.stringify(candidates), {
    expirationTtl: SEARCH_TTL_SECONDS,
  });
  return candidates;
}

function mapBggError(request: Request, err: unknown): Response {
  if (err instanceof BggError) {
    if (err.status === 401 || err.status === 403) {
      return errorJson(request, 502, 'BggUnauthorized', 'The catalog service is misconfigured.');
    }
    return errorJson(request, 503, 'BggUnavailable', 'BoardGameGeek is busy. Try again shortly.');
  }
  return errorJson(request, 500, 'WorkerError', 'Something went wrong fetching game data.');
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }
    if (request.method !== 'GET') {
      return errorJson(request, 405, 'MethodNotAllowed', 'Use GET.');
    }

    try {
      if (pathname === '/api/health') {
        return json(request, { ok: true });
      }

      // /api/game/<id> — single game metadata (cache-first).
      const gameMatch = pathname.match(/^\/api\/game\/([^/]+)$/);
      if (gameMatch) {
        const id = decodeURIComponent(gameMatch[1]!);
        const meta = await resolveOne(env, id);
        if (!meta) return errorJson(request, 404, 'GameNotFound', 'No such game on BGG.');
        return json(request, meta, { cacheSeconds: 86400 });
      }

      // /api/games?ids=1,2,3 — batch hydrate for feeds/grids.
      if (pathname === '/api/games') {
        const ids = (url.searchParams.get('ids') ?? '').split(',').map((s) => s.trim());
        if (!ids.some(Boolean)) return errorJson(request, 400, 'BadRequest', 'Pass ?ids=…');
        return json(request, await resolveMany(env, ids), { cacheSeconds: 86400 });
      }

      // /api/search?q=catan — name → candidates (short-TTL cache).
      if (pathname === '/api/search') {
        const q = (url.searchParams.get('q') ?? '').trim();
        if (q.length < 2) return json(request, [] satisfies SearchCandidate[]);
        return json(request, await search(env, q), { cacheSeconds: SEARCH_TTL_SECONDS });
      }

      return errorJson(request, 404, 'NotFound', 'Unknown route.');
    } catch (err) {
      return mapBggError(request, err);
    }
  },
};
