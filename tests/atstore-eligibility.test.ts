import { describe, expect, it, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ listPlays: vi.fn(), listRatings: vi.fn() }));
vi.mock('../src/read/repo.js', () => ({
  pdsClient: () => ({}),
  listPlays: h.listPlays,
  listRatings: h.listRatings,
}));
// The shipped config default is ATSTORE_LISTING_URI = '' (feature dormant), which would
// force isReviewEligible to false. Supply a configured listing so the gate under test is
// the activity/reviewed logic, not the dormant-feature short-circuit.
vi.mock('../src/config.js', () => ({
  ATSTORE_LISTING_URI: 'at://did:plc:rolld/fyi.atstore.listing.detail/self',
  ATSTORE_REVIEW_MIN_ACTIVITY: 3,
}));

import {
  REVIEWED_KEY,
  countOwnActivity,
  hasReviewedLocally,
  isReviewEligible,
  markReviewedLocally,
} from '../src/atproto/atstoreEligibility.js';

function memStore(): Storage {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
    clear: () => m.clear(),
    key: () => null,
    get length() {
      return m.size;
    },
  } as Storage;
}

describe('local review memory', () => {
  it('round-trips the reviewed flag', () => {
    const s = memStore();
    expect(hasReviewedLocally(s)).toBe(false);
    markReviewedLocally(s);
    expect(hasReviewedLocally(s)).toBe(true);
    expect(s.getItem(REVIEWED_KEY)).toBe('1');
  });
});

describe('isReviewEligible', () => {
  it('is true only with enough activity and not yet reviewed', () => {
    expect(isReviewEligible({ activityCount: 3, reviewed: false })).toBe(true);
    expect(isReviewEligible({ activityCount: 2, reviewed: false })).toBe(false);
    expect(isReviewEligible({ activityCount: 9, reviewed: true })).toBe(false);
  });
});

describe('countOwnActivity', () => {
  beforeEach(() => {
    h.listPlays.mockReset();
    h.listRatings.mockReset();
  });

  it('sums play and rating record counts', async () => {
    h.listPlays.mockResolvedValue({ records: [{}, {}] });
    h.listRatings.mockResolvedValue({ records: [{}] });
    expect(await countOwnActivity('https://pds', 'did:plc:me')).toBe(3);
  });
});
