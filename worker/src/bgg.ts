/**
 * The single gateway to BoardGameGeek (D-31). The browser NEVER calls BGG; it
 * calls this Worker, which holds the `BGG_TOKEN` secret and injects the
 * `Authorization: Bearer` header server-side. BGG requires this posture.
 *
 * This module is the polite-fetch core: it injects the token, and it handles
 * BGG's two operational gotchas — 202 (queued, not ready) and 502 (transient) —
 * plus 429/500/503 (rate-limited / busy) by retrying with backoff. Pure enough to
 * unit-test: `fetchImpl` and `sleep` are injectable.
 */

/** Bare domain, no `www` — the `www` subdomain can interfere with authorization (D-31). */
const BGG_BASE = 'https://boardgamegeek.com/xmlapi2';

/** Status codes that mean "not an error, try again": queued, busy, rate-limited, transient. */
const RETRYABLE = new Set([202, 429, 500, 502, 503]);

export interface BggDeps {
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  /** Max attempts before giving up. */
  maxAttempts?: number;
  /** Base backoff in ms (doubles each attempt; BGG suggests ~5s spacing). */
  backoffMs?: number;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export class BggError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'BggError';
  }
}

/**
 * GET a BGG XML endpoint with the token, retrying the retryable statuses. Returns
 * the XML body on success. Throws `BggError` on a non-retryable failure or after
 * exhausting attempts (e.g. 401 for a bad/missing token — surfaced, never retried).
 */
async function bggGet(path: string, token: string, deps: BggDeps = {}): Promise<string> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const sleep = deps.sleep ?? defaultSleep;
  const maxAttempts = deps.maxAttempts ?? 4;
  const backoffMs = deps.backoffMs ?? 5000;

  let lastStatus = 0;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) await sleep(backoffMs * Math.pow(2, attempt - 1));
    const res = await fetchImpl(`${BGG_BASE}${path}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/xml' },
    });
    lastStatus = res.status;
    if (res.ok && res.status !== 202) return await res.text();
    if (!RETRYABLE.has(res.status)) {
      throw new BggError(`BGG returned ${res.status}`, res.status);
    }
    // Drain the body so the connection can be reused, then loop to retry.
    await res.text().catch(() => undefined);
  }
  throw new BggError(`BGG still unavailable after ${maxAttempts} attempts`, lastStatus);
}

/** Fetch a `thing` (one or more ids, comma-joined; BGG caps at 20). `stats=1` is required. */
export function fetchThingXml(ids: string, token: string, deps?: BggDeps): Promise<string> {
  const q = encodeURIComponent(ids);
  return bggGet(`/thing?id=${q}&stats=1`, token, deps);
}

/** Fetch a board-game `search` for a typed query. */
export function fetchSearchXml(query: string, token: string, deps?: BggDeps): Promise<string> {
  const q = encodeURIComponent(query);
  return bggGet(`/search?query=${q}&type=boardgame`, token, deps);
}
