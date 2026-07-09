/**
 * Shared link helpers (D-9, D-12, D-14). The single source of truth for every URL
 * rolld emits, so the write path and the read path can never diverge.
 *
 * ONE of these is frozen forever: `gameTargetUrl`. It produces the canonical
 * `https://rolld.at/g/<bggId>` string that each `play` and `rating` record stores
 * in its `target` field and that Constellation indexes literally (D-9). Changing
 * its format orphans every record ever written. Everything else here is ordinary,
 * reshapeable app routing (D-12).
 *
 * The Constellation `path` (`.target`, leading dot) and the Spacedust
 * `wantedSources` source (`at.rolld.play:target`, no dot) are both derived from
 * the one `TARGET_FIELD` constant, because the two services format the same field
 * differently and hand-writing them twice is exactly how they drift apart.
 */
import { COLLECTION, ORIGIN, RPG_ACTOR_URL } from './config.js';
import type { GameRef } from './records/types.js';

/** The record field that holds the canonical game URL. Frozen (D-9). */
export const TARGET_FIELD = 'target';

/** Constellation's json-path to the link field — leading dot (microcosm-apis.md). */
export const CONSTELLATION_PATH = `.${TARGET_FIELD}`;

/** Spacedust `wantedSources` for new plays — `<collection>:<path-without-dot>`. */
export const SPACEDUST_PLAY_SOURCE = `${COLLECTION.play}:${TARGET_FIELD}`;

/**
 * THE FROZEN URL (D-9). The canonical per-game target that Constellation matches
 * literally. Emitted from here and nowhere else, on both the write and read sides.
 * Accepts a `gameRef` or a bare id so callers don't reshape data just to build it.
 */
export function gameTargetUrl(game: GameRef | { id: string } | string): string {
  const id = typeof game === 'string' ? game : game.id;
  return `${ORIGIN}/g/${id}`;
}

/** Inverse of `gameTargetUrl`: pull the BGG id back out of a target URL, or null. */
export function parseGameTarget(url: string): string | null {
  const prefix = `${ORIGIN}/g/`;
  if (!url.startsWith(prefix)) return null;
  const id = url.slice(prefix.length);
  return id.length > 0 && !id.includes('/') ? id : null;
}

/* ---- mutable app routes (D-12): reshape freely; never stored, never indexed ---- */

export type EntryKind = 'play' | 'rating';

/** The game page path (also the frozen-target pathname, but used here for nav). */
export const gamePath = (id: string): string => `/g/${id}`;
export const gamePlaysPath = (id: string): string => `/g/${id}/plays`;
export const profilePath = (handle: string): string => `/@${handle}`;
export const playsPath = (handle: string): string => `/@${handle}/plays`;
export const userGamePath = (handle: string, id: string): string => `/@${handle}/g/${id}`;
export const searchPath = (q: string): string => `/search?q=${encodeURIComponent(q)}`;

/** A person's rpg.actor profile — same `/@handle` shape as rolld's own (D-60). */
export const rpgActorProfileUrl = (handle: string): string => `${RPG_ACTOR_URL}/@${handle}`;

/** Per-entry permalink path — handle form (the shared/default form, D-14). */
export const entryPath = (handle: string, kind: EntryKind, rkey: string): string =>
  `/@${handle}/${kind}/${rkey}`;

/** Per-entry permalink path — durable DID fallback (never rots, D-14). */
export const didEntryPath = (did: string, kind: EntryKind, rkey: string): string =>
  `/did/${did}/${kind}/${rkey}`;

/**
 * Absolute per-entry permalink (handle form) — what a shared Bluesky post links to
 * (D-16). Cosmetic handle, resolved through the DID on read (D-14).
 */
export const entryUrl = (handle: string, kind: EntryKind, rkey: string): string =>
  `${ORIGIN}${entryPath(handle, kind, rkey)}`;

/** Absolute per-entry permalink (durable DID form) — "copy permanent link". */
export const didEntryUrl = (did: string, kind: EntryKind, rkey: string): string =>
  `${ORIGIN}${didEntryPath(did, kind, rkey)}`;
