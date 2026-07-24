/**
 * Render-path moderation filter (D-41/D-49). rolld can't delete records that live on
 * other people's PDSes, so a "takedown" means rolld stops *displaying* the content
 * (the standard AppView model). The private blocklist (DIDs + record URIs) never
 * ships to the browser; instead, before rendering records read from foreign PDSes,
 * the client NAMES the DIDs / URIs it's about to show and the Worker returns only the
 * blocked subset (`POST /api/moderation/check`; the server contract lives in
 * `worker/src/moderation.ts`). The client drops that subset. No enumeration — the
 * browser only ever learns yes/no about items it already holds.
 *
 * Fail CLOSED (D-49): a takedown is usually CSAM or abuse, so if the check can't be
 * completed (Worker unreachable, malformed reply) every named item is treated as
 * blocked — hidden, never shown. In production the check is same-origin, so this only
 * bites on a genuine outage, which is exactly when caution is warranted.
 */
import { API_BASE } from '../config.js';

/** The blocked subset the Worker returned, as Sets for O(1) membership tests. */
export interface BlockedSet {
  dids: Set<string>;
  uris: Set<string>;
}

export interface ModerationOptions {
  fetchImpl?: typeof fetch;
  /** Worker base URL; defaults to `API_BASE` (same-origin `/api` in production). */
  baseUrl?: string;
  signal?: AbortSignal;
}

/**
 * Ask the Worker which of the named DIDs / record URIs are on the moderation
 * blocklist. Returns ONLY the blocked subset. Fails CLOSED: on any error every named
 * item is reported blocked, so unverifiable content is hidden rather than shown.
 */
export async function checkBlocked(
  named: { dids?: string[]; uris?: string[] },
  opts: ModerationOptions = {},
): Promise<BlockedSet> {
  const dids = [...new Set((named.dids ?? []).filter(Boolean))];
  const uris = [...new Set((named.uris ?? []).filter(Boolean))];
  // Nothing named → nothing to hide, and no reason to touch the network.
  if (dids.length === 0 && uris.length === 0) {
    return { dids: new Set(), uris: new Set() };
  }
  const fetchImpl = opts.fetchImpl ?? fetch;
  const base = opts.baseUrl ?? API_BASE;
  try {
    const res = await fetchImpl(`${base}/api/moderation/check`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dids, uris }),
      signal: opts.signal ?? null,
    });
    if (!res.ok) throw new Error(`moderation check returned ${res.status}`);
    const blocked = (await res.json()) as { dids?: string[]; uris?: string[] };
    return { dids: new Set(blocked.dids ?? []), uris: new Set(blocked.uris ?? []) };
  } catch {
    // Fail closed: hide everything we asked about.
    return { dids: new Set(dids), uris: new Set(uris) };
  }
}

/** True when a record is taken down — its author DID or its own URI is blocked. */
export function blocks(set: BlockedSet, did?: string, uri?: string): boolean {
  return (did !== undefined && set.dids.has(did)) || (uri !== undefined && set.uris.has(uri));
}

/**
 * Drop the moderation-blocked items from a render list (the dashboard feed, a game's
 * plays). One round-trip names every DID + URI about to be shown; a failed check
 * fails closed and drops the whole list rather than leak un-vetted content.
 */
export async function dropBlocked<T>(
  items: T[],
  get: { did: (t: T) => string; uri?: (t: T) => string },
  opts: ModerationOptions = {},
): Promise<T[]> {
  if (items.length === 0) return items;
  const set = await checkBlocked(
    { dids: items.map(get.did), ...(get.uri ? { uris: items.map(get.uri) } : {}) },
    opts,
  );
  return items.filter((t) => !blocks(set, get.did(t), get.uri?.(t)));
}

/**
 * Gate a single subject about to fill a whole page — an entry permalink (pass its
 * URI) or an author page (DID only). True means "render the not-available state".
 * Fail-closed via `checkBlocked`.
 */
export async function isHidden(
  did: string,
  uri?: string,
  opts: ModerationOptions = {},
): Promise<boolean> {
  const set = await checkBlocked({ dids: [did], ...(uri ? { uris: [uri] } : {}) }, opts);
  return blocks(set, did, uri);
}
