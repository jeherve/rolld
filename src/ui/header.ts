import type { AppState } from './context.js';
import { html, type SafeHtml } from './html.js';

/**
 * Shared header. The wordmark is always lowercase (brand-assets.md), in IBM Plex
 * Mono, with the two l's carrying the two brand colours (rose, then sea-green). It
 * links home. The right side reflects auth state (CC-6): a "Log a play" action and
 * the account link when signed in, a sign-in link when not.
 */
export function renderHeader(state: AppState): SafeHtml {
  return html`
    <header class="bar">
      <span class="wordmark">
        <a href="/" data-link>ro<span class="l1">l</span><span class="l2">l</span>d</a>
      </span>
      <nav class="hnav mono">
        <a href="/search" data-link aria-label="Find a game">Find</a>
        ${state.session
          ? html`
              <button class="pixel-btn small is-active" data-action="log">Log a play</button>
              <a href="/@${state.session.handle}" data-link>@${state.session.handle}</a>
            `
          : html`<a href="/login" data-link>Sign in</a>`}
      </nav>
    </header>
  `;
}
