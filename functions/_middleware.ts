/**
 * Pages middleware — injects the `at:` meta tags into the served HTML (D-61).
 *
 * rolld is a client-rendered SPA, so anything the browser adds after load is
 * invisible to the tools this proposal is for: they fetch the URL and parse the
 * HTML, they don't run JavaScript. The tags therefore have to be in the bytes
 * Cloudflare sends, which is what this does — `_redirects` hands every app route the
 * same `index.html`, and HTMLRewriter stamps the record identity into its `<head>`
 * on the way out.
 *
 * The mapping itself lives in `src/atTags.ts`, shared with the SPA so the two can't
 * disagree. This file is the edge glue: bail early, resolve the identity, rewrite.
 *
 * Cost, accepted knowingly: a root middleware runs for every request the Pages
 * project serves, assets included. `atTagRoute` is a synchronous string match and
 * everything that isn't a person/entry page leaves on the next line, so the tax is
 * one cheap invocation — but it is not zero, and that's the price of tags that
 * non-JS consumers can actually see.
 */
import { atTagRoute, renderAtTags, resolveAtTags } from '../src/atTags.js';
import { resolveDid } from './identity.js';

/** Handles move rarely; an hour of edge memory saves a Slingshot round-trip per view. */
const DID_CACHE_SECONDS = 3600;

/** Appends the rendered tags to `<head>`. Content is validated and escaped upstream. */
class HeadTags {
  constructor(private readonly markup: string) {}
  element(element: Element): void {
    element.append(this.markup, { html: true });
  }
}

/**
 * Handle → DID, memoized in the edge cache. Only successes are cached: a handle that
 * doesn't resolve yet (a brand-new account) should start working on its next view,
 * not in an hour.
 */
async function cachedDid(identifier: string, ctx: EventContext<unknown, string, unknown>) {
  const key = new Request(`https://rolld.at/__at-did/${encodeURIComponent(identifier)}`);
  const cache = caches.default;
  const hit = await cache.match(key);
  if (hit) return await hit.text();

  const did = await resolveDid(identifier);
  if (did) {
    ctx.waitUntil(
      cache.put(
        key,
        new Response(did, { headers: { 'cache-control': `max-age=${DID_CACHE_SECONDS}` } }),
      ),
    );
  }
  return did;
}

export const onRequest: PagesFunction = async (ctx) => {
  const { request, next } = ctx;
  try {
    if (request.method !== 'GET' && request.method !== 'HEAD') return await next();
    const { pathname } = new URL(request.url);
    // Assets, game pages, the dashboard — everything that renders no record — leaves
    // here, before any async work.
    if (!atTagRoute(pathname)) return await next();

    // The identity lookup rides alongside the asset fetch rather than after it.
    const [response, tags] = await Promise.all([
      next(),
      resolveAtTags(pathname, (id) => cachedDid(id, ctx)),
    ]);
    if (tags.length === 0) return response;
    if (!(response.headers.get('content-type') ?? '').includes('text/html')) return response;

    return new HTMLRewriter().on('head', new HeadTags(renderAtTags(tags))).transform(response);
  } catch {
    // A tagging failure is never a reason to fail a page.
    return await next();
  }
};
