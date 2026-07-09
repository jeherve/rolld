/**
 * rolld — global configuration & frozen constants.
 *
 * Values here that are baked into shipped data can never change without breaking
 * history (the domain, the lexicon namespace). The frozen `/g/<bggId>` target
 * helper that Constellation indexes literally is owned by the write path — it is
 * deliberately NOT here yet. See DECISIONS.md.
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
export const AUTHOR_PROFILE_URL = 'https://jeremy.herve.bzh';
export const REPO_URL = 'https://tangled.org/jeremy.herve.bzh/rolld';

/** BoardGameGeek home — where the footer's required "Powered by BGG" logo links (D-31, D-53). */
export const BGG_URL = 'https://boardgamegeek.com';

/** Where abuse reports go (D-41, CC-8). The inbox is a maintainer action item. */
export const ABUSE_EMAIL = 'abuse@rolld.at';

/**
 * Base URL for the rolld Worker (the BGG gateway + cache; D-3/D-31). Empty string
 * means same-origin (`/api/…` under `rolld.at` in production). In dev, point it at
 * the local `wrangler dev` instance via `VITE_API_BASE`.
 */
export const API_BASE = import.meta.env.VITE_API_BASE ?? '';

/** Constellation (microcosm) public backlink index — the read seam. */
export const CONSTELLATION_BASE = 'https://constellation.microcosm.blue';

/** Slingshot — fast record + verified-identity reads (D-23, D-26). */
export const SLINGSHOT_BASE = 'https://slingshot.microcosm.blue';

/** Spacedust — live links firehose websocket (D-26; the feed's live tail). */
export const SPACEDUST_BASE = 'wss://spacedust.microcosm.blue';

/**
 * AppView API host — the XRPC read seam for `app.bsky.*` (follows graph, actor
 * search, profile chrome, post threads). rolld is AppView-agnostic: any service
 * that speaks these lexicons works, so a deployer can repoint this at mu/eurosky's
 * AppView. Bluesky's public, keyless AppView is the default for now because it's
 * the most complete (D-51).
 */
export const APPVIEW_API = 'https://public.api.bsky.app';

/**
 * Handle typeahead host for the player-tagging autocomplete (D-56). Speaks the
 * same `app.bsky.actor.searchActorsTypeahead` XRPC as the AppView, but searches
 * the *whole* network rather than one platform's curated user list — so you can
 * tag a co-player whoever's PDS they're on. Kept separate from `APPVIEW_API` so
 * the destination is a one-line swap.
 */
export const TYPEAHEAD_API = 'https://typeahead.waow.tech';

/**
 * AppView *web* host — where human-facing "view / reply on the Atmosphere" links
 * land. Kept separate from the API host so the read backend and the click-through
 * can differ, and so swapping the destination is a one-line change (D-51).
 */
export const APPVIEW_WEB = 'https://bsky.app';

/**
 * did:plc resolution hosts, tried in order: the eurosky EU mirror first (sovereign
 * by default), the canonical Bluesky-run directory as the safety net (D-51).
 */
export const PLC_HOSTS = ['https://plc.eurosky.network', 'https://plc.directory'] as const;

/** Sent on every microcosm request (they ask for a descriptive UA + contact). */
export const USER_AGENT = `rolld/0.0 (+${ORIGIN}; board game tracker; ${REPO_URL})`;

/**
 * atstore.fyi review flow (D-59). `ATSTORE_LISTING_URI` is the at:// URI of rolld's
 * own `fyi.atstore.listing.detail` record — it does not exist until atstore approves
 * rolld's listing, so it stays EMPTY here and the whole review feature is dormant
 * (no menu item, no writes) until a maintainer fills it in at launch.
 */
export const ATSTORE_LISTING_URI = '';
/** Public web page for rolld's atstore listing (the "atstore" text link in the sheet). */
export const ATSTORE_LISTING_URL = 'https://atstore.fyi/products/rolld-at';
/** Minimum of (own plays + own ratings) before the "Rate rolld" menu item is offered. */
export const ATSTORE_REVIEW_MIN_ACTIVITY = 3;
