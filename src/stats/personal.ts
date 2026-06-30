/**
 * Personal stats (D-38), computed client-side from a user's own records — the play
 * log and rating records the page already fetched. No new reads, no Constellation,
 * no backend: these are cheap because they're personal. "Most played" and "top
 * rated" are kept as TWO SEPARATE shelves (D-38) — they answer different questions,
 * so they are never blended into a fuzzy "favourites".
 *
 * The hard line (D-38): these are per-profile. Cross-game global ranking
 * ("most-played across all of rolld", trending) is NOT here — it can't be done
 * under the no-server model. All pure, unit-tested.
 */
import type { GameRef, PlayRecord, RatingRecord } from '../records/types.js';

/**
 * A record's timestamp, defended against malformed data. Profile pages run these
 * stats over *other users'* records (fetched and cast with no runtime check), so a
 * missing or non-string timestamp must not throw — it sorts as "oldest" instead.
 */
const asTime = (value: string | undefined): string => (typeof value === 'string' ? value : '');

export interface PlayedGame {
  game: GameRef;
  count: number;
  /** Most recent `playedAt` among these plays. */
  lastPlayed: string;
}

export interface RatedGame {
  game: GameRef;
  rating: number;
  ratedAt: string;
}

/** Group plays by game id, count, and sort most-played first (tie-break: most recent). */
export function mostPlayed(plays: PlayRecord[], topN?: number): PlayedGame[] {
  const byGame = new Map<string, PlayedGame>();
  for (const play of plays) {
    const id = play.game.id;
    const playedAt = asTime(play.playedAt);
    const existing = byGame.get(id);
    if (existing) {
      existing.count++;
      if (playedAt > existing.lastPlayed) existing.lastPlayed = playedAt;
    } else {
      byGame.set(id, { game: play.game, count: 1, lastPlayed: playedAt });
    }
  }
  const sorted = [...byGame.values()].sort(
    (a, b) => b.count - a.count || b.lastPlayed.localeCompare(a.lastPlayed),
  );
  return topN === undefined ? sorted : sorted.slice(0, topN);
}

/** Sort ratings high→low (tie-break: most recent). A SEPARATE shelf from most-played (D-38). */
export function topRated(ratings: RatingRecord[], topN?: number): RatedGame[] {
  const sorted = ratings
    .map((r) => ({ game: r.game, rating: r.rating, ratedAt: asTime(r.createdAt) }))
    .sort((a, b) => b.rating - a.rating || b.ratedAt.localeCompare(a.ratedAt));
  return topN === undefined ? sorted : sorted.slice(0, topN);
}

/** Plays within a calendar year (by `playedAt`, which is why it's distinct from createdAt). */
export function playedInYear(plays: PlayRecord[], year: number): PlayRecord[] {
  const prefix = `${year}-`;
  return plays.filter((p) => asTime(p.playedAt).startsWith(prefix));
}

/** Most-played, scoped to a year — the "played most this year" cut. */
export function mostPlayedThisYear(plays: PlayRecord[], year: number, topN?: number): PlayedGame[] {
  return mostPlayed(playedInYear(plays, year), topN);
}

/** My times-played for one game (count my own play records). */
export function timesPlayed(plays: PlayRecord[], gameId: string): number {
  return plays.reduce((n, p) => (p.game.id === gameId ? n + 1 : n), 0);
}

/** My last-played for one game (max playedAt), or null if never. */
export function lastPlayed(plays: PlayRecord[], gameId: string): string | null {
  let latest: string | null = null;
  for (const p of plays) {
    const playedAt = asTime(p.playedAt);
    if (p.game.id === gameId && (latest === null || playedAt > latest)) latest = playedAt;
  }
  return latest;
}

export interface PlaySummary {
  totalPlays: number;
  distinctGames: number;
}

export function playSummary(plays: PlayRecord[]): PlaySummary {
  return { totalPlays: plays.length, distinctGames: new Set(plays.map((p) => p.game.id)).size };
}

/** Count of ratings at each grade 1–10 (grade distribution). */
export function gradeDistribution(ratings: RatingRecord[]): number[] {
  const counts = new Array<number>(11).fill(0); // index 1..10
  for (const r of ratings) {
    if (r.rating >= 1 && r.rating <= 10) counts[r.rating]!++;
  }
  return counts.slice(1);
}
