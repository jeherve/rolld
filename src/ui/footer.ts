import { AUTHOR_PROFILE_URL, BGG_URL } from '../config.js';
import { html, type SafeHtml } from './html.js';

/**
 * Shared footer — the family "made by" signature (D-29, D-64): an About link into
 * rolld's own story and the author's pixel face (→ the author). The face is a family
 * asset, copied verbatim and never restyled into the rose theme. It's a full-colour
 * pixel portrait that must NOT be tinted and is a heavy asset, so it's served as a static
 * `/jeremy-herve.svg` (kept out of the JS bundle, cached on its own) and lazy-loaded,
 * since the footer sits below the fold (D-52).
 *
 * The BGG mark is a second <img> here, and for the same reasons as the face (D-52): it's a
 * full-colour asset that must keep its own colours (no `currentColor` tint) and is served
 * static from `/powered-by-bgg.svg`. It also earns its place — BGG's licence requires the
 * credit, linked back to BoardGameGeek, on every page that shows their data (D-31, D-53).
 * The footer is global, so one placement covers the whole app. The glyph is BGG's compact
 * white mark (legible on the dark chrome); the "Powered by" wording the licence asks for
 * rides on the link's `title`/`alt`, not the image (D-53).
 */
export function renderFooter(): SafeHtml {
  return html`
    <footer class="status">
      <span>Your games, your account, the open web.</span>
      <a href="/about" data-link>About</a>
      <span class="spacer"></span>
      <a
        class="iconlink bgg-credit"
        href="${BGG_URL}"
        target="_blank"
        rel="noopener noreferrer"
        title="Powered by BoardGameGeek"
        aria-label="Powered by BoardGameGeek"
      >
        <img
          class="bgg-logo"
          src="/powered-by-bgg.svg"
          alt="Powered by BGG"
          width="80"
          height="38"
          loading="lazy"
          decoding="async"
        />
      </a>
      <a
        class="iconlink"
        href="${AUTHOR_PROFILE_URL}"
        target="_blank"
        rel="noopener noreferrer"
        title="Jeremy Herve"
        aria-label="The author, Jeremy Herve"
      >
        <img
          class="avatar"
          src="/jeremy-herve.svg"
          alt=""
          width="20"
          height="20"
          loading="lazy"
          decoding="async"
        />
      </a>
    </footer>
  `;
}
