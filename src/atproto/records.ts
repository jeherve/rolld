/**
 * High-level write operations — the bridge from UI intent to the PDS.
 * Each composes the pure builder (shape + frozen target), the shape validator (the
 * last guard before a write), and the `RolldAgent` (the XRPC call). Every first
 * write also ensures the `profile` participation declaration exists (D-25), so a
 * user becomes discoverable to their friends the moment they log anything.
 */
import { COLLECTION, PROFILE_RKEY } from '../config.js';
import {
  buildPlayRecord,
  buildProfileRecord,
  buildRatingRecord,
  type PlayInput,
  type RatingInput,
} from '../records/build.js';
import type { ProfileRecord } from '../records/types.js';
import { assertValid, validatePlay, validateProfile, validateRating } from '../records/validate.js';
import type { RolldAgent } from './client.js';

export interface WrittenEntry {
  uri: string;
  cid: string;
  rkey: string;
}

/** The rkey is the last path segment of an at-uri (`at://did/collection/rkey`). */
export function rkeyFromUri(uri: string): string {
  return uri.slice(uri.lastIndexOf('/') + 1);
}

/**
 * Ensure the user's `profile` record exists (D-25). Created silently on first write;
 * never overwrites an existing one (so its original `createdAt` is preserved).
 */
export async function ensureProfile(agent: RolldAgent, displayName?: string): Promise<void> {
  const existing = await agent.getRecord<ProfileRecord>(COLLECTION.profile, PROFILE_RKEY);
  if (existing) return;
  const record = buildProfileRecord(displayName ? { displayName } : {});
  assertValid(validateProfile(record), 'profile');
  await agent.putRecord(COLLECTION.profile, PROFILE_RKEY, record);
}

/** Log a play: validate, ensure the profile, write the record (PDS assigns the rkey). */
export async function writePlay(agent: RolldAgent, input: PlayInput): Promise<WrittenEntry> {
  const record = buildPlayRecord(input);
  assertValid(validatePlay(record), 'play');
  await ensureProfile(agent);
  const { uri, cid } = await agent.createRecord(COLLECTION.play, record);
  return { uri, cid, rkey: rkeyFromUri(uri) };
}

/** Rate a game: rkey = the BGG id, so re-rating overwrites in place (D-9). */
export async function writeRating(agent: RolldAgent, input: RatingInput): Promise<WrittenEntry> {
  const { rkey, record } = buildRatingRecord(input);
  assertValid(validateRating(record), 'rating');
  await ensureProfile(agent);
  const { uri, cid } = await agent.putRecord(COLLECTION.rating, rkey, record);
  return { uri, cid, rkey };
}

export const deletePlay = (agent: RolldAgent, rkey: string): Promise<void> =>
  agent.deleteRecord(COLLECTION.play, rkey);

export const deleteRating = (agent: RolldAgent, rkey: string): Promise<void> =>
  agent.deleteRecord(COLLECTION.rating, rkey);

/** Opt out of rolld (D-25): delete the participation declaration; records remain on the PDS. */
export const deleteProfile = (agent: RolldAgent): Promise<void> =>
  agent.deleteRecord(COLLECTION.profile, PROFILE_RKEY);
