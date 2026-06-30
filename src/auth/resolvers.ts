/**
 * Ordered-fallback identity resolvers for the login path (D-51).
 *
 * rolld treats Bluesky as one AppView among several (eurosky/mu, …). So the two
 * pieces of resolution OAuth needs — handle→DID and did:plc → DID document — try a
 * sovereign service first and fall back to the Bluesky-run canonical only on
 * failure. This mirrors what the read side already does in `read/identity.ts`
 * (Slingshot primary, AppView fallback); here it's wired into atcute's resolver
 * interfaces so `LocalActorResolver` gets the same behaviour for free.
 */
import {
  PlcDidDocumentResolver,
  XrpcHandleResolver,
  type DidDocumentResolver,
  type HandleResolver,
  type ResolveDidDocumentOptions,
  type ResolveHandleOptions,
} from '@atcute/identity-resolver';
import type { DidDocument } from '@atcute/identity';
import type { AtprotoDid, Did, Handle } from '@atcute/lexicons/syntax';
import { APPVIEW_API, PLC_HOSTS, SLINGSHOT_BASE } from '../config.js';

/** Try each resolver in order; return the first that succeeds, or rethrow the last error. */
export class FallbackHandleResolver implements HandleResolver {
  readonly #resolvers: HandleResolver[];
  constructor(resolvers: HandleResolver[]) {
    if (resolvers.length === 0) {
      throw new Error('FallbackHandleResolver needs at least one resolver');
    }
    this.#resolvers = resolvers;
  }
  async resolve(handle: Handle, options?: ResolveHandleOptions): Promise<AtprotoDid> {
    let lastError: unknown;
    for (const resolver of this.#resolvers) {
      try {
        return await resolver.resolve(handle, options);
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError;
  }
}

/** Same ordered-fallback shape, for did:plc document resolution. */
export class FallbackDidDocumentResolver implements DidDocumentResolver<'plc'> {
  readonly #resolvers: DidDocumentResolver<'plc'>[];
  constructor(resolvers: DidDocumentResolver<'plc'>[]) {
    if (resolvers.length === 0) {
      throw new Error('FallbackDidDocumentResolver needs at least one resolver');
    }
    this.#resolvers = resolvers;
  }
  async resolve(did: Did<'plc'>, options?: ResolveDidDocumentOptions): Promise<DidDocument> {
    let lastError: unknown;
    for (const resolver of this.#resolvers) {
      try {
        return await resolver.resolve(did, options);
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError;
  }
}

/**
 * Handle→DID at login: Slingshot first (it serves `com.atproto.identity.resolveHandle`
 * and always bi-directionally verifies, per microcosm-apis.md), the Bluesky AppView
 * as the safety net.
 */
export function createHandleResolver(fetchImpl: typeof fetch = fetch): HandleResolver {
  return new FallbackHandleResolver([
    new XrpcHandleResolver({ serviceUrl: SLINGSHOT_BASE, fetch: fetchImpl }),
    new XrpcHandleResolver({ serviceUrl: APPVIEW_API, fetch: fetchImpl }),
  ]);
}

/** did:plc documents: the eurosky EU mirror first, the canonical directory as fallback. */
export function createPlcResolver(fetchImpl: typeof fetch = fetch): DidDocumentResolver<'plc'> {
  return new FallbackDidDocumentResolver(
    PLC_HOSTS.map((apiUrl) => new PlcDidDocumentResolver({ apiUrl, fetch: fetchImpl })),
  );
}
