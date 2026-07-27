/**
 * Handle → DID for the Pages middleware (D-61).
 *
 * A local copy of the one Slingshot call the middleware needs, for the same reason
 * `worker/src/feed.ts` keeps its own: everything under `src/read/` reaches
 * `src/config.ts`, and `config.ts` reads `import.meta.env`, which doesn't exist in
 * the Workers runtime. Small enough to duplicate, too load-bearing to leave untested.
 *
 * Nothing here throws: an identity we can't resolve means the page ships without an
 * `at:` tag, which is the honest outcome. A tag pointing at a guessed DID would send
 * a reader's tooling to the wrong repo.
 */

const SLINGSHOT = 'https://slingshot.microcosm.blue';
const TIMEOUT_MS = 1500;

/** Same shape check the shared tag builder uses — never emit a bogus DID. */
const DID = /^did:[a-z]+:[a-zA-Z0-9._%:-]{1,2048}$/;

export interface ResolveOptions {
  fetchImpl?: typeof fetch;
  baseUrl?: string;
}

/** Resolve a handle to its DID via Slingshot's MiniDoc, or null. */
export async function resolveDid(
  identifier: string,
  opts: ResolveOptions = {},
): Promise<string | null> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const base = opts.baseUrl ?? SLINGSHOT;
  const url = `${base}/xrpc/blue.microcosm.identity.resolveMiniDoc?identifier=${encodeURIComponent(identifier)}`;
  // The HTML is already on its way to the reader; a slow identity service must not
  // hold it. Abort and ship the page untagged.
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);
  try {
    const res = await fetchImpl(url, { signal: abort.signal });
    if (!res.ok) return null;
    const doc = (await res.json()) as { did?: unknown };
    return typeof doc.did === 'string' && DID.test(doc.did) ? doc.did : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
