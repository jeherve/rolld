/**
 * Relevance ranking for BGG search results — pure, no network, no Worker APIs.
 *
 * BGG's `xmlapi2/search` returns matches in alphabetical order with no relevance
 * signal at all: a query for "trio" answers with `3-Kaart Trio-Spel`, `Alce Trío
 * Lío`, `Bio-Trio`… and buries the game actually called Trio around position 35,
 * far below the eight rows the typeahead shows (D-63).
 *
 * The fix is strict tiers with popularity breaking ties *inside* a tier. Tier
 * dominates deliberately: if you typed a game's exact name you want that game, not
 * the better-known expansion of something else — "pandemic" must answer Pandemic
 * above Pandemic Legacy, which outranks it on BGG.
 */

/**
 * Fold a title to its comparable form: strip diacritics, lowercase, and reduce every
 * run of punctuation to a single space. Without this `trio` misses `Trío` and
 * `ticket to ride europe` misses `Ticket to Ride: Europe` over a colon.
 */
export function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/**
 * Score how well `name` answers `query`. Lower is better:
 *   0 the whole name  ·  1 a leading whole word  ·  2 any whole word
 *   3 a mid-word substring  ·  4 no match
 *
 * Tier 4 is retained rather than filtered by callers: BGG matches alternate names,
 * but `parseSearch` keeps only the primary one, so a game whose German alternate
 * name is "Trio" is a legitimate hit that scores 4 on the name we can see.
 */
export function nameTier(query: string, name: string): number {
  const q = normalize(query);
  const n = normalize(name);
  if (!q || !n) return 4;
  if (n === q) return 0;
  if (n.startsWith(`${q} `)) return 1;
  if (n.includes(` ${q} `) || n.endsWith(` ${q}`)) return 2;
  if (n.includes(q)) return 3;
  return 4;
}

/**
 * Score each name once, then sort — rather than scoring inside the comparator, which
 * would re-normalize the same string O(n log n) times.
 */
function byTier<T extends { name: string }>(query: string, list: T[]): Map<T, number> {
  const tiers = new Map<T, number>();
  for (const item of list) tiers.set(item, nameTier(query, item.name));
  return tiers;
}

/**
 * Order by name tier alone, preserving BGG's order within a tier (Array#sort is
 * stable). Used *before* hydration, to choose which candidates are worth spending a
 * `thing` call on — popularity isn't known yet at that point.
 */
export function rankCandidates<T extends { name: string }>(query: string, list: T[]): T[] {
  const tiers = byTier(query, list);
  return [...list].sort((a, b) => tiers.get(a)! - tiers.get(b)!);
}

/**
 * Order by tier, then most-rated, then newest. Used *after* hydration: this is what
 * separates the ten games named exactly "Trio" and lifts the 2021 one to the top.
 */
export function rankHydrated<
  T extends { name: string; usersRated?: number; yearPublished?: number },
>(query: string, list: T[]): T[] {
  const tiers = byTier(query, list);
  return [...list].sort(
    (a, b) =>
      tiers.get(a)! - tiers.get(b)! ||
      (b.usersRated ?? 0) - (a.usersRated ?? 0) ||
      (b.yearPublished ?? 0) - (a.yearPublished ?? 0),
  );
}
