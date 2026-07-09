/**
 * The atstore review sheet (D-59): a 1–5 star picker plus an optional note, writing a
 * `fyi.atstore.listing.review` to the user's own PDS. Opened from the account menu's
 * gated "Rate rolld" item; on success it records the review locally so we never ask
 * again on this device.
 */
import { submitAtstoreReview } from '../atproto/atstore.js';
import { markReviewedLocally } from '../atproto/atstoreEligibility.js';
import { ATSTORE_LISTING_URL } from '../config.js';
import type { PageCtx } from './context.js';
import { openSheet, toast } from './flows.js';
import { html } from './html.js';

export function openReviewFlow(ctx: PageCtx, opts: { onReviewed?: () => void } = {}): void {
  const session = ctx.state.session;
  if (!session) {
    ctx.navigate('/login');
    return;
  }

  const sheet = openSheet(
    'Rate rolld',
    html`
      <form id="review-form">
        <p class="mono small muted">
          Your review goes on your own account, and shows up on
          <a href="${ATSTORE_LISTING_URL}" target="_blank" rel="noopener noreferrer">atstore</a>
          so other players can see what you think of rolld.
        </p>
        <label class="mono">Your rating</label>
        <div class="star-picker" id="stars" role="group" aria-label="Your rating">
          ${Array.from(
            { length: 5 },
            (_, n) =>
              html`<button type="button" class="pixel-btn star-btn" data-star="${n + 1}" aria-pressed="false" aria-label="${n + 1} star${n ? 's' : ''}">★</button>`,
          )}
        </div>
        <label class="mono" for="review-text">A few words (optional)</label>
        <textarea id="review-text" class="text-input mono" rows="4" maxlength="8000" placeholder="what you like about rolld"></textarea>
        <button type="submit" class="pixel-btn is-active submit-cta" disabled>Post review</button>
        <p class="mono small muted" id="review-status"></p>
      </form>
    `,
  );

  let rating = 0;
  const stars = sheet.body.querySelector<HTMLElement>('#stars')!;
  const submit = sheet.body.querySelector<HTMLButtonElement>('.submit-cta')!;
  for (const btn of stars.querySelectorAll<HTMLButtonElement>('.star-btn')) {
    btn.addEventListener('click', () => {
      rating = Number(btn.dataset.star);
      for (const b of stars.querySelectorAll<HTMLButtonElement>('.star-btn')) {
        const on = Number(b.dataset.star) <= rating;
        b.classList.toggle('is-active', on);
        b.setAttribute('aria-pressed', String(on));
      }
      submit.disabled = rating < 1;
    });
  }

  const form = sheet.body.querySelector<HTMLFormElement>('#review-form')!;
  const status = sheet.body.querySelector<HTMLElement>('#review-status')!;
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (rating < 1) return;
    submit.disabled = true;
    status.textContent = 'Posting…';
    const text = sheet.body.querySelector<HTMLTextAreaElement>('#review-text')!.value;
    void (async () => {
      try {
        await submitAtstoreReview(session.agent, {
          rating,
          ...(text.trim() ? { text } : {}),
          displayName: session.handle,
        });
        markReviewedLocally();
        sheet.close();
        toast('Thanks! Your review is posted. :)');
        opts.onReviewed?.();
      } catch {
        submit.disabled = false;
        status.textContent = "That didn't post. Try again in a moment.";
      }
    })();
  });
}
