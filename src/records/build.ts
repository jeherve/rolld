/**
 * Pure builders that turn UI input into lexicon-valid `at.rolld.*` record values.
 * They are the single place the canonical `target` is attached (via the
 * shared `gameTargetUrl` helper, D-9) and the only place the note model is
 * assembled (markpub `content` + plain `textContent`, D-11). No network, no
 * atcute — so they unit-test against exact expected shapes.
 *
 * `now` is injectable so tests are deterministic and the clock stays a parameter,
 * not a hidden dependency.
 */
import { gameTargetUrl } from '../links.js';
import { markdownToPlain } from '../text/markdown.js';
import type {
  GameRef,
  ImageEmbed,
  MarkdownNote,
  NoteFields,
  PlayRecord,
  Player,
  ProfileRecord,
  RatingRecord,
  StrongRef,
} from './types.js';

const nowIso = (): string => new Date().toISOString();

/** Build the note fields from raw Markdown — omitted entirely when blank (D-11). */
export function buildNote(
  markdown: string | undefined,
  opts: { flavor?: 'gfm' | 'commonmark'; bskyPostRef?: StrongRef } = {},
): NoteFields {
  const fields: NoteFields = {};
  const trimmed = markdown?.trim();
  if (trimmed) {
    const content: MarkdownNote = {
      $type: 'at.markpub.markdown',
      text: { markdown: trimmed },
      flavor: opts.flavor ?? 'gfm',
    };
    fields.content = content;
    fields.textContent = markdownToPlain(trimmed);
  }
  if (opts.bskyPostRef) fields.bskyPostRef = opts.bskyPostRef;
  return fields;
}

export interface PlayInput {
  game: GameRef;
  /** Defaults to `now` if the user is logging a fresh play. */
  playedAt?: string;
  players?: Player[];
  winnerDids?: string[];
  winnerNames?: string[];
  expansions?: GameRef[];
  location?: string;
  durationMinutes?: number;
  images?: ImageEmbed[];
  note?: string;
  noteFlavor?: 'gfm' | 'commonmark';
  bskyPostRef?: StrongRef;
  now?: () => string;
}

/** Build an `at.rolld.play` record value. Empty optional arrays/strings are omitted. */
export function buildPlayRecord(input: PlayInput): PlayRecord {
  const createdAt = (input.now ?? nowIso)();
  const record: PlayRecord = {
    $type: 'at.rolld.play',
    game: input.game,
    target: gameTargetUrl(input.game),
    playedAt: input.playedAt ?? createdAt,
    createdAt,
  };
  if (input.players?.length) record.players = input.players;
  if (input.winnerDids?.length) record.winnerDids = input.winnerDids;
  if (input.winnerNames?.length) record.winnerNames = input.winnerNames;
  if (input.expansions?.length) record.expansions = input.expansions;
  if (input.location?.trim()) record.location = input.location.trim();
  if (typeof input.durationMinutes === 'number') record.durationMinutes = input.durationMinutes;
  if (input.images?.length) record.images = input.images.slice(0, 4);
  Object.assign(
    record,
    buildNote(input.note, {
      ...(input.noteFlavor ? { flavor: input.noteFlavor } : {}),
      ...(input.bskyPostRef ? { bskyPostRef: input.bskyPostRef } : {}),
    }),
  );
  return record;
}

export interface RatingInput {
  game: GameRef;
  rating: number;
  note?: string;
  noteFlavor?: 'gfm' | 'commonmark';
  bskyPostRef?: StrongRef;
  now?: () => string;
}

/**
 * Build an `at.rolld.rating` record value plus its rkey (= the BGG id), so
 * re-rating the same game overwrites in place rather than duplicating (D-9).
 */
export function buildRatingRecord(input: RatingInput): { rkey: string; record: RatingRecord } {
  const record: RatingRecord = {
    $type: 'at.rolld.rating',
    game: input.game,
    target: gameTargetUrl(input.game),
    rating: input.rating,
    createdAt: (input.now ?? nowIso)(),
  };
  Object.assign(
    record,
    buildNote(input.note, {
      ...(input.noteFlavor ? { flavor: input.noteFlavor } : {}),
      ...(input.bskyPostRef ? { bskyPostRef: input.bskyPostRef } : {}),
    }),
  );
  return { rkey: input.game.id, record };
}

/** Build the `at.rolld.profile` participation declaration (rkey = `self`, D-25). */
export function buildProfileRecord(
  opts: { displayName?: string; now?: () => string } = {},
): ProfileRecord {
  const record: ProfileRecord = {
    $type: 'at.rolld.profile',
    createdAt: (opts.now ?? nowIso)(),
  };
  if (opts.displayName?.trim()) record.displayName = opts.displayName.trim();
  return record;
}
