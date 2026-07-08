import { describe, expect, it } from 'vitest';
import type { RolldAgent } from '../src/atproto/client.js';
import {
  ATSTORE_PROFILE_COLLECTION,
  ATSTORE_REVIEW_COLLECTION,
  buildReviewRecord,
  submitAtstoreReview,
} from '../src/atproto/atstore.js';

const SUBJECT = 'at://did:plc:store/fyi.atstore.listing.detail/abc';
const at = () => '2026-07-09T00:00:00.000Z';

/** A fake agent recording calls; getRecord returns whatever we seed. */
function fakeAgent(profile: unknown = null) {
  const calls: Record<string, unknown[]> = { create: [], put: [], get: [] };
  const agent = {
    did: 'did:plc:me',
    async getRecord(collection: string, rkey: string) {
      calls.get!.push([collection, rkey]);
      return profile;
    },
    async createRecord(collection: string, record: unknown) {
      calls.create!.push([collection, record]);
      return { uri: `at://did:plc:me/${collection}/3kgen`, cid: 'cid1' };
    },
    async putRecord(collection: string, rkey: string, record: unknown) {
      calls.put!.push([collection, rkey, record]);
      return { uri: `at://did:plc:me/${collection}/${rkey}`, cid: 'cid2' };
    },
  };
  return { agent: agent as unknown as RolldAgent, calls };
}

describe('buildReviewRecord', () => {
  it('shapes a stars-only review (no text)', () => {
    const r = buildReviewRecord({ rating: 4, subject: SUBJECT, now: at });
    expect(r).toEqual({
      $type: 'fyi.atstore.listing.review',
      subject: SUBJECT,
      rating: 4,
      createdAt: at(),
    });
    expect('text' in r).toBe(false);
  });

  it('includes trimmed text when present', () => {
    const r = buildReviewRecord({ rating: 5, text: '  love it  ', subject: SUBJECT, now: at });
    expect(r.text).toBe('love it');
  });

  it('omits text that is empty after trim', () => {
    const r = buildReviewRecord({ rating: 5, text: '   ', subject: SUBJECT, now: at });
    expect('text' in r).toBe(false);
  });

  it.each([0, 6, 2.5, -1])('rejects out-of-range/non-integer rating %s', (rating) => {
    expect(() => buildReviewRecord({ rating, subject: SUBJECT, now: at })).toThrow();
  });

  it('rejects an empty subject', () => {
    expect(() => buildReviewRecord({ rating: 3, subject: '', now: at })).toThrow();
  });
});

describe('submitAtstoreReview', () => {
  it('creates the atstore profile when absent, then the review', async () => {
    const { agent, calls } = fakeAgent(null);
    const res = await submitAtstoreReview(agent, {
      rating: 5,
      text: 'great',
      displayName: 'Jem',
      subject: SUBJECT,
    });
    // profile created (put, self), review created (create)
    expect((calls.put![0] as unknown[])[0]).toBe(ATSTORE_PROFILE_COLLECTION);
    expect((calls.put![0] as unknown[])[1]).toBe('self');
    expect((calls.create![0] as unknown[])[0]).toBe(ATSTORE_REVIEW_COLLECTION);
    expect(res.uri).toContain(ATSTORE_REVIEW_COLLECTION);
  });

  it('skips profile creation when it already exists', async () => {
    const { agent, calls } = fakeAgent({ $type: 'fyi.atstore.profile', displayName: 'x' });
    await submitAtstoreReview(agent, { rating: 4, displayName: 'Jem', subject: SUBJECT });
    expect(calls.put).toHaveLength(0);
    expect(calls.create).toHaveLength(1);
  });

  it('throws when no listing URI is configured', async () => {
    const { agent } = fakeAgent(null);
    await expect(submitAtstoreReview(agent, { rating: 3, displayName: 'Jem' })).rejects.toThrow();
  });
});
