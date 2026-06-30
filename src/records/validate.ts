/**
 * Lexicon-shape validation (Phase 2, test-hard). A lightweight guard that mirrors
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

function checkGameRef(game: GameRef | undefined, label: string, errs: string[]): void {
  if (!game || typeof game !== 'object') {
    errs.push(`${label}: missing gameRef`);
    return;
  }
  if (!game.id || game.id.length > 64) errs.push(`${label}.id: required, ≤64 chars`);
  if (!game.name || game.name.length > 512) errs.push(`${label}.name: required, ≤512 chars`);
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
  if (player.displayName && player.displayName.length > 320) {
    errs.push(`players[${i}].displayName: ≤320 chars`);
  }
}

function checkImage(image: ImageEmbed, i: number, errs: string[]): void {
  if (!image.image || image.image.$type !== 'blob') errs.push(`images[${i}].image: missing blob`);
  if (!image.alt) errs.push(`images[${i}].alt: alt text is required (D-33)`);
  if (image.alt && image.alt.length > 2000) errs.push(`images[${i}].alt: ≤2000 chars`);
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
  if (record.location && record.location.length > 500) errs.push('location: ≤500 chars');
  if (record.durationMinutes !== undefined && record.durationMinutes < 0) {
    errs.push('durationMinutes: must be ≥0');
  }
  record.winnerNames?.forEach((n, i) => {
    if (n.length > 320) errs.push(`winnerNames[${i}]: ≤320 chars`);
  });
  if (record.textContent && record.textContent.length > 100000) {
    errs.push('textContent: ≤100000 chars');
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
  if (record.textContent && record.textContent.length > 100000) {
    errs.push('textContent: ≤100000 chars');
  }
  return errs;
}

export function validateProfile(record: ProfileRecord): string[] {
  const errs: string[] = [];
  checkDatetime(record.createdAt, 'createdAt', errs);
  if (record.displayName && record.displayName.length > 320) errs.push('displayName: ≤320 chars');
  return errs;
}

/** Throw if a record is invalid — the write path's last line of defence. */
export function assertValid(errs: string[], kind: string): void {
  if (errs.length) throw new Error(`Invalid ${kind} record: ${errs.join('; ')}`);
}
