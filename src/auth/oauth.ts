/**
 * Browser atproto OAuth via `@atcute/oauth-browser-client`. rolld is a
 * static SPA, so auth runs entirely client-side — no server session (matches atmot).
 *
 * The flow: `initOAuth()` once at startup → `beginLogin(handle)` redirects to the
 * user's PDS consent screen → the PDS redirects back to `/oauth/callback` with the
 * result in the URL hash → `completeLogin()` finalizes it → a `RolldAgent` ready to
 * write. On reload, `restoreSession()` rehydrates from the stored DID. We persist
 * only the signed-in DID; atcute keeps the session material in its own storage.
 */
import { Client } from '@atcute/client';
import type { Did } from '@atcute/lexicons/syntax';
import {
  configureOAuth,
  createAuthorizationUrl,
  deleteStoredSession,
  finalizeAuthorization,
  getSession,
  OAuthUserAgent,
  type Session,
} from '@atcute/oauth-browser-client';
import {
  CompositeDidDocumentResolver,
  LocalActorResolver,
  WebDidDocumentResolver,
} from '@atcute/identity-resolver';
import { RolldAgent } from '../atproto/client.js';
import { createHandleResolver, createPlcResolver } from './resolvers.js';

const DID_KEY = 'rolld:did';

let agent: RolldAgent | null = null;

/** Configure OAuth once, before any login/callback/resume. Idempotent-safe to call at startup. */
export function initOAuth(): void {
  configureOAuth({
    metadata: {
      client_id: import.meta.env.VITE_OAUTH_CLIENT_ID,
      redirect_uri: import.meta.env.VITE_OAUTH_REDIRECT_URI,
    },
    // Handle + did:plc resolution prefer sovereign services (Slingshot, the eurosky
    // PLC mirror) and fall back to the Bluesky-run canonical — AppView-agnostic (D-51).
    identityResolver: new LocalActorResolver({
      handleResolver: createHandleResolver(),
      didDocumentResolver: new CompositeDidDocumentResolver({
        methods: { plc: createPlcResolver(), web: new WebDidDocumentResolver() },
      }),
    }),
  });
}

/** Redirect to the user's PDS to authorize. `identifier` is the handle or DID they typed. */
export async function beginLogin(
  identifier: string,
  scope: string = import.meta.env.VITE_OAUTH_SCOPE,
): Promise<void> {
  const url = await createAuthorizationUrl({
    target: { type: 'account', identifier: identifier.trim() as Did },
    scope,
  });
  // Let the browser flush its storage before navigating away (atcute's guidance).
  await new Promise((resolve) => setTimeout(resolve, 200));
  window.location.assign(url.toString());
}

/** Finalize on the `/oauth/callback` page: read the hash, scrub it, build the agent. */
export async function completeLogin(): Promise<RolldAgent> {
  const params = new URLSearchParams(location.hash.slice(1));
  history.replaceState(null, '', location.pathname + location.search);
  const { session } = await finalizeAuthorization(params);
  return adopt(session);
}

/** Rehydrate the agent from the stored DID on reload, or null if not signed in. */
export async function restoreSession(): Promise<RolldAgent | null> {
  const did = localStorage.getItem(DID_KEY);
  if (!did) return null;
  try {
    const session = await getSession(did as Did, { allowStale: true });
    return adopt(session);
  } catch {
    localStorage.removeItem(DID_KEY);
    return null;
  }
}

function adopt(session: Session): RolldAgent {
  const handler = new OAuthUserAgent(session);
  const rpc = new Client({ handler });
  const did = session.info.sub;
  localStorage.setItem(DID_KEY, did);
  agent = new RolldAgent(rpc, did);
  return agent;
}

/** The current authenticated agent, or null when signed out. */
export function currentAgent(): RolldAgent | null {
  return agent;
}

export function isSignedIn(): boolean {
  return agent !== null;
}

/** Sign out: clear local state and revoke the session at the PDS (best-effort). */
export async function signOut(): Promise<void> {
  const did = localStorage.getItem(DID_KEY);
  localStorage.removeItem(DID_KEY);
  agent = null;
  if (!did) return;
  try {
    const session = await getSession(did as Did, { allowStale: true });
    await new OAuthUserAgent(session).signOut();
  } catch {
    deleteStoredSession(did as Did);
  }
}
