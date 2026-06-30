/**
 * Identity resolution (D-14, D-23) via Slingshot. `resolveMiniDoc` returns DID +
 * verified handle + PDS URL in ONE call — everything needed to render a
 * feed/profile identity, to redirect a stale handle to the current one (D-14), and
 * to fall back to direct PDS reads if Slingshot is unavailable.
 *
 * The `handle.invalid` sentinel is Slingshot's explicit "not bi-directionally
 * verified" signal — surface it, don't hide it. Prefer the `blue.microcosm.*`
 * alias; the network read is injectable so callers can degrade gracefully.
 */
import { PUBLIC_APPVIEW, SLINGSHOT_BASE } from '../config.js';

export interface MiniDoc {
  did: string;
  handle: string;
  pds: string;
  signingKey?: string;
}

export interface IdentityOptions {
  fetchImpl?: typeof fetch;
  baseUrl?: string;
  signal?: AbortSignal;
}

/** Resolve a handle OR DID to a MiniDoc. Returns null if it can't be resolved. */
export async function resolveMiniDoc(
  identifier: string,
  opts: IdentityOptions = {},
): Promise<MiniDoc | null> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const base = opts.baseUrl ?? SLINGSHOT_BASE;
  const url = `${base}/xrpc/blue.microcosm.identity.resolveMiniDoc?identifier=${encodeURIComponent(identifier)}`;
  try {
    const res = await fetchImpl(url, { signal: opts.signal ?? null });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      did: string;
      handle: string;
      pds: string;
      signing_key?: string;
    };
    return {
      did: data.did,
      handle: data.handle,
      pds: data.pds,
      ...(data.signing_key ? { signingKey: data.signing_key } : {}),
    };
  } catch {
    return null;
  }
}

/** True when the handle didn't bi-directionally verify (Slingshot's sentinel). */
export function isUnverifiedHandle(doc: MiniDoc): boolean {
  return doc.handle === 'handle.invalid';
}

/**
 * Fallback handle→DID via the public AppView (used if Slingshot is down). Standard
 * `com.atproto.identity.resolveHandle`.
 */
export async function resolveHandleFallback(
  handle: string,
  opts: IdentityOptions = {},
): Promise<string | null> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const base = opts.baseUrl ?? PUBLIC_APPVIEW;
  try {
    const res = await fetchImpl(
      `${base}/xrpc/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(handle)}`,
      { signal: opts.signal ?? null },
    );
    if (!res.ok) return null;
    return ((await res.json()) as { did: string }).did;
  } catch {
    return null;
  }
}
