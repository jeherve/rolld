/**
 * Moderation enforcement (D-41). rolld can't delete others' records (they live on
 * users' PDSes), so "takedown" = rolld stops *displaying* content — the standard
 * AppView model. The one piece of private, mutable, server-side moderation state is
 * a single KV blocklist (DIDs + record URIs), edited with `wrangler kv key put`, and
 * **never shipped to the browser** so it stays private.
 *
 * The Worker enforces it two ways: it refuses to serve blocked image blobs (the
 * strongest, in-path point — images already route through the Worker), and it
 * exposes a *targeted* check (`blockedSubset`) that returns only the blocked items
 * among a set the client already named — so the client filters its render data
 * without ever receiving the list (no enumeration). Pure logic, unit-tested.
 */

export interface Blocklist {
  dids: string[];
  uris: string[];
}

const EMPTY: Blocklist = { dids: [], uris: [] };

export interface BlocklistStore {
  get<T = unknown>(key: string, type: 'json'): Promise<T | null>;
}

/** The single KV entry holding the blocklist (server-side only). */
export const BLOCKLIST_KEY = 'moderation:blocklist';

/** Load the blocklist from KV; an absent/empty entry means "nothing blocked". */
export async function loadBlocklist(kv: BlocklistStore): Promise<Blocklist> {
  const raw = await kv.get<Partial<Blocklist>>(BLOCKLIST_KEY, 'json');
  if (!raw) return EMPTY;
  return { dids: raw.dids ?? [], uris: raw.uris ?? [] };
}

export function isBlockedDid(blocklist: Blocklist, did: string): boolean {
  return blocklist.dids.includes(did);
}

export function isBlockedUri(blocklist: Blocklist, uri: string): boolean {
  return blocklist.uris.includes(uri);
}

/**
 * Given items the client is about to display, return ONLY the subset that's blocked.
 * The client learns yes/no about items it already holds — it never sees the rest of
 * the list (D-41: the browser never receives the blocklist).
 */
export function blockedSubset(
  blocklist: Blocklist,
  named: { dids?: string[]; uris?: string[] },
): Blocklist {
  return {
    dids: (named.dids ?? []).filter((d) => isBlockedDid(blocklist, d)),
    uris: (named.uris ?? []).filter((u) => isBlockedUri(blocklist, u)),
  };
}
