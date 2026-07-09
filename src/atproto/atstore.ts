/**
 * atstore.fyi review writes (D-59). rolld's `transition:generic` login already
 * authorizes writing arbitrary collections to the user's own repo, so a review is
 * just two `createRecord`/`putRecord` calls — no extra OAuth client or scope. The
 * records live in the *external* `fyi.atstore.*` namespace but are the user's own
 * authored data (D-5). Dormant until `ATSTORE_LISTING_URI` is configured.
 */
import { ATSTORE_LISTING_URI } from '../config.js';
import type { RolldAgent } from './client.js';

export const ATSTORE_REVIEW_COLLECTION = 'fyi.atstore.listing.review';
export const ATSTORE_PROFILE_COLLECTION = 'fyi.atstore.profile';
const PROFILE_RKEY = 'self';

const nowIso = (): string => new Date().toISOString();

export interface AtstoreReviewRecord {
  $type: 'fyi.atstore.listing.review';
  subject: string;
  rating: number;
  createdAt: string;
  text?: string;
}

interface ReviewInput {
  rating: number;
  text?: string;
  subject: string;
  now?: () => string;
}

/** Build a `fyi.atstore.listing.review` value. Pure; throws on invalid input. */
export function buildReviewRecord(input: ReviewInput): AtstoreReviewRecord {
  if (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5) {
    throw new Error('rating must be an integer from 1 to 5');
  }
  if (!input.subject) {
    throw new Error('review subject (listing URI) is required');
  }
  const record: AtstoreReviewRecord = {
    $type: 'fyi.atstore.listing.review',
    subject: input.subject,
    rating: input.rating,
    createdAt: (input.now ?? nowIso)(),
  };
  const text = input.text?.trim().slice(0, 8000);
  if (text) record.text = text;
  return record;
}

/** Ensure the user's `fyi.atstore.profile` self record exists (create-once). */
export async function ensureAtstoreProfile(agent: RolldAgent, displayName: string): Promise<void> {
  const existing = await agent.getRecord<unknown>(ATSTORE_PROFILE_COLLECTION, PROFILE_RKEY);
  if (existing) return;
  await agent.putRecord(ATSTORE_PROFILE_COLLECTION, PROFILE_RKEY, {
    $type: 'fyi.atstore.profile',
    displayName: displayName.slice(0, 640) || agent.did,
  });
}

/**
 * Publish a review of rolld to the user's PDS. `subject` defaults to the configured
 * listing URI; tests may override it. Throws if no listing URI is available.
 */
export async function submitAtstoreReview(
  agent: RolldAgent,
  input: { rating: number; text?: string; displayName?: string; subject?: string },
): Promise<{ uri: string; cid: string }> {
  const subject = input.subject ?? ATSTORE_LISTING_URI;
  if (!subject) throw new Error('atstore listing is not configured yet');
  const record = buildReviewRecord({
    rating: input.rating,
    ...(input.text ? { text: input.text } : {}),
    subject,
  });
  await ensureAtstoreProfile(agent, input.displayName ?? agent.did);
  return agent.createRecord(ATSTORE_REVIEW_COLLECTION, record);
}
