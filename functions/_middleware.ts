/**
 * Pages middleware — everything rolld says about a page in its `<head>` (D-61, D-62).
 *
 * Two jobs, one pass. It stamps in the `at:` tags that map the page back to the
 * record it renders, and it replaces the static title/description/`og:*` block from
 * `index.html` with something that describes this page rather than the whole app.
 *
 * Both exist here rather than in the app because rolld is a client-rendered SPA and
 * the consumers of this metadata — link unfurlers, crawlers, the tools that read
 * `at:` tags — fetch the URL and parse the HTML without running our JavaScript.
 *
 * The decisions live in shared pure modules (`src/atTags.ts`, `src/pageMeta.ts`); the
 * fetching lives in `functions/`. This file is the edge glue: bail early, gather what
 * it can, rewrite. Nothing it does can fail a page — every path falls back to serving
 * the asset exactly as it came.
 *
 * Cost, accepted knowingly: a root middleware runs for every request the Pages
 * project serves, assets included. Everything unrecognised leaves on the first lines,
 * so the tax is one cheap invocation, but it isn't zero.
 */
import { atTagRoute, renderAtTags, resolveAtTags, type AtTag } from '../src/atTags.js';
import {
  buildPageMeta,
  metaRoute,
  renderPageMeta,
  type EntryRecord,
  type MetaData,
  type MetaRoute,
  type RenderedMeta,
} from '../src/pageMeta.js';
import { resolveIdentity, type Identity } from './identity.js';
import { fetchEntry, fetchGame, type RecordCache } from './pageData.js';

/** Handles move rarely; an hour of edge memory saves a Slingshot round-trip per view. */
const DID_CACHE_SECONDS = 3600;
/** A play can be edited, so its cached copy is short-lived. Takedowns don't wait for
 * this: the moderation check runs on every request, cache hit or not (`pageData.ts`). */
const RECORD_CACHE_SECONDS = 300;
/** Board game metadata doesn't change; the Worker caches it forever, so can we. */
const GAME_CACHE_SECONDS = 86_400;

/**
 * The Worker that owns BGG metadata and the moderation blocklist, bound as a service
 * (`wrangler.toml`). A plain `fetch` to `rolld.at/api/…` cannot reach it: same-zone
 * Worker-to-Worker calls fail without a binding, and the middleware would read the
 * failure as "blocked" and quietly drop every entry title (D-62).
 */
interface Env {
  API?: Fetcher;
  /** Local-dev escape hatch when no binding exists — see the README. */
  API_ORIGIN?: string;
}

type Ctx = EventContext<Env, string, unknown>;

/** Appends the rendered `at:` tags to `<head>`. Content is validated and escaped upstream. */
class HeadTags {
  constructor(private readonly markup: string) {}
  element(element: Element): void {
    element.append(this.markup, { html: true });
  }
}

/** Replaces the text of the static `<title>`. */
class Title {
  constructor(private readonly title: string) {}
  element(element: Element): void {
    element.setInnerContent(this.title);
  }
}

/** Replaces one meta tag's `content`, leaving the rest of the static block alone. */
class MetaContent {
  constructor(private readonly value: string) {}
  element(element: Element): void {
    element.setAttribute('content', this.value);
  }
}

/** Read a JSON value from the edge cache, or null. Any trouble reads as a miss. */
async function cacheRead<T>(key: string): Promise<T | null> {
  try {
    const hit = await caches.default.match(new Request(key));
    return hit ? ((await hit.json()) as T) : null;
  } catch {
    return null;
  }
}

/** Write a JSON value to the edge cache, off the response path. */
function cacheWrite(ctx: Ctx, key: string, value: unknown, seconds: number): void {
  ctx.waitUntil(
    caches.default
      .put(
        new Request(key),
        new Response(JSON.stringify(value), {
          headers: { 'content-type': 'application/json', 'cache-control': `max-age=${seconds}` },
        }),
      )
      .catch(() => {}),
  );
}

/**
 * Identity, memoized in the edge cache. Only successes are cached: a handle that
 * doesn't resolve yet (a brand-new account) should start working on its next view,
 * not in an hour.
 */
async function cachedIdentity(identifier: string, ctx: Ctx): Promise<Identity | null> {
  const key = `https://rolld.at/__meta/identity/${encodeURIComponent(identifier)}`;
  const hit = await cacheRead<Identity>(key);
  if (hit) return hit;

  const identity = await resolveIdentity(identifier);
  if (identity) cacheWrite(ctx, key, identity, DID_CACHE_SECONDS);
  return identity;
}

