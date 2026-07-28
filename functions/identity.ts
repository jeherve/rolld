/**
 * Identity resolution for the Pages middleware (D-61, D-62).
 *
 * A local copy of the one Slingshot call the middleware needs, for the same reason
 * `worker/src/feed.ts` keeps its own: everything under `src/read/` reaches
 * `src/config.ts`, and `config.ts` reads `import.meta.env`, which doesn't exist in
 * the Workers runtime. Small enough to duplicate, too load-bearing to leave untested.
 *
 * Nothing here throws: an identity we can't resolve means the page ships with the
 * generic head, which is the honest outcome. A tag pointing at a guessed DID would
 * send a reader's tooling to the wrong repo.
 */
import { safeUpstreamOrigin } from '../worker/src/http.js';

const SLINGSHOT = 'https://slingshot.microcosm.blue';
const TIMEOUT_MS = 1500;

/** Same shape check the shared tag builder uses — never emit a bogus DID. */
const DID = /^did:[a-z]+:[a-zA-Z0-9._%:-]{1,2048}$/;

export interface ResolveOptions {
  fetchImpl?: typeof fetch;
  baseUrl?: string;
}

export interface Identity {
  did: string;
  handle?: string;
  /** Present only when the endpoint is safe to fetch; absent is not an error. */
  pds?: string;
}

/**
 * Harden the PDS origin before anything fetches it. The user picks their own PDS, so
 * this string is attacker-controlled: `safeUpstreamOrigin` requires https and rejects
 * IP-literal / localhost / single-label hosts, and on top of that we refuse an
 * explicit non-443 port, another way a self-chosen endpoint could aim the edge at an
 * internal service. Mirrors the feed path's `safeFeedPds` (Sec#1).
 */
function safePds(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const origin = safeUpstreamOrigin(raw);
  if (!origin) return undefined;
  return new URL(origin).port === '' ? origin : undefined;
}

/** Resolve a handle or DID to its MiniDoc, or null. */
export async function resolveIdentity(
  identifier: string,
  opts: ResolveOptions = {},
): Promise<Identity | null> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const base = opts.baseUrl ?? SLINGSHOT;
  const url = `${base}/xrpc/blue.microcosm.identity.resolveMiniDoc?identifier=${encodeURIComponent(identifier)}`;
  // The HTML is already on its way to the reader; a slow identity service must not
  // hold it. Abort and ship the page with the generic head.
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);
  try {
    const res = await fetchImpl(url, { signal: abort.signal });
    if (!res.ok) return null;
    const doc = (await res.json()) as { did?: unknown; handle?: unknown; pds?: unknown };
    if (typeof doc.did !== 'string' || !DID.test(doc.did)) return null;
    const pds = safePds(doc.pds);
    return {
      did: doc.did,
      // `handle.invalid` is Slingshot's "not bi-directionally verified" sentinel; it
      // has no business in a page title.
      ...(typeof doc.handle === 'string' && doc.handle !== 'handle.invalid'
        ? { handle: doc.handle }
        : {}),
      ...(pds ? { pds } : {}),
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
