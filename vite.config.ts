import { defineConfig } from 'vitest/config';
import metadata from './public/oauth-client-metadata.json' with { type: 'json' };

// AT Protocol OAuth forbids `localhost` — use the loopback IP instead.
const SERVER_HOST = '127.0.0.1';
const SERVER_PORT = 12530;

export default defineConfig({
  server: { host: SERVER_HOST, port: SERVER_PORT },
  build: { target: 'es2022', sourcemap: true },
  test: {
    // happy-dom by default so UI render tests get a DOM without a per-file pragma.
    environment: 'happy-dom',
  },
  plugins: [
    {
      // Wires the OAuth client_id / redirect_uri into the build. The real write
      // path lands in Phase 2; this only threads the stub metadata through so the
      // values exist from day one.
      // In production we use the real hosted oauth-client-metadata.json URL.
      // In dev, atproto allows a special loopback `client_id` that encodes the
      // redirect_uri + scope, so no public metadata document is needed.
      name: 'rolld-oauth-envs',
      config(_conf, { command }) {
        if (command === 'build') {
          process.env.VITE_OAUTH_CLIENT_ID = metadata.client_id;
          process.env.VITE_OAUTH_REDIRECT_URI = metadata.redirect_uris[0];
        } else {
          const redirectUri = `http://${SERVER_HOST}:${SERVER_PORT}${new URL(metadata.redirect_uris[0]!).pathname}`;
          process.env.VITE_OAUTH_CLIENT_ID =
            `http://localhost?redirect_uri=${encodeURIComponent(redirectUri)}` +
            `&scope=${encodeURIComponent(metadata.scope)}`;
          process.env.VITE_OAUTH_REDIRECT_URI = redirectUri;
        }
        process.env.VITE_OAUTH_SCOPE = metadata.scope;
      },
    },
  ],
});
