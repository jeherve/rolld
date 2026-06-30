/**
 * `resolveGame()` — the one seam through which ALL game-metadata access flows
 * (D-6). Callers pass a BGG id and get live display metadata; the *source* of that
 * metadata is swappable behind this function (BGG today, maybe Wikidata later)
 * without any caller or record changing. v1 ships exactly one implementation: ask
 * the rolld Worker, which is the sole BGG gateway (D-31) — the browser never calls
 * BGG and never holds the token.
 *
 * Contract (D-32, graceful degradation): on a miss or any failure this resolves to
 * `null`, never throws. Callers render the `gameRef.name` snapshot immediately and
 * fill in cover/details when (if) hydration arrives — a row never blocks on the
 * network. `searchGames` is the exception: search is a foreground action with its
 * own error state, so it throws on failure.
 */
import { API_BASE } from '../config.js';
import type { GameMetadata, SearchCandidate } from './types.js';

export interface ResolveOptions {
  fetchImpl?: typeof fetch;
  /** Worker base URL; defaults to `API_BASE` (same-origin `/api` in production). */
  baseUrl?: string;
  signal?: AbortSignal;
}

/** Session-lifetime memo so one page render doesn't re-request the same id. */
const memo = new Map<string, GameMetadata>();

/** Test seam: drop the in-memory memo between cases. */
export function clearGameCache(): void {
  memo.clear();
}

function apiUrl(base: string, path: string): string {
  return `${base}/api${path}`;
}

/** Hydrate one game. Returns `null` on not-found or any failure (caller uses the snapshot). */
export async function resolveGame(
  bggId: string,
  opts: ResolveOptions = {},
): Promise<GameMetadata | null> {
  if (memo.has(bggId)) return memo.get(bggId)!;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const base = opts.baseUrl ?? API_BASE;
  try {
    const res = await fetchImpl(apiUrl(base, `/game/${encodeURIComponent(bggId)}`), {
      signal: opts.signal ?? null,
    });
    if (!res.ok) return null;
    const meta = (await res.json()) as GameMetadata;
    memo.set(bggId, meta);
    return meta;
  } catch {
    return null;
  }
}

/**
 * Hydrate many games in one Worker round-trip (feed cards, top-played grids). Memo
 * hits are served locally; only the misses go to the Worker. Returns a map keyed by
 * id; ids that fail to hydrate are simply absent (caller falls back to snapshots).
 */
export async function resolveGames(
  bggIds: string[],
  opts: ResolveOptions = {},
): Promise<Map<string, GameMetadata>> {
  const out = new Map<string, GameMetadata>();
  const misses: string[] = [];
  for (const id of new Set(bggIds)) {
    if (memo.has(id)) out.set(id, memo.get(id)!);
    else misses.push(id);
  }
  if (misses.length === 0) return out;

  const fetchImpl = opts.fetchImpl ?? fetch;
  const base = opts.baseUrl ?? API_BASE;
  try {
    const res = await fetchImpl(
      apiUrl(base, `/games?ids=${misses.map(encodeURIComponent).join(',')}`),
      { signal: opts.signal ?? null },
    );
    if (res.ok) {
      for (const meta of (await res.json()) as GameMetadata[]) {
        memo.set(meta.id, meta);
        out.set(meta.id, meta);
      }
    }
  } catch {
    // Leave misses absent — the caller degrades to name snapshots.
  }
  return out;
}

export class SearchError extends Error {}

/** Search BGG by name (via the Worker). Throws `SearchError` on failure (CC-1 error state). */
export async function searchGames(
  query: string,
  opts: ResolveOptions = {},
): Promise<SearchCandidate[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const fetchImpl = opts.fetchImpl ?? fetch;
  const base = opts.baseUrl ?? API_BASE;
  let res: Response;
  try {
    res = await fetchImpl(apiUrl(base, `/search?q=${encodeURIComponent(q)}`), {
      signal: opts.signal ?? null,
    });
  } catch (err) {
    throw new SearchError(`Search request failed: ${String(err)}`);
  }
  if (!res.ok) throw new SearchError(`Search returned ${res.status}`);
  return (await res.json()) as SearchCandidate[];
}
