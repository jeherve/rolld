/**
 * Deciding whether to offer the atstore review item, and remembering that a user has
 * already reviewed (per-device, D-59). Eligibility = the listing is configured AND the
 * user has some real activity AND they haven't reviewed yet.
 */
import { ATSTORE_LISTING_URI, ATSTORE_REVIEW_MIN_ACTIVITY } from '../config.js';
import { listPlays, listRatings, pdsClient } from '../read/repo.js';

export const REVIEWED_KEY = 'rolld:atstore-reviewed';

const store = (s?: Storage): Storage => s ?? localStorage;

export function hasReviewedLocally(s?: Storage): boolean {
  return store(s).getItem(REVIEWED_KEY) === '1';
}

export function markReviewedLocally(s?: Storage): void {
  store(s).setItem(REVIEWED_KEY, '1');
}

/** Pure gate. `ATSTORE_LISTING_URI` empty ⇒ never eligible (feature dormant). */
export function isReviewEligible(opts: { activityCount: number; reviewed: boolean }): boolean {
  return (
    Boolean(ATSTORE_LISTING_URI) &&
    !opts.reviewed &&
    opts.activityCount >= ATSTORE_REVIEW_MIN_ACTIVITY
  );
}

/** Count the user's own plays + ratings, each capped (we only need to reach the bar). */
export async function countOwnActivity(
  pds: string,
  did: string,
  cap: number = ATSTORE_REVIEW_MIN_ACTIVITY,
): Promise<number> {
  const client = pdsClient(pds);
  const [plays, ratings] = await Promise.all([
    listPlays(client, did, { limit: cap }),
    listRatings(client, did, { limit: cap }),
  ]);
  return plays.records.length + ratings.records.length;
}
