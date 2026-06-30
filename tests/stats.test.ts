import { describe, expect, it } from 'vitest';
import {
  gradeDistribution,
  lastPlayed,
  mostPlayed,
  mostPlayedThisYear,
  playSummary,
  timesPlayed,
  topRated,
} from '../src/stats/personal.js';
import { gameTargetUrl } from '../src/links.js';
import type { PlayRecord, RatingRecord } from '../src/records/types.js';

const play = (id: string, name: string, playedAt: string): PlayRecord => ({
  $type: 'at.rolld.play',
  game: { id, name },
  target: gameTargetUrl(id),
  playedAt,
  createdAt: playedAt,
});
const rating = (id: string, name: string, r: number, at: string): RatingRecord => ({
  $type: 'at.rolld.rating',
  game: { id, name },
  target: gameTargetUrl(id),
  rating: r,
  createdAt: at,
});

const PLAYS = [
  play('1', 'Catan', '2026-01-10T00:00:00Z'),
  play('1', 'Catan', '2026-06-10T00:00:00Z'),
  play('1', 'Catan', '2025-12-10T00:00:00Z'),
  play('2', 'Wingspan', '2026-05-10T00:00:00Z'),
  play('3', 'Gloomhaven', '2026-02-10T00:00:00Z'),
];

describe('mostPlayed (D-38)', () => {
  it('groups by game id, counts, sorts desc, tracks lastPlayed', () => {
    const top = mostPlayed(PLAYS);
    expect(top[0]).toMatchObject({ count: 3, lastPlayed: '2026-06-10T00:00:00Z' });
    expect(top[0]!.game.id).toBe('1');
    expect(top.map((g) => g.count)).toEqual([3, 1, 1]);
  });

  it('honours topN', () => {
    expect(mostPlayed(PLAYS, 1)).toHaveLength(1);
  });
});

describe('topRated (a SEPARATE shelf, D-38)', () => {
  const RATINGS = [
    rating('1', 'Catan', 7, '2026-01-01T00:00:00Z'),
    rating('2', 'Wingspan', 9, '2026-01-01T00:00:00Z'),
    rating('3', 'Gloomhaven', 9, '2026-03-01T00:00:00Z'),
  ];
  it('sorts by grade desc, tie-broken by recency', () => {
    const top = topRated(RATINGS);
    expect(top.map((r) => r.game.id)).toEqual(['3', '2', '1']); // 9 (newer), 9 (older), 7
  });

  it('grade distribution counts 1..10', () => {
    const dist = gradeDistribution(RATINGS);
    expect(dist[8]).toBe(2); // two 9s at index 8 (grade 9)
    expect(dist[6]).toBe(1); // one 7 at index 6
  });
});

describe('time-windowed + per-game cuts', () => {
  it('mostPlayedThisYear filters by playedAt year', () => {
    const top = mostPlayedThisYear(PLAYS, 2026);
    // 2026 has Catan x2, Wingspan x1, Gloomhaven x1.
    expect(top[0]!.game.id).toBe('1');
    expect(top[0]!.count).toBe(2);
  });

  it('timesPlayed and lastPlayed for one game', () => {
    expect(timesPlayed(PLAYS, '1')).toBe(3);
    expect(lastPlayed(PLAYS, '1')).toBe('2026-06-10T00:00:00Z');
    expect(lastPlayed(PLAYS, '999')).toBeNull();
  });

  it('playSummary totals plays and distinct games', () => {
    expect(playSummary(PLAYS)).toEqual({ totalPlays: 5, distinctGames: 3 });
  });
});

// Regression: profile pages run these stats over OTHER users' records, which are
// fetched and cast with no runtime validation. A record with a missing/non-string
// timestamp must not throw.
describe('stats survive malformed records (untrusted PDS data)', () => {
  const broken = (id: string, name: string): PlayRecord => {
    const p = play(id, name, '2026-01-01T00:00:00Z');
    // @ts-expect-error simulate a record written by another client without playedAt
    delete p.playedAt;
    return p;
  };

  it('mostPlayed does not throw and still ranks', () => {
    const plays = [broken('1', 'Catan'), play('1', 'Catan', '2026-06-10T00:00:00Z'), broken('2', 'X')];
    expect(() => mostPlayed(plays)).not.toThrow();
    expect(mostPlayed(plays)[0]).toMatchObject({ count: 2, game: { id: '1' } });
  });

  it('mostPlayedThisYear does not throw on a timestamp-less record', () => {
    expect(() => mostPlayedThisYear([broken('1', 'Catan')], 2026)).not.toThrow();
  });

  it('lastPlayed returns null rather than throwing for a timestamp-less record', () => {
    expect(lastPlayed([broken('1', 'Catan')], '1')).toBe('');
  });

  it('topRated does not throw when a rating is missing createdAt', () => {
    const r = rating('1', 'Catan', 8, '2026-01-01T00:00:00Z');
    // @ts-expect-error malformed rating record
    delete r.createdAt;
    expect(() => topRated([r])).not.toThrow();
  });
});
