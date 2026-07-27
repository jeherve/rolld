/**
 * Minimal history router (D-19).
 *
 * A route table of patterns + `history.pushState`, enough for rolld's routes:
 * game pages, per-entry permalinks, the handle and `/did/<did>/…` durable forms,
 * profiles, and search. No dependency, no virtual DOM — the matched route drives
 * one render-from-state function per view (atmot's pattern).
 *
 * The matcher itself lives in `match.ts` (DOM-free, so the edge can share it) and is
 * re-exported here: `router.js` stays the one import for everything routing.
 */
import { matchRoute, type RouteMatch } from './match.js';

export { matchRoute, type RouteMatch };

export type RouteHandler = (match: RouteMatch) => void;

export interface Router {
  /** Navigate to `path` (pushState) and render. No-op push when already there. */
  navigate(path: string): void;
  /** Re-render the current location (e.g. after state changes). */
  render(): void;
  /** Start listening for popstate and render the current location once. */
  start(): void;
}

export interface RouterOptions {
  /** Ordered route table; first match wins. */
  routes: Record<string, RouteHandler>;
  /** Called when no pattern matches — the 404 surface. */
  notFound: (path: string) => void;
  /**
   * Called after every render with the rendered pathname, matched or not. For the
   * page-level chrome that has to follow navigation rather than a single view —
   * today, the `at:` head tags (D-61).
   */
  onRender?: (pathname: string) => void;
}

/**
 * Wire a history router over the route table. Keeps DOM concerns out of the pure
 * `matchRoute` above so the matching logic stays unit-testable without a window.
 */
export function createRouter({ routes, notFound, onRender }: RouterOptions): Router {
  const patterns = Object.keys(routes);

  function render(): void {
    const path = location.pathname + location.search;
    const match = matchRoute(patterns, path);
    if (match) routes[match.pattern]!(match);
    else notFound(location.pathname);
    onRender?.(location.pathname);
  }

  function navigate(path: string): void {
    if (path !== location.pathname + location.search) {
      history.pushState(null, '', path);
    }
    render();
  }

  function start(): void {
    window.addEventListener('popstate', render);
    render();
  }

  return { navigate, render, start };
}
