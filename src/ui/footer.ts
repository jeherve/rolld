import { AUTHOR_PROFILE_URL, REPO_URL } from '../config.js';
import { html, type SafeHtml } from './html.js';
import { tangledMark } from './icons.js';

/**
 * Shared footer — the family "made by / hosted on" signature (D-29). Three marks:
 * an About link into rolld's own story, the author's pixel face (→ the author),
 * and the Tangled mark (→ this repo). The face and Tangled mark are family assets,
 * copied verbatim and never restyled into the rose theme.
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
        <img class="avatar" src="/jeremy-herve.svg" alt="" width="20" height="20" />
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
