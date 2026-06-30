import { render, html, type SafeHtml } from './html.js';
import { renderHeader } from './header.js';
import { renderFooter } from './footer.js';

/**
 * Paint the persistent chrome once: header at the top, footer at the bottom, and
 * a `<main>` mount point the router re-renders per view. Mobile-first — the shell
 * is a single column; wider gridded layouts come per-page in Phase 4 (D-35).
 */
export function mountShell(root: HTMLElement): HTMLElement {
  render(
    root,
    html`
      <div class="shell">
        ${renderHeader()}
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
