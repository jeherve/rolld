import './ui/theme.css';
import { createRouter } from './router/router.js';
import { mountShell, renderView } from './ui/layout.js';
import { renderLanding } from './ui/landing.js';
import { emptyState, errorState } from './ui/states.js';

const root = document.getElementById('app')!;
const main = mountShell(root);

/**
 * Stub route table for the scaffold. Each route renders a placeholder view into
 * the main mount point; the real pages land per phase (read-only public pages
 * first in Phase 4). The frozen `/g/<bggId>` target helper is owned by Phase 2.
 */
const router = createRouter({
  routes: {
    '/': () => renderView(main, renderLanding()),
    '/dashboard': () =>
      renderView(
        main,
        emptyState({
          title: 'Your dashboard is empty',
          body: 'Log a play and it shows up here, alongside what your friends are playing.',
        }),
      ),
  },
  notFound: () =>
    renderView(
      main,
      errorState({
        motif: '🗺️',
        title: 'We can’t find that page',
        body: 'The link may be wrong, or the page isn’t built yet. Head back to the start.',
      }),
    ),
});

// Intercept in-app links (anchors marked data-link) for client-side navigation.
document.addEventListener('click', (e) => {
  const link = (e.target as HTMLElement)?.closest<HTMLAnchorElement>('a[data-link]');
  if (!link) return;
  const href = link.getAttribute('href');
  if (!href || !href.startsWith('/')) return;
  e.preventDefault();
  router.navigate(href);
});

router.start();
root.removeAttribute('aria-busy');
