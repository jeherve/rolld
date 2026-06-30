/**
 * Minimal history router (D-19).
 *
 * A route table of patterns + `history.pushState`, enough for rolld's routes:
 * game pages, per-entry permalinks, the handle and `/did/<did>/…` durable forms,
 * profiles, and search. No dependency, no virtual DOM — the matched route drives
 * one render-from-state function per view (atmot's pattern).
 *
 * Patterns use `:name` for a captured segment, e.g. `/g/:bggId/plays`,
 * `/@:handle`, `/did/:did/play/:rkey`. Matching is exact on segment count.
 */

export interface RouteMatch {
  pattern: string;
  params: Record<string, string>;
}

/** Path portion of a pattern or URL, split into non-empty segments. */
function segments(path: string): string[] {
  return path.split('/').filter((s) => s.length > 0);
}

/**
 * Match a path against one pattern. Returns captured params, or null on mismatch.
 * `:name` captures one segment; a `@`-prefixed pattern segment (e.g. `/@:handle`)
 * matches a `@`-prefixed path segment and captures the part after the `@`.
 */
function matchOne(pattern: string, path: string): Record<string, string> | null {
  const pSegs = segments(pattern);
  const uSegs = segments(path);
  if (pSegs.length !== uSegs.length) return null;

  const params: Record<string, string> = {};
  for (let i = 0; i < pSegs.length; i++) {
    const p = pSegs[i]!;
    const u = uSegs[i]!;
    if (p.startsWith('@:')) {
      // `/@:handle` — the literal `@` must be present; capture the remainder.
      if (!u.startsWith('@')) return null;
      params[p.slice(2)] = decodeURIComponent(u.slice(1));
    } else if (p.startsWith(':')) {
      params[p.slice(1)] = decodeURIComponent(u);
    } else if (p !== u) {
      return null;
    }
  }
  return params;
}

/** Find the first pattern in the table that matches `path` (query string ignored). */
export function matchRoute(patterns: string[], path: string): RouteMatch | null {
  const pathname = path.split('?')[0]!.split('#')[0]!;
  for (const pattern of patterns) {
    const params = matchOne(pattern, pathname);
    if (params) return { pattern, params };
  }
  return null;
}

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
}

/**
 * Wire a history router over the route table. Keeps DOM concerns out of the pure
 * `matchRoute` above so the matching logic stays unit-testable without a window.
 */
export function createRouter({ routes, notFound }: RouterOptions): Router {
  const patterns = Object.keys(routes);

  function render(): void {
    const path = location.pathname + location.search;
    const match = matchRoute(patterns, path);
    if (match) routes[match.pattern]!(match);
    else notFound(location.pathname);
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
