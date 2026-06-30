import { AUTHOR_PROFILE_URL, REPO_URL } from '../config.js';
import { html, type SafeHtml } from './html.js';
import { tangledMark } from './icons.js';

/**
 * Shared footer — the family "made by / hosted on" signature (D-29). Three marks:
 * an About link into rolld's own story, the author's pixel face (→ the author),
 * and the Tangled mark (→ this repo). The face and Tangled mark are family assets,
 * copied verbatim and never restyled into the rose theme.
 *
 * The two marks are loaded differently on purpose (D-52). The Tangled mark is a
 * single-colour glyph inlined from `icons.ts` so it can pick up `currentColor` and tint
 * with the footer chrome — an <img> can't do that. The face is a full-colour pixel
 * portrait that must NOT be tinted and is a heavy asset, so it's served as a static
 * `/jeremy-herve.svg` (kept out of the JS bundle, cached on its own) and lazy-loaded,
 * since the footer sits below the fold.
 */
export function renderFooter(): SafeHtml {
  return html`
    <footer class="status">
      <span>Your games, your account, the open web.</span>
      <a href="/about" data-link>About</a>
      <span class="spacer"></span>
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
      <a
        class="iconlink"
        href="${REPO_URL}"
        target="_blank"
        rel="noopener noreferrer"
        title="rolld source on tangled.org"
        aria-label="The rolld source repository on tangled.org"
      >
        ${tangledMark}
      </a>
    </footer>
  `;
}
