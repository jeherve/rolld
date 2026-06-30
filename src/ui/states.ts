import { html, type SafeHtml } from './html.js';

/**
 * Personality-motif chrome (D-36). One on-theme family — dice, game boxes, a
 * table waiting for players — applied to the waits and the edges, never to the
 * working surface of a form. These are first-pass stubs: the structure, the
 * copy, and the `prefers-reduced-motion` fallback are here; the finished pixel
 * art lands with Phase 4. Motion is gated in theme.css — the loader settles to a
 * still die when reduced motion is asked for.
 */

/** Loading → a tumbling die (the mark in motion). Light, short, never blocks input. */
export function diceLoader(label = 'Rolling…'): SafeHtml {
  return html`
    <div class="dice-loader" role="status">
      <span class="die" aria-hidden="true"></span>
      <span class="muted mono">${label}</span>
    </div>
  `;
}

export interface EmptyStateOpts {
  /** A tabletop motif (placeholder emoji for now; pixel art in Phase 4). */
  motif?: string;
  title?: string;
  body?: string;
  /** Optional call to action, already-built markup (e.g. a Log a play button). */
  cta?: SafeHtml;
}

/** Empty states are invitations, not dead ends (design-system voice). */
export function emptyState({
  motif = '🎲',
  title = 'No games on the table yet',
  body = 'Log your first play to get the dice rolling.',
  cta,
}: EmptyStateOpts = {}): SafeHtml {
  return html`
    <div class="state is-empty">
      <span class="motif" aria-hidden="true">${motif}</span>
      <span class="title">${title}</span>
      <p class="muted">${body}</p>
      ${cta}
    </div>
  `;
}

export interface ErrorStateOpts {
  motif?: string;
  title?: string;
  body?: string;
}

/** Errors say what happened and how to move on, in the interface's voice, no apology. */
export function errorState({
  motif = '📦',
  title = 'That play got away',
  body = 'Something went wrong loading this. Give it another roll in a moment.',
}: ErrorStateOpts = {}): SafeHtml {
  return html`
    <div class="state is-error" role="alert">
      <span class="motif" aria-hidden="true">${motif}</span>
      <span class="title">${title}</span>
      <p class="muted">${body}</p>
    </div>
  `;
}
