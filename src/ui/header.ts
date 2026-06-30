import { html, type SafeHtml } from './html.js';

/**
 * Shared header. The wordmark is always lowercase (brand-assets.md), in IBM Plex
 * Mono, with the two l's carrying the two brand colours (rose, then sea-green).
 * It links home. Account / nav actions land with the write path in Phase 2.
 */
export function renderHeader(): SafeHtml {
  return html`
    <header class="bar">
      <span class="wordmark">
        <a href="/" data-link>ro<span class="l1">l</span><span class="l2">l</span>d</a>
      </span>
    </header>
  `;
}
