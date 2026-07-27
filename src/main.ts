import './ui/theme.css';
import { completeLogin, initOAuth, restoreSession } from './auth/oauth.js';
import type { RolldAgent } from './atproto/client.js';
import { appviewClient, getProfile } from './read/bsky.js';
import { resolveMiniDoc } from './read/identity.js';
import { createRouter } from './router/router.js';
import type { AppState, PageCtx, SessionInfo } from './ui/context.js';
import { openLogFlow } from './ui/flows.js';
import { bindAccountMenu } from './ui/accountMenu.js';
import { syncAtTags } from './ui/head.js';
import { mountShell } from './ui/layout.js';
import * as views from './ui/views.js';

const root = document.getElementById('app')!;
const state: AppState = { session: null };
let main = mountShell(root, state);

const ctx: PageCtx = {
  get main() {
    return main;
  },
  navigate: (path) => {
    views.closeLiveTail();
    router.navigate(path);
  },
  replace: (path) => {
    history.replaceState(null, '', path);
  },
  state,
  refreshChrome: () => {
    main = mountShell(root, state);
    bindAccountMenu(root, ctx);
  },
};

const router = createRouter({
  routes: {
    '/': () => views.home(ctx),
    '/login': () => views.login(ctx),
    '/oauth/callback': () => void handleCallback(),
    '/dashboard': () => views.dashboard(ctx),
    '/search': () => views.search(ctx),
    '/settings': () => views.settings(ctx),
    '/about': () => views.about(ctx),
    '/community-guidelines': () => views.policy(ctx, 'community-guidelines'),
    '/terms': () => views.policy(ctx, 'terms'),
    '/privacy': () => views.policy(ctx, 'privacy'),
    '/g/:bggId': (m) => views.gamePage(ctx, m.params.bggId!),
    '/g/:bggId/plays': (m) => views.gamePlaysList(ctx, m.params.bggId!),
    '/@:handle': (m) => views.profile(ctx, m.params.handle!),
    '/@:handle/plays': (m) => views.playLog(ctx, m.params.handle!),
    '/@:handle/play/:rkey': (m) => views.entry(ctx, 'play', m.params.handle!, m.params.rkey!),
    '/@:handle/rating/:rkey': (m) => views.entry(ctx, 'rating', m.params.handle!, m.params.rkey!),
    '/@:handle/g/:bggId': (m) => views.userGame(ctx, m.params.handle!, m.params.bggId!),
    '/did/:did/play/:rkey': (m) => views.entryByDid(ctx, 'play', m.params.did!, m.params.rkey!),
    '/did/:did/rating/:rkey': (m) => views.entryByDid(ctx, 'rating', m.params.did!, m.params.rkey!),
  },
  notFound: () => views.notFound(ctx),
  // The served HTML already carries the right `at:` tags (D-61, the Pages
  // middleware); this keeps them true once the SPA takes over the URL bar.
  onRender: (path) => void syncAtTags(path, async (h) => (await resolveMiniDoc(h))?.did ?? null),
});

/** Build the session info (resolve the user's handle + PDS) from an authed agent. */
async function setSession(agent: RolldAgent): Promise<void> {
  const [doc, profile] = await Promise.all([
    resolveMiniDoc(agent.did),
    getProfile(appviewClient(), agent.did).catch(() => null),
  ]);
  const session: SessionInfo = {
    agent,
    did: agent.did,
    handle: doc?.handle ?? agent.did,
    pds: doc?.pds ?? '',
    ...(profile?.avatar ? { avatar: profile.avatar } : {}),
  };
  state.session = session;
  ctx.refreshChrome();
}

/** The OAuth redirect lands here: finalize, then return the user where they started. */
async function handleCallback(): Promise<void> {
  try {
    const agent = await completeLogin();
    await setSession(agent);
  } catch {
    // fall through to dashboard/login below
  }
  const returnTo = sessionStorage.getItem('rolld:returnTo') ?? '/dashboard';
  sessionStorage.removeItem('rolld:returnTo');
  router.navigate(state.session ? returnTo : '/login');
}

// In-app link interception (anchors marked data-link) for client-side navigation.
document.addEventListener('click', (e) => {
  const link = (e.target as HTMLElement)?.closest<HTMLAnchorElement>('a[data-link]');
  if (link) {
    const href = link.getAttribute('href');
    if (href && href.startsWith('/')) {
      e.preventDefault();
      router.navigate(href);
    }
    return;
  }
  // The global "Log a play" action (header + dashboard), thumb-reach CTA (D-35).
  const logBtn = (e.target as HTMLElement)?.closest('[data-action="log"]');
  if (logBtn) {
    if (state.session) openLogFlow(ctx);
    else router.navigate('/login');
  }
});

// Boot: configure OAuth, restore any session, then route.
initOAuth();
void (async () => {
  if (location.pathname !== '/oauth/callback') {
    try {
      const agent = await restoreSession();
      if (agent) await setSession(agent);
    } catch {
      /* not signed in */
    }
  }
  router.start();
  root.removeAttribute('aria-busy');
})();
