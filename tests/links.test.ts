import { describe, expect, it } from 'vitest';
import {
  CONSTELLATION_PATH,
  SPACEDUST_PLAY_SOURCE,
  TARGET_FIELD,
  didEntryUrl,
  entryPath,
  entryUrl,
  gameTargetUrl,
  parseGameTarget,
  profilePath,
} from '../src/links.js';

describe('gameTargetUrl (FROZEN — D-9)', () => {
  it('emits the exact canonical form for a gameRef', () => {
    expect(gameTargetUrl({ id: '174430', name: 'Gloomhaven' })).toBe(
      'https://rolld.at/g/174430',
    );
  });

  it('accepts a bare id and a {id} object identically', () => {
    expect(gameTargetUrl('13')).toBe('https://rolld.at/g/13');
    expect(gameTargetUrl({ id: '13' })).toBe('https://rolld.at/g/13');
  });

  it('round-trips with parseGameTarget', () => {
    const url = gameTargetUrl('266192');
    expect(parseGameTarget(url)).toBe('266192');
  });

  it('parseGameTarget rejects foreign or malformed URLs', () => {
    expect(parseGameTarget('https://rolld.at/g/13/plays')).toBeNull();
    expect(parseGameTarget('https://example.com/g/13')).toBeNull();
    expect(parseGameTarget('https://rolld.at/@me')).toBeNull();
  });
});

describe('Constellation / Spacedust path derivation', () => {
  it('derives both forms from the one TARGET_FIELD (the dot difference is real)', () => {
    expect(TARGET_FIELD).toBe('target');
    expect(CONSTELLATION_PATH).toBe('.target'); // leading dot
    expect(SPACEDUST_PLAY_SOURCE).toBe('at.rolld.play:target'); // no dot
  });
});

describe('mutable app routes (D-12, D-14)', () => {
  it('builds handle and DID per-entry permalinks', () => {
    expect(entryPath('jeremy.herve.bzh', 'play', '3kxyz')).toBe(
      '/@jeremy.herve.bzh/play/3kxyz',
    );
    expect(entryUrl('jeremy.herve.bzh', 'rating', '174430')).toBe(
      'https://rolld.at/@jeremy.herve.bzh/rating/174430',
    );
    expect(didEntryUrl('did:plc:abc', 'play', '3kxyz')).toBe(
      'https://rolld.at/did/did:plc:abc/play/3kxyz',
    );
  });

  it('builds a profile path', () => {
    expect(profilePath('alice.test')).toBe('/@alice.test');
  });
});
