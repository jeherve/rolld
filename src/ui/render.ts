/**
 * Small reusable view pieces — avatars, game covers, grade badges, the
 * report link, and the async-region helper every data page uses. They return
 * `SafeHtml` (escape-by-default) so pages compose them without thinking about XSS.
 * BGG covers fall back to the game's name snapshot immediately (D-32/CC-5): a row
 * never blocks on an image.
 */
import type { GameMetadata } from '../bgg/types.js';
import { ABUSE_EMAIL, API_BASE } from '../config.js';
import { gamePath, profilePath } from '../links.js';
import type { ImageEmbed } from '../records/types.js';
import { html, render, type SafeHtml } from './html.js';

/** Photo blob URL — served through the Worker so the moderation blob-refuse applies (D-41). */
export function blobUrl(did: string, cid: string): string {
  return `${API_BASE}/api/blob/${encodeURIComponent(did)}/${encodeURIComponent(cid)}`;
}

/**
 * Render a play's photos, defended against malformed records. Image embeds arrive
 * from other users' PDSes (cast with no runtime check), so an embed could be
 * missing its blob ref entirely — dereferencing `img.image.ref.$link` blindly
 * would throw and take down the whole entry/card render. We pull the CID safely and
 * drop any embed that lacks a usable one. `big` selects the larger entry layout.
 */
export function playPhotos(
  images: ImageEmbed[] | undefined,
  did: string,
  big = false,
): SafeHtml | null {
  if (!images?.length) return null;
  const usable = images
    .slice(0, 4)
    .map((img) => {
      const cid = img.image?.ref?.$link;
      return { cid: typeof cid === 'string' ? cid : '', alt: typeof img.alt === 'string' ? img.alt : '' };
    })
    .filter((p) => p.cid.length > 0);
  if (!usable.length) return null;
  return html`<div class="${big ? 'photos big' : 'photos'}">
    ${usable.map(
      (p) => html`<img class="photo" src="${blobUrl(did, p.cid)}" alt="${p.alt}" loading="lazy" />`,
    )}
  </div>`;
}

/** A circular-ish avatar (pixel square, per the theme), or a neutral placeholder. */
export function avatar(url: string | undefined, alt: string, size = 40): SafeHtml {
  if (!url) return html`<span class="avatar ph" style="width:${size}px;height:${size}px" aria-hidden="true"></span>`;
  return html`<img class="avatar" src="${url}" alt="${alt}" width="${size}" height="${size}" loading="lazy" />`;
}

/**
 * A game cover/thumbnail; until BGG metadata loads, show the name snapshot (CC-5).
 * `fill` mode drops the fixed pixel size and lets the cover fill its tile (the
 * gallery grids), so a whole grid reads as uniform box art rather than tiny icons.
 */
export function gameCover(
  name: string,
  meta: GameMetadata | null,
  size = 56,
  opts: { fill?: boolean } = {},
): SafeHtml {
  // Fill tiles are large, so reach for BGG's full-res image; the small inline
  // covers stay on the lighter thumbnail (D-35: don't pull big images for a 56px icon).
  const src = opts.fill ? (meta?.image ?? meta?.thumbnail) : (meta?.thumbnail ?? meta?.image);
  const cls = opts.fill ? 'cover fill' : 'cover';
  if (src) {
    return opts.fill
      ? html`<img class="${cls}" src="${src}" alt="${name}" loading="lazy" />`
      : html`<img class="${cls}" src="${src}" alt="${name}" width="${size}" height="${size}" loading="lazy" />`;
  }
  return opts.fill
    ? html`<span class="${cls} ph" aria-hidden="true">${name.slice(0, 2)}</span>`
    : html`<span class="cover ph" style="width:${size}px;height:${size}px" aria-hidden="true">${name.slice(0, 2)}</span>`;
}

/** A grade badge, "8/10", in the sea-green secondary so it reads as a distinct signal. */
export function gradeBadge(rating: number): SafeHtml {
  return html`<span class="grade mono">${rating}/10</span>`;
}

/** A link to a game page. */
export function gameLink(id: string, name: string): SafeHtml {
  return html`<a href="${gamePath(id)}" data-link>${name}</a>`;
}

/** A link to a person's profile by handle. */
export function profileLink(handle: string, label?: string): SafeHtml {
  return html`<a href="${profilePath(handle)}" data-link>${label ?? `@${handle}`}</a>`;
}

/** The unobtrusive report affordance on every item (CC-8, D-41). */
export function reportLink(itemUri: string): SafeHtml {
  const subject = encodeURIComponent('Reporting content on rolld');
  const body = encodeURIComponent(`I'd like to report this item:\n${itemUri}\n\nWhat's wrong:\n`);
  return html`<a class="report mono" href="mailto:${ABUSE_EMAIL}?subject=${subject}&body=${body}">⚐ Report</a>`;
}

/** Section heading used across pages. */
export function sectionTitle(text: string): SafeHtml {
  return html`<h2 class="section">${text}</h2>`;
}

/**
 * Render a loading state immediately, then run `load` and render its result (or a
 * themed error, CC-5). The pattern every network-backed page uses so the user never
 * sees a blank screen that looks "done".
 */
export async function asyncRegion(
  target: Element,
  loading: SafeHtml,
  load: () => Promise<SafeHtml>,
  onError: (err: unknown) => SafeHtml,
): Promise<void> {
  render(target, loading);
  try {
    render(target, await load());
  } catch (err) {
    render(target, onError(err));
  }
}
