/**
 * The signed-in account control in the header: an avatar + handle trigger opening a
 * small menu (Settings, Log out, and — only when eligible — Rate rolld on atstore,
 * D-59). Eligibility is resolved lazily the first time the menu opens and cached for
 * the session, so the global header stays cheap.
 */
import { signOut } from '../auth/oauth.js';
import {
  countOwnActivity,
  hasReviewedLocally,
  isReviewEligible,
} from '../atproto/atstoreEligibility.js';
import type { PageCtx, SessionInfo } from './context.js';
import { html, type SafeHtml } from './html.js';
import { avatar } from './render.js';
import { openReviewFlow } from './reviewFlow.js';

export function renderAccountMenu(session: SessionInfo): SafeHtml {
  return html`
    <div class="account" data-account>
      <button class="account-trigger" data-account-trigger aria-haspopup="menu" aria-expanded="false">
        ${avatar(session.avatar, session.handle, 28)}
        <span class="mono">@${session.handle}</span>
      </button>
      <div class="account-menu" role="menu" hidden>
        <a href="/settings" data-link role="menuitem">Settings</a>
        <button type="button" role="menuitem" data-account-signout>Log out</button>
      </div>
    </div>
  `;
}

/** Shared sign-out: revoke, drop the session, repaint chrome, go home. */
export async function performSignOut(ctx: PageCtx): Promise<void> {
  await signOut();
  ctx.state.session = null;
  ctx.refreshChrome();
  ctx.navigate('/');
}

let eligibilityCache: { did: string; eligible: boolean } | null = null;

async function resolveEligible(session: SessionInfo): Promise<boolean> {
  if (eligibilityCache && eligibilityCache.did === session.did) return eligibilityCache.eligible;
  let eligible = false;
  try {
    const activityCount = await countOwnActivity(session.pds, session.did);
    eligible = isReviewEligible({ activityCount, reviewed: hasReviewedLocally() });
  } catch {
    eligible = false;
  }
  eligibilityCache = { did: session.did, eligible };
  return eligible;
}

export function bindAccountMenu(root: HTMLElement, ctx: PageCtx): void {
  const wrap = root.querySelector<HTMLElement>('[data-account]');
  const session = ctx.state.session;
  if (!wrap || !session) return;

  const trigger = wrap.querySelector<HTMLButtonElement>('[data-account-trigger]')!;
  const menu = wrap.querySelector<HTMLElement>('.account-menu')!;
  let injected = false;

  const close = (): void => {
    menu.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
  };
  const open = (): void => {
    menu.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    if (!injected) {
      injected = true;
      void resolveEligible(session).then((eligible) => {
        if (!eligible) return;
        const item = document.createElement('button');
        item.type = 'button';
        item.setAttribute('role', 'menuitem');
        item.textContent = 'Rate rolld on atstore';
        item.addEventListener('click', () => {
          close();
          openReviewFlow(ctx, {
            onReviewed: () => {
              eligibilityCache = { did: session.did, eligible: false };
              item.remove();
            },
          });
        });
        menu.appendChild(item);
      });
    }
  };

  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    menu.hidden ? open() : close();
  });
  wrap.querySelector('[data-account-signout]')!.addEventListener('click', () => {
    close();
    void performSignOut(ctx);
  });
  document.addEventListener('click', (e) => {
    if (!wrap.contains(e.target as Node)) close();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
  });
}
