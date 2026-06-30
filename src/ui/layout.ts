import { render, html, type SafeHtml } from './html.js';
import type { AppState } from './context.js';
import { renderHeader } from './header.js';
import { renderFooter } from './footer.js';

/**
 * Paint the persistent chrome: header (reflecting auth state) at the top, footer at
 * the bottom, and a `<main>` mount point the router re-renders per view. Re-called
 * on sign-in/out to refresh the header. Mobile-first single column (D-35).
 */
export function mountShell(root: HTMLElement, state: AppState): HTMLElement {
  render(
    root,
    html`
      <div class="shell">
        ${renderHeader(state)}
        <main id="main"></main>
        ${renderFooter()}
      </div>
    `,
  );
  return root.querySelector<HTMLElement>('#main')!;
}

/** Re-render the current view into the main mount point. */
export function renderView(main: HTMLElement, view: SafeHtml): void {
  render(main, view);
}
