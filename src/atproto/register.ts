/**
 * Register the atcute lexicon definition packages (side-effect import). This
 * populates the ambient XRPC method/type registry the `@atcute/client` `Client`
 * resolves method names against — so `com.atproto.repo.*` and `app.bsky.*` calls
 * are typed and validated. Import this once, before constructing any `Client`.
 */
import '@atcute/atproto';
import '@atcute/bluesky';
