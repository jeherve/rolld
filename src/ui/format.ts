/**
 * Pure display formatters for the UI (Phase 4). Kept out of the view functions so
 * the fiddly bits — relative time, player summaries, grades — are unit-tested and
 * the views stay about layout. The voice is plain and direct (design-system): "with
 * Alice and Bob", "solo", "8/10".
 */
import type { Player, PlayRecord } from '../records/types.js';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "12 Jun 2026" — the calendar form used once a play is more than a week old. */
export function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** Relative time for fresh activity, falling back to the date for older plays. */
export function relativeTime(iso: string, now: number = Date.now()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diff = now - then;
  if (diff < MINUTE) return 'just now';
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)}m ago`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)}h ago`;
  if (diff < 7 * DAY) return `${Math.floor(diff / DAY)}d ago`;
  return formatDate(iso);
}

/** A player's display label: their name, or a shortened DID if that's all we have. */
export function playerLabel(player: Player): string {
  if (player.displayName) return player.displayName;
  if (player.did) return player.did.replace(/^did:plc:/, '@');
  return 'someone';
}

/** "with Alice and Bob", "with Alice, Bob and Cara", or "solo" when no one's tagged. */
export function playersSummary(play: PlayRecord): string {
  const names = (play.players ?? []).map(playerLabel);
  if (names.length === 0) return 'solo';
  if (names.length === 1) return `with ${names[0]}`;
  if (names.length === 2) return `with ${names[0]} and ${names[1]}`;
  return `with ${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** A grade as "8/10". */
export function formatRating(rating: number): string {
  return `${rating}/10`;
}

/** Simple count + noun, pluralized: "1 play", "3 plays". */
export function countNoun(n: number, singular: string, plural = `${singular}s`): string {
  return `${n} ${n === 1 ? singular : plural}`;
}

/** The grade(s) recorded on a play, if any winner was named. */
export function winnerSummary(play: PlayRecord): string | null {
  const names = [
    ...(play.winnerNames ?? []),
    ...(play.winnerDids ?? []).map((d) => d.replace(/^did:plc:/, '@')),
  ];
  if (names.length === 0) return null;
  if (names.length === 1) return `${names[0]} won`;
  return `${names.join(', ')} won`;
}
