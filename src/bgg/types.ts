/**
 * Catalog hydration types.
 *
 * `GameMetadata` is the live, display-time enrichment for a game — name, cover,
 * weight, community rating. It is NEVER stored in a record (D-5): records carry
 * only the lean `gameRef` snapshot; this is hydrated on demand through the
 * `resolveGame()` seam (D-6) and cached in the Worker's KV. The metadata *source*
 * is swappable behind that seam; the shape callers see is this.
 */
export interface GameMetadata {
  /** The BGG "thing" id as a string — the permanent identity key (D-6). */
  id: string;
  name: string;
  year?: number;
  thumbnail?: string;
  image?: string;
  description?: string;
  minPlayers?: number;
  maxPlayers?: number;
  /** Minutes. */
  minPlaytime?: number;
  /** Minutes. */
  maxPlaytime?: number;
  /** 1–5 complexity (BGG "averageweight"; requires stats=1). */
  weight?: number;
  /** The geek-weighted score BGG ranks by (bayesaverage; requires stats=1). */
  bggRating?: number;
  categories?: string[];
  mechanics?: string[];
  /** When this metadata was hydrated, for cache bookkeeping. */
  fetchedAt: string;
}

/**
 * A thin candidate from the BGG search endpoint — id + name (+ year). Enough to
 * build a self-describing `gameRef` (D-32); the rest hydrates via `resolveGame`.
 */
export interface SearchCandidate {
  id: string;
  name: string;
  yearPublished?: number;
}