/** The record cache `fetchEntry` writes through, backed by the edge cache. */
function recordCache(ctx: Ctx): RecordCache {
  return {
    get: (uri) => cacheRead<EntryRecord>(`https://rolld.at/__meta/record/${encodeURIComponent(uri)}`),
    put: (uri, value) =>
      cacheWrite(ctx, `https://rolld.at/__meta/record/${encodeURIComponent(uri)}`, value, RECORD_CACHE_SECONDS),
  };
}

/** How to reach the Worker: through the binding when it exists, over HTTP otherwise. */
interface Api {
  origin: string;
  fetchImpl: typeof fetch;
}

function api(env: Env, url: URL): Api {
  const bound = env?.API;
  return {
    // With a binding the host is irrelevant (the request goes straight to the Worker)
    // but `fetch` still needs an absolute URL, so keep the real one.
    origin: env?.API_ORIGIN ?? url.origin,
    fetchImpl: bound ? bound.fetch.bind(bound) : fetch,
  };
}

/** Game metadata, memoized at the edge so a cold isolate doesn't re-ask the Worker. */
async function cachedGame(bggId: string, api: Api, ctx: Ctx) {
  const key = `https://rolld.at/__meta/game/${encodeURIComponent(bggId)}`;
  const hit = await cacheRead<{ name: string; yearPublished?: number }>(key);
  if (hit) return hit;

  const game = await fetchGame(api.origin, bggId, { fetchImpl: api.fetchImpl });
  if (game) cacheWrite(ctx, key, game, GAME_CACHE_SECONDS);
  return game;
}

/** Gather whatever this route needs to describe itself. Every miss is survivable. */
async function gather(route: MetaRoute, identity: Identity | null, api: Api, ctx: Ctx): Promise<MetaData> {
  const data: MetaData = identity?.handle ? { handle: identity.handle } : {};

  if (route.kind === 'entry' && identity?.pds && route.collection && route.rkey) {
    const record = await fetchEntry({
      origin: api.origin,
      pds: identity.pds,
      did: identity.did,
      collection: route.collection,
      rkey: route.rkey,
      // Only the moderation check goes through the binding; the PDS read is a
      // genuine outbound request and uses the global fetch.
      apiFetch: api.fetchImpl,
      cache: recordCache(ctx),
    });
    if (record) data.record = record;
    return data;
  }
  if (route.bggId) {
    const game = await cachedGame(route.bggId, api, ctx);
    if (game) data.game = game;
  }
  return data;
}

/** Resolve the identity once and share it between the `at:` tags and the title. */
async function collect(
  url: URL,
  ctx: Ctx,
): Promise<{ tags: AtTag[]; meta: RenderedMeta | null }> {
  const route = metaRoute(url.pathname);
  const needsIdentity = atTagRoute(url.pathname) !== null || (route?.identifier !== undefined);

  let identity: Identity | null = null;
  if (needsIdentity) {
    const identifier = atTagRoute(url.pathname)?.identifier ?? route?.identifier;
    if (identifier) identity = await cachedIdentity(identifier, ctx);
  }

  const tags = await resolveAtTags(url.pathname, async () => identity?.did ?? null);

  let meta: RenderedMeta | null = null;
  if (route) {
    const data = route.kind === 'static' ? {} : await gather(route, identity, api(ctx.env, url), ctx);
    const built = buildPageMeta(route, data);
    if (built) meta = renderPageMeta(built, `${url.origin}${url.pathname}`);
  }
  return { tags, meta };
}

export const onRequest: PagesFunction<Env> = async (ctx) => {
  const { request, next } = ctx;
  try {
    if (request.method !== 'GET' && request.method !== 'HEAD') return await next();
    const url = new URL(request.url);
    // Assets and anything unrecognised leave here, before any async work.
    if (!atTagRoute(url.pathname) && !metaRoute(url.pathname)) return await next();

    // The lookups ride alongside the asset fetch rather than after it.
    const [response, { tags, meta }] = await Promise.all([next(), collect(url, ctx)]);
    if (tags.length === 0 && !meta) return response;
    if (!(response.headers.get('content-type') ?? '').includes('text/html')) return response;

    let rewriter = new HTMLRewriter();
    if (tags.length > 0) rewriter = rewriter.on('head', new HeadTags(renderAtTags(tags)));
    if (meta) {
      rewriter = rewriter
        .on('title', new Title(meta.title))
        .on('meta[name="description"]', new MetaContent(meta.attributes['description']!))
        .on('meta[property="og:title"]', new MetaContent(meta.attributes['og:title']!))
        .on('meta[property="og:description"]', new MetaContent(meta.attributes['og:description']!))
        .on('meta[property="og:url"]', new MetaContent(meta.attributes['og:url']!));
    }
    return rewriter.transform(response);
  } catch {
    // A metadata failure is never a reason to fail a page.
    return await next();
  }
};
