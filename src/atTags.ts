/**
 * `at:` meta tags — mapping a rolld page back to the record it renders (D-61).
 *
 * Implements the community `at-tags` proposal
 * (https://tangled.org/chrisshank.com/at-tags/): a page that displays an atproto
 * record says so in its `<head>`, so any tool can walk from the URL to the record
 * and open it with whatever app it likes. Exactly rolld's premise — the records are
 * the user's, rolld is one view of them (D-5, D-32).
 *
 * Two consumers share this module, which is why it holds no DOM and no config
 * imports: the Cloudflare Pages middleware (`functions/_middleware.ts`), which puts
 * the tags in the served HTML where fetch-and-parse consumers can see them, and the
 * SPA, which keeps them honest across client-side navigation (`src/ui/head.ts`).
 */
import { matchRoute } from './router/match.js';

/** The record collections rolld writes. Duplicated from `config.COLLECTION` to keep
 * this module import-free for the Worker bundle; a test asserts the two agree. */
const PLAY = 'at.rolld.play';
const RATING = 'at.rolld.rating';

export interface AtTag {
  /** `at:canonical` (the record the page *is*) or `at:author` (whose page it is). */
  name: 'at:canonical' | 'at:author';
  content: string;
}

/** A rolld path that names an identity, and possibly one of that identity's records. */
export interface AtTagRoute {
  /** Handle or DID, straight from the path — resolve before emitting anything. */
  identifier: string;
  /** Set only when the page *is* a record: without it the page wouldn't exist. */
  collection?: string;
  rkey?: string;
}

/**
 * atproto record-key syntax. The rkey comes from the URL and ends up inside an HTML
 * attribute, so it is validated rather than trusted (`renderAtTags` escapes too —
 * belt and braces). `.` and `..` are reserved and rejected by the spec.
 */
const RKEY = /^[A-Za-z0-9._~:-]{1,512}$/;
const DID = /^did:[a-z]+:[a-zA-Z0-9._%:-]{1,2048}$/;
const HANDLE = /^[a-zA-Z0-9][a-zA-Z0-9.-]{0,252}$/;

/** True for a syntactically valid DID — also the "no resolution needed" test. */
export function isDid(identifier: string): boolean {
  return DID.test(identifier);
}

const validRkey = (rkey: string): boolean => RKEY.test(rkey) && rkey !== '.' && rkey !== '..';

/** Handles carry a dot (they're domains); a DID is accepted in the same position. */
const validIdentifier = (id: string): boolean =>
  isDid(id) || (HANDLE.test(id) && id.includes('.'));

/**
 * The route table, mirroring the entry/person routes in `main.ts`. Game pages are
 * deliberately absent: `/g/<bggId>` is a BoardGameGeek catalog page, not a record,
 * and the plays it lists are somebody else's records — no canonical to claim.
 */
const ENTRY_ROUTES: Record<string, string> = {
  '/@:handle/play/:rkey': PLAY,
  '/@:handle/rating/:rkey': RATING,
  '/did/:did/play/:rkey': PLAY,
  '/did/:did/rating/:rkey': RATING,
};
const PERSON_ROUTES = ['/@:handle', '/@:handle/plays', '/@:handle/g/:bggId'];
const PATTERNS = [...Object.keys(ENTRY_ROUTES), ...PERSON_ROUTES];

/**
 * What (if anything) a rolld path points at. Returns null for every page that maps
 * to no record and no person — and for anything malformed, since a page reached by
 * a bogus URL shouldn't claim an identity.
 */
export function atTagRoute(pathname: string): AtTagRoute | null {
  let match;
  try {
    // `matchRoute` decodes each captured segment; a broken `%` escape throws.
    match = matchRoute(PATTERNS, pathname);
  } catch {
    return null;
  }
  if (!match) return null;

  const identifier = match.params.handle ?? match.params.did ?? '';
  if (!validIdentifier(identifier)) return null;
  // The `/did/…` form promises a DID; a handle there is a malformed URL, not a
  // second spelling of the same page.
  if (match.pattern.startsWith('/did/') && !isDid(identifier)) return null;

  const collection = ENTRY_ROUTES[match.pattern];
  if (!collection) return { identifier };

  const rkey = match.params.rkey ?? '';
  if (!validRkey(rkey)) return null;
  return { identifier, collection, rkey };
}

/** The tags a route emits once its identity is resolved to a DID. */
export function atTagsFor(route: AtTagRoute, did: string): AtTag[] {
  if (!isDid(did)) return [];
  const author: AtTag = { name: 'at:author', content: `at://${did}` };
  if (!route.collection || !route.rkey) return [author];
  return [{ name: 'at:canonical', content: `at://${did}/${route.collection}/${route.rkey}` }, author];
}

/**
 * Path in, tags out — resolving the handle to a DID only when the path carries one
 * (the durable `/did/…` permalinks need no network at all). An unresolvable handle
 * emits nothing: a tag pointing at a guess is worse than no tag.
 */
export async function resolveAtTags(
  pathname: string,
  resolveDid: (identifier: string) => Promise<string | null>,
): Promise<AtTag[]> {
  const route = atTagRoute(pathname);
  if (!route) return [];
  const did = isDid(route.identifier) ? route.identifier : await resolveDid(route.identifier);
  if (!did) return [];
  return atTagsFor(route, did);
}

const escapeAttr = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

/** Serialize tags for injection into `<head>` (the Pages middleware's HTMLRewriter). */
export function renderAtTags(tags: AtTag[]): string {
  return tags
    .map((t) => `<meta name="${escapeAttr(t.name)}" content="${escapeAttr(t.content)}" />`)
    .join('');
}
