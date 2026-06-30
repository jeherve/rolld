/**
 * Player typeahead (CC-2, D-34). Resolving a typed name to a real atproto identity
 * uses `app.bsky.actor.searchActorsTypeahead` on the configured AppView (D-51,
 * default `public.api.bsky.app`) — unauthenticated, keyless, and fast, so it can
 * feel near-instant (unlike the server-proxied, rate-limited BGG game search). This
 * mirrors the author's skypress @-mention pattern: search via the AppView, store the
 * resolved DID.
 *
 * Distinct from Slingshot `resolveMiniDoc`, which *verifies* a single known handle
 * (D-14). Typeahead finds candidates; resolveMiniDoc confirms one. Different jobs.
 */
import { APPVIEW_API } from '../config.js';

export interface Actor {
  did: string;
  handle: string;
  displayName?: string;
  avatar?: string;
}

export interface ActorSearchOptions {
  limit?: number;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
  signal?: AbortSignal;
}

/** Fuzzy prefix search for people. Returns [] for blank/too-short queries or on failure. */
export async function searchActors(query: string, opts: ActorSearchOptions = {}): Promise<Actor[]> {
  const q = query.trim();
  if (q.length < 1) return [];
  const fetchImpl = opts.fetchImpl ?? fetch;
  const base = opts.baseUrl ?? APPVIEW_API;
  const limit = opts.limit ?? 8;
  const url = `${base}/xrpc/app.bsky.actor.searchActorsTypeahead?q=${encodeURIComponent(q)}&limit=${limit}`;
  try {
    const res = await fetchImpl(url, { signal: opts.signal ?? null });
    if (!res.ok) return [];
    const data = (await res.json()) as { actors?: Actor[] };
    return (data.actors ?? []).map((a) => ({
      did: a.did,
      handle: a.handle,
      ...(a.displayName ? { displayName: a.displayName } : {}),
      ...(a.avatar ? { avatar: a.avatar } : {}),
    }));
  } catch {
    return [];
  }
}
