/**
 * Document-head upkeep for the SPA (D-61).
 *
 * The Pages middleware ships the right `at:` tags with the HTML, which covers every
 * fetch-and-parse consumer. But rolld is a single-page app: after a client-side
 * navigation the served tags describe the page the reader *left*. A stale
 * `at:canonical` is worse than none — it points a reader's tooling at the wrong
 * record — so every navigation replaces them.
 */
import { type AtTag, resolveAtTags } from '../atTags.js';
import {
  buildPageMeta,
  metaRoute,
  renderPageMeta,
  siteMeta,
  type MetaData,
  type MetaRoute,
  type PageMeta,
} from '../pageMeta.js';

/** Replace the page's `at:` tags with `tags` (an empty list just clears them). */
export function applyAtTags(tags: AtTag[], doc: Document = document): void {
  for (const stale of doc.head.querySelectorAll('meta[name^="at:"]')) stale.remove();
  for (const tag of tags) {
    const meta = doc.createElement('meta');
    meta.setAttribute('name', tag.name);
    meta.setAttribute('content', tag.content);
    doc.head.append(meta);
  }
}

/**
 * Re-tag the head for `pathname`. Clears first and asks questions later: during the
 * identity round-trip the truthful answer is "no record", not the last page's one.
 * A resolution that lands after the reader has moved on is dropped — `currentPath`
 * is what the check compares against.
 */
export async function syncAtTags(
  pathname: string,
  resolveDid: (identifier: string) => Promise<string | null>,
  currentPath: () => string = () => location.pathname,
): Promise<void> {
  applyAtTags([]);
  const tags = await resolveAtTags(pathname, resolveDid);
  if (tags.length === 0 || currentPath() !== pathname) return;
  applyAtTags(tags);
}

/**
 * Write a page's title and description into the head (D-62). `null` restores the
 * site-wide copy, which is what a page says while its data is still loading, and what
 * it keeps saying if the data never arrives.
 *
 * Values go in through `setAttribute` and `document.title`, never as markup, so a
 * note full of angle brackets is text and stays text.
 */
export function applyPageMeta(meta: PageMeta | null, url: string, doc: Document = document): void {
  const { title, attributes } = renderPageMeta(meta ?? siteMeta(), url);
  doc.title = title;
  for (const [name, value] of Object.entries(attributes)) {
    const selector = name.startsWith('og:') ? `meta[property="${name}"]` : `meta[name="${name}"]`;
    let tag = doc.head.querySelector(selector);
    if (!tag) {
      tag = doc.createElement('meta');
      tag.setAttribute(name.startsWith('og:') ? 'property' : 'name', name);
      doc.head.append(tag);
    }
    tag.setAttribute('content', value);
  }
}

/**
 * Re-title the head for a client-side navigation, from the path alone (D-62).
 *
 * A profile page can say who it's about immediately — the handle is right there in
 * the URL — and the static pages know their own copy. Everything else resets to the
 * site-wide title until the view that's loading calls `setPageMeta` with real data.
 * Resetting matters: without it a play's title would sit in the tab while the reader
 * is three pages away.
 *
 * Not called for the first render of a document: the head Cloudflare served is
 * already right for the URL it was served for (`functions/_middleware.ts`).
 */
export function syncPageHead(pathname: string, doc: Document = document): void {
  const route = metaRoute(pathname);
  const known = route?.identifier !== undefined && !route.identifier.startsWith('did:');
  const data: MetaData = known ? { handle: route!.identifier! } : {};
  applyPageMeta(route ? buildPageMeta(route, data) : null, location.href, doc);
}

/** Re-title the head from data a view has just loaded. */
export function setPageMeta(route: MetaRoute, data: MetaData, doc: Document = document): void {
  applyPageMeta(buildPageMeta(route, data), location.href, doc);
}
