import { describe, expect, it } from 'vitest';
import { isReviewEligible } from '../src/atproto/atstoreEligibility.js';
import { ATSTORE_LISTING_URI } from '../src/config.js';

/**
 * The shipped dormant behaviour (D-59): while `ATSTORE_LISTING_URI` is empty — its
 * default until atstore approves rolld's listing — the review feature is off no matter
 * how active the reader is. This file deliberately does NOT mock config (unlike
 * atstore-eligibility.test.ts, which needs a non-empty URI to exercise the eligible
 * path), so it pins the real guard against the real default. If the listing URI is
 * ever configured, the first assertion here fails on purpose — a reminder to revisit.
 */
describe('atstore review stays dormant until the listing URI is configured', () => {
  it('ships with an empty listing URI', () => {
    expect(ATSTORE_LISTING_URI).toBe('');
  });

  it('is never eligible while the listing URI is empty, however active the reader is', () => {
    expect(isReviewEligible({ activityCount: 99, reviewed: false })).toBe(false);
  });
});
