import { html, type SafeHtml } from './html.js';

/**
 * Signed-out landing (D-24, D-40). Leads with the solo-journal value — a complete
 * pitch even for someone whose friends aren't here yet (D-40 move 3) — with the
 * social layer as the second beat, not the headline. Plain, warm voice (D-30).
 */
export function renderLanding(): SafeHtml {
  return html`
    <div class="landing">
      <section class="hero">
        <img class="hero-mark" src="/brand/rolld-mark.svg" alt="" width="96" height="96" />
        <h1>A log of every board game you play</h1>
        <p class="lede">
          Keep a record of the games you play and how you rate them. It's yours to keep, on your
          own account, on the open network — not locked inside someone else's database.
        </p>
        <a class="pixel-btn is-active hero-cta" href="/login" data-link>Sign in with atproto</a>
        <p class="muted mono small">…and see what your friends are playing, once they're here too.</p>
      </section>

      <section class="beats">
        <div class="beat">
          <span class="beat-icon" aria-hidden="true">🎲</span>
          <h2>Your own log</h2>
          <p>Every play and grade, in one place, in your hands.</p>
        </div>
        <div class="beat">
          <span class="beat-icon" aria-hidden="true">🗃️</span>
          <h2>Your data, your account</h2>
          <p>Plays live as records on your atproto account. No lock-in, nothing to export.</p>
        </div>
        <div class="beat">
          <span class="beat-icon" aria-hidden="true">👋</span>
          <h2>Social when you want it</h2>
          <p>Share a play to Bluesky, and your people can follow along.</p>
        </div>
      </section>
    </div>
  `;
}
