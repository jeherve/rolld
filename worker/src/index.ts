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
import { buildUserFeedXml } from './feed.js';
import { corsHeaders, errorJson, json } from './http.js';
import { blockedSubset, isBlockedDid, loadBlocklist } from './moderation.js';

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
const RSS_TTL_SECONDS = 10 * 60; // readers poll; regenerate the feed at most every 10 min (D-42).
const CX_TTL_SECONDS = 60; // play counts change, unlike BGG data — short Constellation cache.
const MAX_BATCH = 20; // BGG caps a `thing` call at 20 ids (D-31).

const CONSTELLATION_BASE = 'https://constellation.microcosm.blue';
const SLINGSHOT_BASE = 'https://slingshot.microcosm.blue';

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

/** Serve a per-user RSS feed, cached in KV with a short TTL (D-42). */
async function serveFeed(request: Request, env: Env, identifier: string): Promise<Response> {
  const cacheKey = `rss:${identifier.toLowerCase()}`;
  let xml = await env.BGG_CACHE.get(cacheKey, 'text');
  if (!xml) {
    const blocklist = await loadBlocklist(env.BGG_CACHE);
    xml = await buildUserFeedXml(identifier, blocklist);
    if (!xml) return errorJson(request, 404, 'NotFound', 'No such user, or nothing to show.');
    await env.BGG_CACHE.put(cacheKey, xml, { expirationTtl: RSS_TTL_SECONDS });
  }
  return new Response(xml, {
    status: 200,
    headers: {
      'Content-Type': 'application/rss+xml; charset=utf-8',
      'Cache-Control': `public, max-age=${RSS_TTL_SECONDS}`,
      ...corsHeaders(request),
    },
  });
}

/** Proxy a play photo blob, refusing blocked DIDs (D-41, the strongest enforcement point). */
async function serveBlob(request: Request, env: Env, did: string, cid: string): Promise<Response> {
  const blocklist = await loadBlocklist(env.BGG_CACHE);
  if (isBlockedDid(blocklist, did)) {
    return errorJson(request, 404, 'NotAvailable', 'This image is not available on rolld.');
  }
  const idRes = await fetch(
    `${SLINGSHOT_BASE}/xrpc/blue.microcosm.identity.resolveMiniDoc?identifier=${encodeURIComponent(did)}`,
  );
  if (!idRes.ok) return errorJson(request, 404, 'NotFound', 'Unknown identity.');
  const pds = ((await idRes.json()) as { pds?: string }).pds;
  if (!pds) return errorJson(request, 404, 'NotFound', 'No PDS for this identity.');

  const blobRes = await fetch(
    `${pds}/xrpc/com.atproto.sync.getBlob?did=${encodeURIComponent(did)}&cid=${encodeURIComponent(cid)}`,
  );
  // The blob's stored mime type is attacker-controlled, and this Worker is served on
  // the app's own origin — so a user could upload an HTML "image" and get it served as
  // text/html (stored XSS). Clamp to an image allowlist, refuse to sniff, and sandbox
  // via CSP so anything that slips through can't execute. rolld only ever serves images.
  const upstreamType = blobRes.headers.get('Content-Type') ?? '';
  const safeType = /^image\/(jpeg|png|webp|gif|avif)$/i.test(upstreamType)
    ? upstreamType
    : 'application/octet-stream';
  return new Response(blobRes.body, {
    status: blobRes.status,
    headers: {
      'Content-Type': safeType,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Content-Disposition': 'inline',
      'Cache-Control': 'public, max-age=604800',
      ...corsHeaders(request),
    },
  });
}

/** Cache-through proxy for Constellation reads (short TTL — play counts change, D-4). */
async function serveConstellation(
  request: Request,
  env: Env,
  endpoint: string,
  search: string,
): Promise<Response> {
  const cacheKey = `cx:${endpoint}${search}`;
  const cached = await env.BGG_CACHE.get(cacheKey, 'text');
  if (cached) {
    return new Response(cached, {
      headers: { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders(request) },
    });
  }
  const res = await fetch(`${CONSTELLATION_BASE}${endpoint}${search}`, {
    headers: { Accept: 'application/json' },
  });
  const text = await res.text();
  if (res.ok) await env.BGG_CACHE.put(cacheKey, text, { expirationTtl: CX_TTL_SECONDS });
  return new Response(text, {
    status: res.status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': `public, max-age=${CX_TTL_SECONDS}`,
      ...corsHeaders(request),
    },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }

    // The one POST route: the targeted moderation check (D-41). The client names
    // items it's about to display; we return only the blocked subset, so the
    // browser filters its render data without ever receiving the blocklist.
    if (request.method === 'POST') {
      if (pathname === '/api/moderation/check') {
        try {
          const body = (await request.json()) as { dids?: string[]; uris?: string[] };
          const blocklist = await loadBlocklist(env.BGG_CACHE);
          return json(request, blockedSubset(blocklist, body));
        } catch {
          return errorJson(request, 400, 'BadRequest', 'Expected JSON {dids?, uris?}.');
        }
      }
      return errorJson(request, 405, 'MethodNotAllowed', 'Unknown POST route.');
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

      // Per-user RSS feed (D-42): /@<handle>/feed.xml and /did/<did>/feed.xml.
      const feedMatch =
        pathname.match(/^\/@([^/]+)\/feed\.xml$/) ?? pathname.match(/^\/did\/([^/]+)\/feed\.xml$/);
      if (feedMatch) {
        return await serveFeed(request, env, decodeURIComponent(feedMatch[1]!));
      }

      // Blob proxy (D-41): the in-path moderation point — refuse blocked DIDs' blobs.
      const blobMatch = pathname.match(/^\/api\/blob\/([^/]+)\/([^/]+)$/);
      if (blobMatch) {
        return await serveBlob(
          request,
          env,
          decodeURIComponent(blobMatch[1]!),
          decodeURIComponent(blobMatch[2]!),
        );
      }

      // Constellation cache proxy (short TTL): /api/cx/<endpoint>?… (D-4 mitigation).
      if (pathname.startsWith('/api/cx/')) {
        return await serveConstellation(request, env, pathname.slice('/api/cx'.length), url.search);
      }

      return errorJson(request, 404, 'NotFound', 'Unknown route.');
    } catch (err) {
      return mapBggError(request, err);
    }
  },
};
