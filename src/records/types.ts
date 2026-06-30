/**
 * TypeScript mirrors of the `at.rolld.*` lexicons (Phase 0). These are the record
 * shapes the write path produces and the read path consumes. They intentionally
 * carry ONLY the user's own data (D-5): no catalog metadata, no derived counts.
 *
 * Keep these in lockstep with `lexicons/at/rolld/*.json` — the lexicon is the
 * source of truth, these are its typed reflection.
 */

/** atproto blob ref, as returned by `uploadBlob` and embedded by reference. */
export interface BlobRef {
  $type: 'blob';
  ref: { $link: string };
  mimeType: string;
  size: number;
}

/** `com.atproto.repo.strongRef` — a uri+cid pointer (the Bluesky companion post). */
export interface StrongRef {
  uri: string;
  cid: string;
}

/** `at.rolld.defs#gameRef` — BGG id + a denormalized name snapshot (D-7, D-32). */
export interface GameRef {
  id: string;
  name: string;
  yearPublished?: number;
}

/** `at.rolld.defs#player` — a co-player by DID and/or plain name (D-15). */
export interface Player {
  did?: string;
  displayName?: string;
  score?: number;
}

/** `at.rolld.defs#aspectRatio`. */
export interface AspectRatio {
  width: number;
  height: number;
}

/** `at.rolld.defs#image` — a play photo blob embedded by ref (D-33). */
export interface ImageEmbed {
  image: BlobRef;
  alt: string;
  aspectRatio?: AspectRatio;
}

/**
 * The note `content` union member — markpub Markdown (D-11). The raw markdown
 * lives in the nested `text` object (`at.markpub.text`); `flavor` is optional.
 * (Shape per the live markpub schema; re-confirm before relying on interop.)
 */
export interface MarkdownNote {
  $type: 'at.markpub.markdown';
  text: { markdown: string };
  flavor?: 'gfm' | 'commonmark';
}

/** Fields shared by the play and rating note model (D-11). */
export interface NoteFields {
  content?: MarkdownNote;
  textContent?: string;
  bskyPostRef?: StrongRef;
}

/** `at.rolld.play` record value. */
export interface PlayRecord extends NoteFields {
  $type: 'at.rolld.play';
  game: GameRef;
  /** The frozen canonical game URL (D-9). Built only via `gameTargetUrl`. */
  target: string;
  playedAt: string;
  createdAt: string;
  players?: Player[];
  winnerDids?: string[];
  winnerNames?: string[];
  expansions?: GameRef[];
  location?: string;
  durationMinutes?: number;
  images?: ImageEmbed[];
}

/** `at.rolld.rating` record value (rkey = the BGG id). */
export interface RatingRecord extends NoteFields {
  $type: 'at.rolld.rating';
  game: GameRef;
  /** Same frozen target as play, so ratings are Constellation-discoverable (D-39). */
  target: string;
  rating: number;
  createdAt: string;
}

/** `at.rolld.profile` record value (rkey = `self`) — the participation declaration (D-25). */
export interface ProfileRecord {
  $type: 'at.rolld.profile';
  displayName?: string;
  createdAt: string;
}
