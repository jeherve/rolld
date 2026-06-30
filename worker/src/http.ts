/**
 * Small HTTP helpers for the Worker: CORS and JSON responses. The SPA and the
 * Worker share an origin in production (both under `rolld.at`), but dev runs the
 * SPA on the loopback IP, so CORS must allow that too.
 */

const DEFAULT_ALLOWED = ['https://rolld.at', 'http://127.0.0.1:12530', 'http://localhost:12530'];

/** Resolve the `Access-Control-Allow-Origin` to echo, given the request Origin. */
export function corsOrigin(request: Request, allowed: string[] = DEFAULT_ALLOWED): string {
  const origin = request.headers.get('Origin');
  if (origin && allowed.includes(origin)) return origin;
  return allowed[0]!;
}

export function corsHeaders(request: Request, allowed?: string[]): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': corsOrigin(request, allowed),
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    Vary: 'Origin',
  };
}

export function json(
  request: Request,
  body: unknown,
  init: { status?: number; cacheSeconds?: number } = {},
): Response {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json; charset=utf-8',
    ...corsHeaders(request),
  };
  if (init.cacheSeconds) headers['Cache-Control'] = `public, max-age=${init.cacheSeconds}`;
  return new Response(JSON.stringify(body), { status: init.status ?? 200, headers });
}

export function errorJson(request: Request, status: number, code: string, message: string): Response {
  return json(request, { error: code, message }, { status });
}
