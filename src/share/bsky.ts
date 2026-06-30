/**
 * The Bluesky companion post (D-16, CC-3). Sharing is opt-in: rolld auto-drafts a
 * ≤300-grapheme `app.bsky.feed.post` linking to the entry permalink, the user edits
 * it in a modal, and on confirm we create the post and store its strongRef in the
 * entry's `bskyPostRef`. The post is about a specific entry, not the game (D-16).
 *
 * The text + facet + embed builders are pure (unit-tested, including UTF-8 byte
 * offsets — Bluesky facets index bytes, not characters). `createCompanionPost` is
 * the thin write.
 */
import type { ImageEmbed } from '../records/types.js';
import type { RolldAgent } from '../atproto/client.js';
import { BSKY_POST_LIMIT, countGraphemes, truncateGraphemes } from '../text/graphemes.js';

export interface ShareTextInput {
  /** 'Played' or 'Rated'. */
  verb: 'Played' | 'Rated';
  gameName: string;
  /** Present for ratings (and optionally a play that also carries a grade). */
  rating?: number;
  /** The per-entry permalink (handle form, D-14). */
  url: string;
}

/**
 * Auto-draft, e.g. `Played Gloomhaven — https://rolld.at/@me/play/3k`. Kept within
 * Bluesky's 300-grapheme limit (D-16): a very long game name would otherwise
 * produce an over-limit draft the user has to trim by hand. We trim the *name*
 * region (with an ellipsis) and always keep the permalink whole — the link is the
 * point of the post, and truncating it would also break the link facet.
 */
export function defaultShareText(input: ShareTextInput): string {
  const grade = input.rating ? ` ${input.rating}/10` : '';
  const prefix = `${input.verb} ${input.gameName}${grade}`;
  const suffix = ` — ${input.url}`;
  const full = `${prefix}${suffix}`;
  if (countGraphemes(full) <= BSKY_POST_LIMIT) return full;
  // Reserve room for the suffix (the link) and a one-grapheme ellipsis.
  const budget = BSKY_POST_LIMIT - countGraphemes(suffix) - 1;
  return `${truncateGraphemes(prefix, Math.max(0, budget))}…${suffix}`;
}

const encoder = new TextEncoder();
const byteLength = (s: string): number => encoder.encode(s).length;

export interface Facet {
  index: { byteStart: number; byteEnd: number };
  features: { $type: 'app.bsky.richtext.facet#link'; uri: string }[];
}

/**
 * Build link facets so the URL in the post text is a real clickable link. Offsets
 * are UTF-8 byte positions (Bluesky's requirement), computed from the actual bytes
 * preceding the URL — so emoji/accents earlier in the text don't misalign the link.
 */
export function buildLinkFacets(text: string, url: string): Facet[] {
  const charIndex = text.indexOf(url);
  if (charIndex === -1) return [];
  const byteStart = byteLength(text.slice(0, charIndex));
  const byteEnd = byteStart + byteLength(url);
  return [
    {
      index: { byteStart, byteEnd },
      features: [{ $type: 'app.bsky.richtext.facet#link', uri: url }],
    },
  ];
}

export interface BskyImagesEmbed {
  $type: 'app.bsky.embed.images';
  images: { image: ImageEmbed['image']; alt: string; aspectRatio?: ImageEmbed['aspectRatio'] }[];
}

/**
 * Reuse the play's already-uploaded blob refs to build an `app.bsky.embed.images`
 * (D-33) — no re-upload. Our `play.images` is a `defs#image[]`; Bluesky's embed is a
 * different *structure* over the same blobs, so we map field-by-field.
 */
export function buildImagesEmbed(images: ImageEmbed[]): BskyImagesEmbed | undefined {
  if (!images.length) return undefined;
  return {
    $type: 'app.bsky.embed.images',
    images: images.slice(0, 4).map((img) => ({
      image: img.image,
      alt: img.alt,
      ...(img.aspectRatio ? { aspectRatio: img.aspectRatio } : {}),
    })),
  };
}

export interface CompanionPostInput {
  text: string;
  images?: ImageEmbed[];
  now?: () => string;
}

/** Create the companion `app.bsky.feed.post` and return its strongRef for `bskyPostRef`. */
export async function createCompanionPost(
  agent: RolldAgent,
  input: CompanionPostInput,
): Promise<{ uri: string; cid: string }> {
  // Find any URL in the text to facet (the entry permalink we drafted).
  const url = input.text.match(/https?:\/\/\S+/)?.[0];
  const facets = url ? buildLinkFacets(input.text, url) : [];
  const embed = input.images ? buildImagesEmbed(input.images) : undefined;
  const record = {
    $type: 'app.bsky.feed.post',
    text: input.text,
    createdAt: (input.now ?? (() => new Date().toISOString()))(),
    ...(facets.length ? { facets } : {}),
    ...(embed ? { embed } : {}),
  };
  return await agent.createRecord('app.bsky.feed.post', record);
}
