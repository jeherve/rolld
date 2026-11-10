/**
 * Single-colour marks that need to tint live here, inlined, for `currentColor` (D-52).
 * Full-colour marks (the author's pixel face, the BGG logo) do NOT — they stay static
 * files referenced as <img> from the footer.
 */
import { raw, type SafeHtml } from './html.js';

/**
 * External-link glyph — a small box-with-arrow shown after links that leave rolld
 * (YouTube, BoardGameGeek). Stroked with `currentColor` so it tints with the link
 * text; `aria-hidden` because the surrounding link text already says where it goes.
 */
export const externalMark: SafeHtml = raw(
  `<svg class="external-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><path d="M15 3h6v6"/><path d="M10 14 21 3"/></svg>`,
);
