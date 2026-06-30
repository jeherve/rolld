/**
 * Lexicon-shape validation (test-hard). A lightweight guard that mirrors
 * the constraints in `lexicons/at/rolld/*.json`, run before any write so a
 * malformed record never reaches the PDS. It is NOT a full lexicon engine — it
 * checks exactly the constraints rolld depends on, including the one that matters
 * most: that a record's `target` is the canonical frozen URL for its own `gameRef`
 * (D-9). If those ever diverge, every Constellation read silently breaks — so this
 * catches it at the source.
 *
 * Each validator returns a list of human-readable problems; empty means valid.
 */
import { gameTargetUrl } from '../links.js';
import type { GameRef, ImageEmbed, PlayRecord, Player, ProfileRecord, RatingRecord } from './types.js';

const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

/**
 * atproto lexicon `maxLength` is a UTF-8 BYTE limit, not a JS `String.length`
 * (UTF-16 code-unit) count. The two diverge for any non-ASCII text: a 500-CJK-char
 * note is 500 code units but ~1500 bytes. Measuring code units lets an over-limit
 * record pass this guard and then get rejected by the PDS with an opaque error —
 * exactly the "malformed record never reaches the PDS" promise this file makes.
 * So we measure bytes, the way the PDS does.
 */
const byteLen = (s: string): number => new TextEncoder().encode(s).length;

function checkGameRef(game: GameRef | undefined, label: string, errs: string[]): void {
  if (!game || typeof game !== 'object') {
    errs.push(`${label}: missing gameRef`);
    return;
  }
  if (!game.id || byteLen(game.id) > 64) errs.push(`${label}.id: required, ≤64 bytes`);
  if (!game.name || byteLen(game.name) > 512) errs.push(`${label}.name: required, ≤512 bytes`);
  if (game.yearPublished !== undefined && !Number.isInteger(game.yearPublished)) {
    errs.push(`${label}.yearPublished: must be an integer`);
  }
}

function checkTarget(record: { game?: GameRef; target?: string }, errs: string[]): void {
  if (!record.game) return; // gameRef error already reported
  const expected = gameTargetUrl(record.game);
  if (record.target !== expected) {
    errs.push(`target must equal ${expected} (got ${record.target ?? 'undefined'})`);
  }
}

function checkDatetime(value: string | undefined, label: string, errs: string[]): void {
  if (!value) errs.push(`${label}: required`);
  else if (!ISO_DATETIME.test(value)) errs.push(`${label}: not an ISO datetime`);
}

function checkPlayer(player: Player, i: number, errs: string[]): void {
  if (!player.did && !player.displayName) {
    errs.push(`players[${i}]: needs a did or a displayName`);
  }
  if (player.displayName && byteLen(player.displayName) > 320) {
    errs.push(`players[${i}].displayName: ≤320 bytes`);
  }
  if (player.score !== undefined && !Number.isInteger(player.score)) {
    errs.push(`players[${i}].score: must be an integer`);
  }
}

function checkImage(image: ImageEmbed, i: number, errs: string[]): void {
  if (!image.image || image.image.$type !== 'blob') errs.push(`images[${i}].image: missing blob`);
  if (!image.alt) errs.push(`images[${i}].alt: alt text is required (D-33)`);
  if (image.alt && byteLen(image.alt) > 2000) errs.push(`images[${i}].alt: ≤2000 bytes`);
}

export function validatePlay(record: PlayRecord): string[] {
  const errs: string[] = [];
  checkGameRef(record.game, 'game', errs);
  checkTarget(record, errs);
  checkDatetime(record.playedAt, 'playedAt', errs);
  checkDatetime(record.createdAt, 'createdAt', errs);
  record.players?.forEach((p, i) => checkPlayer(p, i, errs));
  record.expansions?.forEach((g, i) => checkGameRef(g, `expansions[${i}]`, errs));
  if (record.images && record.images.length > 4) errs.push('images: at most 4 (D-33)');
  record.images?.forEach((img, i) => checkImage(img, i, errs));
  if (record.location && byteLen(record.location) > 500) errs.push('location: ≤500 bytes');
  if (record.durationMinutes !== undefined) {
    if (!Number.isInteger(record.durationMinutes)) errs.push('durationMinutes: must be an integer');
    else if (record.durationMinutes < 0) errs.push('durationMinutes: must be ≥0');
  }
  record.winnerNames?.forEach((n, i) => {
    if (byteLen(n) > 320) errs.push(`winnerNames[${i}]: ≤320 bytes`);
  });
  if (record.textContent && byteLen(record.textContent) > 100000) {
    errs.push('textContent: ≤100000 bytes');
  }
  return errs;
}

export function validateRating(record: RatingRecord): string[] {
  const errs: string[] = [];
  checkGameRef(record.game, 'game', errs);
  checkTarget(record, errs);
  if (!Number.isInteger(record.rating) || record.rating < 1 || record.rating > 10) {
    errs.push('rating: integer 1–10');
  }
  checkDatetime(record.createdAt, 'createdAt', errs);
  if (record.textContent && byteLen(record.textContent) > 100000) {
    errs.push('textContent: ≤100000 bytes');
  }
  return errs;
}

export function validateProfile(record: ProfileRecord): string[] {
  const errs: string[] = [];
  checkDatetime(record.createdAt, 'createdAt', errs);
  if (record.displayName && byteLen(record.displayName) > 320) errs.push('displayName: ≤320 bytes');
  return errs;
}

/** Throw if a record is invalid — the write path's last line of defence. */
export function assertValid(errs: string[], kind: string): void {
  if (errs.length) throw new Error(`Invalid ${kind} record: ${errs.join('; ')}`);
}
