import { describe, expect, it } from 'vitest';
import { buildPlayRecord, buildProfileRecord, buildRatingRecord } from '../src/records/build.js';
import { validatePlay, validateProfile, validateRating } from '../src/records/validate.js';
import type { GameRef, PlayRecord, RatingRecord } from '../src/records/types.js';

const GAME: GameRef = { id: '174430', name: 'Gloomhaven', yearPublished: 2017 };
const at = (): string => '2026-06-30T12:00:00.000Z';

describe('buildPlayRecord', () => {
  it('attaches the frozen target and defaults playedAt to createdAt', () => {
    const r = buildPlayRecord({ game: GAME, now: at });
    expect(r.$type).toBe('at.rolld.play');
    expect(r.target).toBe('https://rolld.at/g/174430');
    expect(r.playedAt).toBe(at());
    expect(r.createdAt).toBe(at());
  });

  it('omits empty optionals but keeps populated ones', () => {
    const r = buildPlayRecord({
      game: GAME,
      players: [],
      location: '   ',
      winnerNames: ['Sam'],
      durationMinutes: 90,
      now: at,
    });
    expect('players' in r).toBe(false);
    expect('location' in r).toBe(false);
    expect(r.winnerNames).toEqual(['Sam']);
    expect(r.durationMinutes).toBe(90);
  });

  it('caps images at 4 (D-33)', () => {
    const img = { image: { $type: 'blob' as const, ref: { $link: 'x' }, mimeType: 'image/png', size: 1 }, alt: 'a' };
    const r = buildPlayRecord({ game: GAME, images: [img, img, img, img, img], now: at });
    expect(r.images).toHaveLength(4);
  });

  it('writes the markpub note + plain textContent when a note is given (D-11)', () => {
    const r = buildPlayRecord({ game: GAME, note: 'A **great** game', now: at });
    expect(r.content).toEqual({
      $type: 'at.markpub.markdown',
      text: { markdown: 'A **great** game' },
      flavor: 'gfm',
    });
    expect(r.textContent).toBe('A great game');
  });

  it('omits both note fields when the note is blank', () => {
    const r = buildPlayRecord({ game: GAME, note: '   ', now: at });
    expect('content' in r).toBe(false);
    expect('textContent' in r).toBe(false);
  });
});

describe('buildRatingRecord', () => {
  it('keys the rkey on the BGG id so re-rating overwrites (D-9)', () => {
    const { rkey, record } = buildRatingRecord({ game: GAME, rating: 8, now: at });
    expect(rkey).toBe('174430');
    expect(record.rating).toBe(8);
    expect(record.target).toBe('https://rolld.at/g/174430');
  });
});

describe('buildProfileRecord', () => {
  it('is the minimal self declaration (D-25)', () => {
    expect(buildProfileRecord({ now: at })).toEqual({
      $type: 'at.rolld.profile',
      createdAt: at(),
    });
  });
});

describe('validation', () => {
  it('passes a well-formed play and rating', () => {
    expect(validatePlay(buildPlayRecord({ game: GAME, now: at }))).toEqual([]);
    expect(validateRating(buildRatingRecord({ game: GAME, rating: 7, now: at }).record)).toEqual([]);
    expect(validateProfile(buildProfileRecord({ now: at }))).toEqual([]);
  });

  it('flags a target that does not match its gameRef (the frozen-URL guard)', () => {
    const bad: PlayRecord = {
      ...buildPlayRecord({ game: GAME, now: at }),
      target: 'https://rolld.at/g/999',
    };
    expect(validatePlay(bad)).toContain('target must equal https://rolld.at/g/174430 (got https://rolld.at/g/999)');
  });

  it('flags an out-of-range rating', () => {
    const bad: RatingRecord = { ...buildRatingRecord({ game: GAME, rating: 8, now: at }).record, rating: 11 };
    expect(validateRating(bad)).toContain('rating: integer 1–10');
  });

  it('flags a missing alt on a play photo (D-33) and >4 images', () => {
    const noAlt = { image: { $type: 'blob' as const, ref: { $link: 'x' }, mimeType: 'image/png', size: 1 }, alt: '' };
    const r = buildPlayRecord({ game: GAME, now: at });
    r.images = [noAlt];
    expect(validatePlay(r)).toContain('images[0].alt: alt text is required (D-33)');
  });

  // Regression: atproto maxLength is a UTF-8 BYTE limit. Measuring String.length
  // (UTF-16 code units) lets multibyte text slip past, then the PDS rejects it.
  it('measures string limits in UTF-8 bytes, not code units', () => {
    // 250 CJK chars = 250 code units but 750 bytes — over the 500-byte location cap.
    const r = buildPlayRecord({ game: GAME, location: '東'.repeat(250), now: at });
    expect(r.location!.length).toBe(250); // would pass a naive .length <= 500 check
    expect(validatePlay(r)).toContain('location: ≤500 bytes');
  });

  it('accepts a multibyte location that is within the byte budget', () => {
    const r = buildPlayRecord({ game: GAME, location: '東'.repeat(150), now: at }); // 450 bytes
    expect(validatePlay(r)).toEqual([]);
  });

  it('flags a multibyte gameRef name over 512 bytes', () => {
    const r = buildPlayRecord({ game: { id: '1', name: '東'.repeat(200) }, now: at }); // 600 bytes
    expect(validatePlay(r).some((e) => e.includes('name: required, ≤512 bytes'))).toBe(true);
  });

  // Regression: the lexicon declares these as `integer`; a fractional value passes
  // a sign-only check and then the PDS rejects it.
  it('flags a non-integer durationMinutes', () => {
    const r = buildPlayRecord({ game: GAME, durationMinutes: 30.5, now: at });
    expect(validatePlay(r)).toContain('durationMinutes: must be an integer');
  });

  it('still flags a negative durationMinutes', () => {
    const r = buildPlayRecord({ game: GAME, durationMinutes: -1, now: at });
    expect(validatePlay(r)).toContain('durationMinutes: must be ≥0');
  });

  it('flags a non-integer player score', () => {
    const r = buildPlayRecord({ game: GAME, now: at });
    r.players = [{ displayName: 'Sam', score: 7.5 }];
    expect(validatePlay(r)).toContain('players[0].score: must be an integer');
  });
});
