import { describe, expect, it } from 'vitest';
import {
  countNoun,
  formatDate,
  formatRating,
  hasReportableContent,
  playersSummary,
  relativeTime,
  winnerSummary,
} from '../src/ui/format.js';
import { gameTargetUrl } from '../src/links.js';
import type { PlayRecord } from '../src/records/types.js';

const NOW = Date.parse('2026-06-30T12:00:00Z');
const play = (extra: Partial<PlayRecord> = {}): PlayRecord => ({
  $type: 'at.rolld.play',
  game: { id: '1', name: 'Catan' },
  target: gameTargetUrl('1'),
  playedAt: '2026-06-30T12:00:00Z',
  createdAt: '2026-06-30T12:00:00Z',
  ...extra,
});

describe('relativeTime', () => {
  it('reads as fresh activity, then falls back to a date', () => {
    expect(relativeTime('2026-06-30T11:59:30Z', NOW)).toBe('just now');
    expect(relativeTime('2026-06-30T11:30:00Z', NOW)).toBe('30m ago');
    expect(relativeTime('2026-06-30T09:00:00Z', NOW)).toBe('3h ago');
    expect(relativeTime('2026-06-28T12:00:00Z', NOW)).toBe('2d ago');
    expect(relativeTime('2026-06-01T12:00:00Z', NOW)).toBe('1 Jun 2026');
  });
});

describe('formatDate', () => {
  it('formats a calendar date', () => {
    expect(formatDate('2026-06-12T00:00:00Z')).toBe('12 Jun 2026');
  });
});

describe('playersSummary', () => {
  it('is null with no players, so the UI shows nothing rather than "solo"', () => {
    expect(playersSummary(play())).toBeNull();
  });
  it('lists names naturally', () => {
    expect(playersSummary(play({ players: [{ displayName: 'Alice' }] }))).toBe('with Alice');
    expect(
      playersSummary(play({ players: [{ displayName: 'Alice' }, { displayName: 'Bob' }] })),
    ).toBe('with Alice and Bob');
    expect(
      playersSummary(
        play({ players: [{ displayName: 'A' }, { displayName: 'B' }, { displayName: 'C' }] }),
      ),
    ).toBe('with A, B and C');
  });
});

describe('hasReportableContent', () => {
  it('is false for a metadata-only play, so the Report link is hidden (D-55)', () => {
    expect(hasReportableContent(play())).toBe(false);
    expect(hasReportableContent(play({ players: [{ displayName: 'Alice' }], winnerNames: ['Alice'] }))).toBe(
      false,
    );
  });
  it('is true once a note or a photo is present', () => {
    expect(hasReportableContent(play({ textContent: 'great game' }))).toBe(true);
    expect(
      hasReportableContent(
        play({ content: { $type: 'at.markpub.markdown', text: { markdown: '**great** game' } } }),
      ),
    ).toBe(true);
    expect(
      hasReportableContent(
        play({
          images: [
            {
              alt: '',
              image: { $type: 'blob', ref: { $link: 'cid' }, mimeType: 'image/jpeg', size: 1 },
            },
          ],
        }),
      ),
    ).toBe(true);
  });
  it('ignores whitespace-only notes', () => {
    expect(hasReportableContent(play({ textContent: '   ' }))).toBe(false);
  });
});

describe('winnerSummary', () => {
  it('names winners or returns null', () => {
    expect(winnerSummary(play())).toBeNull();
    expect(winnerSummary(play({ winnerNames: ['Alice'] }))).toBe('Alice won');
    expect(winnerSummary(play({ winnerNames: ['Alice', 'Bob'] }))).toBe('Alice, Bob won');
  });
});

describe('misc', () => {
  it('formats a rating and pluralizes', () => {
    expect(formatRating(8)).toBe('8/10');
    expect(countNoun(1, 'play')).toBe('1 play');
    expect(countNoun(3, 'play')).toBe('3 plays');
  });
});
