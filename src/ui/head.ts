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
