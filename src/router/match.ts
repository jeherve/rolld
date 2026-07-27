/**
 * The pure half of the router (D-19, D-44): pattern → params, no DOM in sight.
 *
 * Split out from `router.ts` so code that runs outside a browser can reuse the one
 * route matcher instead of re-implementing it — the Pages middleware maps the same
 * paths to `at:` tags at the edge (D-61), where `window` and `history` don't exist.
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
