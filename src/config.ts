/**
 * rolld — global configuration & frozen constants.
 *
 * Values here that are baked into shipped data can never change without breaking
 * history (the domain, the lexicon namespace). The frozen `/g/<bggId>` target
 * helper that Constellation indexes literally is owned by Phase 2 (the write
 * path) — it is deliberately NOT here yet. See DECISIONS.md.
 */

/** Canonical, permanent host. The reverse-DNS of this is the lexicon namespace. */
export const DOMAIN = 'rolld.at';
export const ORIGIN = `https://${DOMAIN}`;

/** Lexicon authority / namespace — flat `at.rolld.*` (D-8/D-37; do not rename). */
export const NSID_AUTHORITY = 'at.rolld';
export const COLLECTION = {
  play: `${NSID_AUTHORITY}.play`,
  rating: `${NSID_AUTHORITY}.rating`,
  profile: `${NSID_AUTHORITY}.profile`,
} as const;

/** The single profile/declaration record is keyed `self`. */
export const PROFILE_RKEY = 'self';

/** Family signature links (footer). The pixel face → the author; Tangled → the repo (D-29). */
export const AUTHOR_PROFILE_URL = 'https://bsky.app/profile/jeremy.herve.bzh';
export const REPO_URL = 'https://tangled.org/jeremy.herve.bzh/rolld';

/** Where abuse reports go (D-41, CC-8). The inbox is a maintainer action item. */
export const ABUSE_EMAIL = 'abuse@rolld.at';

/**
 * Base URL for the rolld Worker (the BGG gateway + cache; D-3/D-31). Empty string
 * means same-origin (`/api/…` under `rolld.at` in production). In dev, point it at
 * the local `wrangler dev` instance via `VITE_API_BASE`.
 */
export const API_BASE = import.meta.env.VITE_API_BASE ?? '';

/** Constellation (microcosm) public backlink index — the read seam (Phase 3). */
export const CONSTELLATION_BASE = 'https://constellation.microcosm.blue';

/** Slingshot — fast record + verified-identity reads (D-23, D-26). */
export const SLINGSHOT_BASE = 'https://slingshot.microcosm.blue';

/** Spacedust — live links firehose websocket (D-26; the feed's live tail). */
export const SPACEDUST_BASE = 'wss://spacedust.microcosm.blue';

/** Public Bluesky AppView — follows graph, actor search, profile chrome, post threads. */
export const PUBLIC_APPVIEW = 'https://public.api.bsky.app';

/** Sent on every microcosm request (they ask for a descriptive UA + contact). */
export const USER_AGENT = `rolld/0.0 (+${ORIGIN}; board game tracker; ${REPO_URL})`;
