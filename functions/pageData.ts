/**
 * What the Pages middleware fetches before it can title a page (D-62).
 *
 * Two things only: the record behind an entry permalink, and a game's catalog name.
 * Both are read defensively and both fail to `null`, because the fallback is always
 * the generic head from `index.html` rather than an error.
 *
 * The moderation gate lives here rather than in the caller so it can't be forgotten:
 * a record is returned ONLY once the Worker has confirmed neither its author nor the
 * record itself is on the blocklist. Anything else — blocked, a failed check, an
 * unreachable Worker — is treated as blocked (fail closed, D-41/D-49). Otherwise a
 * taken-down play would still leak its game and its note through an `og:description`,
 * which is exactly the leak the render path already refuses.
 */
import type { EntryRecord } from '../src/pageMeta.js';

const TIMEOUT_MS = 1500;

export interface FetchOptions {
  fetchImpl?: typeof fetch;
}

/** One abort budget per lookup: the reader's HTML is already in flight. */
function budget(): { signal: AbortSignal; done: () => void } {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);
  return { signal: abort.signal, done: () => clearTimeout(timer) };
}

/**
 * True when the Worker says this author or record is taken down — and true as well
 * when it says nothing intelligible at all.
 */
async function isBlocked(
  origin: string,
  did: string,
  uri: string,
  fetchImpl: typeof fetch,
  signal: AbortSignal,
): Promise<boolean> {
  try {
    const res = await fetchImpl(`${origin}/api/moderation/check`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dids: [did], uris: [uri] }),
      signal,
    });
    if (!res.ok) return true;
    const blocked = (await res.json()) as { dids?: unknown; uris?: unknown };
    const dids = Array.isArray(blocked.dids) ? blocked.dids : [];
    const uris = Array.isArray(blocked.uris) ? blocked.uris : [];
    return dids.includes(did) || uris.includes(uri);
  } catch {
    return true;
  }
}

export interface EntryRequest {
  /** This site's own origin, where the Worker's `/api/*` routes live. */
  origin: string;
  pds: string;
  did: string;
  collection: string;
  rkey: string;
  fetchImpl?: typeof fetch;
}

/** The record behind an entry page, once it has cleared moderation. Null otherwise. */
export async function fetchEntry(req: EntryRequest): Promise<EntryRecord | null> {
  const fetchImpl = req.fetchImpl ?? fetch;
  const uri = `at://${req.did}/${req.collection}/${req.rkey}`;
  const { signal, done } = budget();
  try {
    const url =
      `${req.pds}/xrpc/com.atproto.repo.getRecord?repo=${encodeURIComponent(req.did)}` +
      `&collection=${encodeURIComponent(req.collection)}&rkey=${encodeURIComponent(req.rkey)}`;
    // The check and the read race together; the read is only *used* if the check is
    // clean. `redirect: 'manual'` because the PDS origin was validated but a 3xx
    // Location is not — following it would step straight past that guard (Sec#1).
    const [blocked, res] = await Promise.all([
      isBlocked(req.origin, req.did, uri, fetchImpl, signal),
      fetchImpl(url, { redirect: 'manual', signal }).catch(() => null),
    ]);
    if (blocked || !res || res.status >= 300 || !res.ok) return null;
    const body = (await res.json()) as { value?: unknown };
    const value = body.value;
    return value && typeof value === 'object' ? (value as EntryRecord) : null;
  } catch {
    return null;
  } finally {
    done();
  }
}

/** A game's display name and year, from the Worker's KV-cached BGG metadata. */
export async function fetchGame(
  origin: string,
  bggId: string,
  opts: FetchOptions = {},
): Promise<{ name: string; yearPublished?: number } | null> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const { signal, done } = budget();
  try {
    const res = await fetchImpl(`${origin}/api/game/${encodeURIComponent(bggId)}`, { signal });
    if (!res.ok) return null;
    const game = (await res.json()) as { name?: unknown; year?: unknown };
    if (typeof game.name !== 'string' || game.name.length === 0) return null;
    return {
      name: game.name,
      ...(typeof game.year === 'number' ? { yearPublished: game.year } : {}),
    };
  } catch {
    return null;
  } finally {
    done();
  }
}
