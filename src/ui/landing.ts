import { html, type SafeHtml } from './html.js';

/**
 * Signed-out landing — a placeholder for the scaffold. The real landing (the cold
 * -start hook, the sign-in, the share funnel) is built in Phase 4. For now it
 * states plainly what rolld is and that the rest is on its way.
 */
export function renderLanding(): SafeHtml {
  return html`
    <div class="page">
      <div class="panel">
        <h1>Log your board game plays</h1>
        <p>
          rolld keeps a record of the games you play and how you rate them. Everything lives as
          records on your own atproto account, not in a database somewhere — yours to keep, move,
          or take with you.
        </p>
        <p class="muted">The board is still being set up. More soon :)</p>
      </div>
    </div>
  `;
}
