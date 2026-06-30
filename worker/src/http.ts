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

/**
 * Validate an upstream endpoint we resolved from ATTACKER-CONTROLLED data before
 * fetching it. A user picks their own PDS, and a `did:web` (or a did:plc with a
 * self-chosen serviceEndpoint) can point that endpoint anywhere — so the raw `pds`
 * string from a MiniDoc is untrusted. Without this guard the Worker is an SSRF
 * proxy: a request for `/api/blob/<attacker-did>/<cid>` would make Cloudflare's
 * edge fetch `https://169.254.169.254/…` or an internal host and stream the body
 * back. We require https, a real dotted public hostname, and reject IP-literal /
 * localhost / single-label hosts. Returns the bare origin (dropping any path or
 * query the attacker tucked into the endpoint), or null if it's not safe to fetch.
 */
export function safeUpstreamOrigin(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:') return null;
  const host = u.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost')) return null;
  if (!host.includes('.')) return null; // single-label internal names
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return null; // IPv4 literal (incl. the metadata IP)
  if (host.includes(':') || raw.includes('[')) return null; // IPv6 literal
  return u.origin;
}
