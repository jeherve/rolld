import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { nameTier, normalize, rankCandidates, rankHydrated } from '../src/bgg/rankSearch.js';
import type { SearchCandidate } from '../src/bgg/types.js';

const TRIO: SearchCandidate[] = JSON.parse(
  readFileSync(resolve(process.cwd(), 'tests/fixtures/bgg-search-trio.json'), 'utf8'),
);

describe('normalize', () => {
  it('folds case, diacritics and punctuation', () => {
    expect(normalize('Trío')).toBe('trio');
    expect(normalize('Ticket to Ride: Europe')).toBe('ticket to ride europe');
    expect(normalize("Pixies‘ Trio")).toBe('pixies trio');
    expect(normalize('  Mäuse   Trio ')).toBe('mause trio');
  });
});

describe('nameTier', () => {
  it('scores an exact match 0, ignoring case and accents', () => {
    expect(nameTier('trio', 'Trio')).toBe(0);
    expect(nameTier('TRIO', 'Trío')).toBe(0);
  });

  it('scores a leading whole word 1', () => {
    expect(nameTier('trio', 'Trio Domino')).toBe(1);
    expect(nameTier('catan', 'Catan Card Game')).toBe(1);
  });

  it('scores a non-leading whole word 2', () => {
    expect(nameTier('trio', 'Qwirkle Trio')).toBe(2);
    expect(nameTier('trio', '3-Kaart Trio-Spel')).toBe(2);
  });

  it('scores a mid-word substring 3', () => {
    expect(nameTier('trio', 'Triology')).toBe(3);
    expect(nameTier('trio', 'Triomatt')).toBe(3);
  });

  it('scores no match 4', () => {
    expect(nameTier('trio', 'Gloomhaven')).toBe(4);
    expect(nameTier('', 'Trio')).toBe(4);
  });

  it('matches a punctuated title as one normalized run', () => {
    expect(nameTier('ticket to ride europe', 'Ticket to Ride: Europe')).toBe(0);
  });
});

describe('rankCandidates', () => {
  const ranked = rankCandidates('trio', TRIO);

  it('floats every exact-name match above the alphabetical noise', () => {
    const exact = TRIO.filter((g) => nameTier('trio', g.name) === 0);
    expect(exact.length).toBeGreaterThan(1);
    expect(ranked.slice(0, exact.length).map((g) => g.id).sort()).toEqual(
      exact.map((g) => g.id).sort(),
    );
  });

  it('brings the target game into the visible top 8', () => {
    // The typeahead renders slice(0, 8). Before ranking, 352515 sat at ~35.
    expect(ranked.slice(0, 8).some((g) => g.id === '352515')).toBe(true);
  });

  it('keeps no-match candidates rather than dropping them', () => {
    expect(ranked).toHaveLength(TRIO.length);
  });

  it('is stable within a tier', () => {
    const list = [
      { id: 'a', name: 'Zeta Trio' },
      { id: 'b', name: 'Alpha Trio' },
    ];
    expect(rankCandidates('trio', list).map((g) => g.id)).toEqual(['a', 'b']);
  });
});

describe('rankHydrated', () => {
  it('breaks a tier tie on popularity, then on year', () => {
    const list = [
      { id: 'old', name: 'Trio', yearPublished: 1894, usersRated: 12 },
      { id: 'hit', name: 'Trio', yearPublished: 2021, usersRated: 14203 },
      { id: 'mid', name: 'Trio', yearPublished: 2006, usersRated: 41 },
    ];
    expect(rankHydrated('trio', list).map((g) => g.id)).toEqual(['hit', 'mid', 'old']);
  });

  it('keeps tier dominant over popularity', () => {
    const list = [
      { id: 'famous', name: 'Trio Domino', usersRated: 99999 },
      { id: 'exact', name: 'Trio', usersRated: 5 },
    ];
    expect(rankHydrated('trio', list).map((g) => g.id)).toEqual(['exact', 'famous']);
  });

  it('treats missing popularity as zero without crashing', () => {
    const list = [{ id: 'a', name: 'Trio' }, { id: 'b', name: 'Trio', usersRated: 3 }];
    expect(rankHydrated('trio', list).map((g) => g.id)).toEqual(['b', 'a']);
  });
});
