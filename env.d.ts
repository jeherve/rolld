/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** OAuth `client_id` — the public URL of oauth-client-metadata.json (or a loopback client_id in dev). Wired in Phase 2. */
  readonly VITE_OAUTH_CLIENT_ID: string;
  /** OAuth redirect URI the authorization server sends the user back to. Wired in Phase 2. */
  readonly VITE_OAUTH_REDIRECT_URI: string;
  /** OAuth scope string. Wired in Phase 2. */
  readonly VITE_OAUTH_SCOPE: string;
  /** Override the rolld Worker base URL in dev (e.g. a local `wrangler dev`). Optional. */
  readonly VITE_API_BASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
