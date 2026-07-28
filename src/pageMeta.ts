/**
 * Per-page titles and descriptions (D-62).
 *
 * `index.html` ships one static `<title>`/`og:*` block for the whole app, which
 * means a shared play link, a bookmark and a browser tab all read "rolld — log your
 * board game plays on atproto". This module decides what each route should say
 * instead. Like `atTags.ts` it stays pure and import-light (no DOM, no config) so
 * the Pages middleware and the browser can share one answer.
 *
 * The rule running through all of it: when we don't have a confident answer, we
 * return null and the static block stands. A wrong title is worse than a generic one.
 */
import { matchRoute } from './router/match.js';
import type { PlayRecord, RatingRecord } from './records/types.js';
import { formatDateLong, formatRating } from './ui/format.js';
import { truncateGraphemes } from './text/graphemes.js';

const TITLE_LIMIT = 70;
const DESCRIPTION_LIMIT = 200;

/** Collections, duplicated from `config.COLLECTION` to stay Worker-safe (see `atTags.ts`). */
const PLAY = 'at.rolld.play';
const RATING = 'at.rolld.rating';

export interface PageMeta {
  title: string;
  description: string;
}

export type MetaKind =
  | 'entry'
  | 'person'
  | 'personPlays'
  | 'personGame'
  | 'game'
  | 'gamePlays'
  | 'static';

export interface MetaRoute {
  kind: MetaKind;
  /** Handle or DID, for the routes that name a person. */
  identifier?: string;
  collection?: string;
  rkey?: string;
  bggId?: string;
  /** Static routes answer outright: nothing to fetch, the copy is right here. */
  meta?: PageMeta;
}

/**
 * A record as it comes off a PDS: unvalidated, so every field is treated as optional.
 * Foreign writers can omit anything, including lexicon-required fields (CC-guard).
 */
export type EntryRecord = Partial<Omit<PlayRecord, '$type'> & Omit<RatingRecord, '$type'>> & {
  $type?: string;
};

/** Whatever the caller managed to fetch. Every field is optional on purpose. */
export interface MetaData {
  /** The verified handle. Absent when identity resolution failed. */
  handle?: string;
  record?: EntryRecord;
  game?: { name: string; yearPublished?: number };
}

/* ---------------------------------- routes --------------------------------- */

/** The copy `index.html` ships with — the fallback whenever a page can't do better. */
const SITE: PageMeta = {
  title: 'rolld — log your board game plays on atproto',
  description:
    'Log the board games you play and rate them. Everything lives as records on your own atproto account — no database, nothing to lock you in.',
};

/** The site-wide title and description, for callers that need somewhere to fall back to. */
export const siteMeta = (): PageMeta => SITE;

const STATIC: Record<string, PageMeta> = {
  '/': SITE,
  '/about': {
    title: 'About rolld',
    description: 'Why rolld keeps your game log on your own account, and how it works.',
  },
  '/search': {
    title: 'Find a game — rolld',
    description: 'Search BoardGameGeek for a game to log or rate on rolld.',
  },
  '/login': {
    title: 'Sign in — rolld',
    description: 'Sign in with your atproto account to log plays and rate games on rolld.',
  },
  '/dashboard': { title: 'Your games — rolld', description: 'Your plays, ratings and what your friends have been playing.' },
  '/settings': { title: 'Settings — rolld', description: 'Your rolld account settings.' },
  '/community-guidelines': {
    title: 'Community guidelines — rolld',
    description: 'What rolld expects of the people using it, and how to report a problem.',
  },
  '/terms': { title: 'Terms — rolld', description: 'The terms of use for rolld.' },
  '/privacy': { title: 'Privacy — rolld', description: 'What rolld stores, and where.' },
};

const ENTRY_ROUTES: Record<string, string> = {
  '/@:handle/play/:rkey': PLAY,
  '/@:handle/rating/:rkey': RATING,
  '/did/:did/play/:rkey': PLAY,
  '/did/:did/rating/:rkey': RATING,
};
const PERSON_ROUTES: Record<string, MetaKind> = {
  '/@:handle': 'person',
  '/@:handle/plays': 'personPlays',
  '/@:handle/g/:bggId': 'personGame',
};
const GAME_ROUTES: Record<string, MetaKind> = {
  '/g/:bggId': 'game',
  '/g/:bggId/plays': 'gamePlays',
};
const PATTERNS = [
  ...Object.keys(ENTRY_ROUTES),
  ...Object.keys(PERSON_ROUTES),
  ...Object.keys(GAME_ROUTES),
];

// Same validation as the `at:` tags: these values come from the URL and end up in
// HTML attributes, so anything outside the atproto/BGG shapes is not a real page.
const RKEY = /^[A-Za-z0-9._~:-]{1,512}$/;
const DID = /^did:[a-z]+:[a-zA-Z0-9._%:-]{1,2048}$/;
const HANDLE = /^[a-zA-Z0-9][a-zA-Z0-9.-]{0,252}$/;
const BGG_ID = /^[0-9]{1,12}$/;

const validRkey = (rkey: string): boolean => RKEY.test(rkey) && rkey !== '.' && rkey !== '..';
const validIdentifier = (id: string): boolean =>
  DID.test(id) || (HANDLE.test(id) && id.includes('.'));

/** What this path is, and what it needs before it can say anything. */
export function metaRoute(pathname: string): MetaRoute | null {
  const path = pathname.split('?')[0]!;
  const fixed = STATIC[path];
  if (fixed) return { kind: 'static', meta: fixed };

  let match;
  try {
    match = matchRoute(PATTERNS, path);
  } catch {
    return null; // a broken percent-escape isn't a page
  }
  if (!match) return null;

  const bggId = match.params.bggId;
  if (bggId !== undefined && !BGG_ID.test(bggId)) return null;

  const gameKind = GAME_ROUTES[match.pattern];
  if (gameKind) return { kind: gameKind, bggId: bggId! };

  const identifier = match.params.handle ?? match.params.did ?? '';
  if (!validIdentifier(identifier)) return null;
  if (match.pattern.startsWith('/did/') && !DID.test(identifier)) return null;

  const personKind = PERSON_ROUTES[match.pattern];
  if (personKind) {
    return personKind === 'personGame'
      ? { kind: personKind, identifier, bggId: bggId! }
      : { kind: personKind, identifier };
  }

  const collection = ENTRY_ROUTES[match.pattern]!;
  const rkey = match.params.rkey ?? '';
  if (!validRkey(rkey)) return null;
  return { kind: 'entry', identifier, collection, rkey };
}

/* ----------------------------------- copy ---------------------------------- */

/** One line, no runs of whitespace — a description is a sentence, not a layout. */
const oneLine = (text: string): string => text.replace(/\s+/g, ' ').trim();

/** Truncate with an ellipsis, so a cut is visible rather than a mysterious stop. */
function clamp(text: string, limit: number): string {
  const trimmed = oneLine(text);
  if (trimmed.length <= limit) return trimmed;
  const cut = truncateGraphemes(trimmed, limit - 1);
  return cut.length < trimmed.length ? `${cut.trimEnd()}…` : trimmed;
}

const at = (handle: string): string => `@${handle}`;

function entryMeta(route: MetaRoute, data: MetaData): PageMeta | null {
  const record = data.record;
  // Foreign records arrive unvalidated and can be missing the lexicon-required
  // `game` object; the render path guards against it and so must we (CC-guard).
  const name = record?.game?.name;
  if (!record || typeof name !== 'string' || name.length === 0) return null;

  const who = data.handle ? at(data.handle) : null;
  const isRating = route.collection === RATING;
  const score = isRating && typeof record.rating === 'number' ? ` ${formatRating(record.rating)}` : '';

  const title = who
    ? isRating
      ? `${who} rated ${name}${score}`
      : `${who} played ${name}`
    : `${name} on rolld`;

  const note = typeof record.textContent === 'string' ? oneLine(record.textContent) : '';
  let description: string;
  if (note.length > 0) {
    description = `“${clamp(note, DESCRIPTION_LIMIT)}”`;
  } else if (isRating) {
    description = `${who ?? 'Someone'} rated ${name}${score} on rolld.`;
  } else {
    const played = formatDateLong(record.playedAt ?? record.createdAt ?? '');
    const by = who ? ` by ${who}` : '';
    const on = played ? ` on ${played}` : '';
    description = `A play of ${name}, logged on rolld${by}${on}.`;
  }

  return { title: clamp(title, TITLE_LIMIT), description: clamp(description, DESCRIPTION_LIMIT + 2) };
}

/** Turn a route plus whatever we know into a title and description, or null. */
export function buildPageMeta(route: MetaRoute, data: MetaData = {}): PageMeta | null {
  if (route.kind === 'static') return route.meta ?? null;
  if (route.kind === 'entry') return entryMeta(route, data);

  const name = data.game?.name;

  if (route.kind === 'game' || route.kind === 'gamePlays') {
    if (!name) return null;
    if (route.kind === 'gamePlays') {
      return {
        title: clamp(`Plays of ${name} on rolld`, TITLE_LIMIT),
        description: clamp(`Every play of ${name} logged on rolld.`, DESCRIPTION_LIMIT),
      };
    }
    const year = data.game?.yearPublished;
    return {
      title: clamp(`${name}${year ? ` (${year})` : ''} — rolld`, TITLE_LIMIT),
      // BGG's own game text stays on BGG (D-18); this says what rolld adds.
      description: clamp(
        `See who's playing ${name} on rolld, and log your own plays.`,
        DESCRIPTION_LIMIT,
      ),
    };
  }

  const who = data.handle ? at(data.handle) : null;
  if (!who) return null;

  if (route.kind === 'personGame') {
    return {
      title: clamp(name ? `${who}'s plays of ${name}` : `${who}'s plays`, TITLE_LIMIT),
      description: clamp(
        name ? `Every play of ${name} that ${who} has logged on rolld.` : `Board game plays logged by ${who} on rolld.`,
        DESCRIPTION_LIMIT,
      ),
    };
  }
  if (route.kind === 'personPlays') {
    return {
      title: clamp(`${who}'s play log`, TITLE_LIMIT),
      description: clamp(`Every board game play ${who} has logged on rolld.`, DESCRIPTION_LIMIT),
    };
  }
  return {
    title: clamp(`${who} on rolld`, TITLE_LIMIT),
    description: clamp(`Board game plays and ratings by ${who}.`, DESCRIPTION_LIMIT),
  };
}

/* ---------------------------------- output --------------------------------- */

export interface RenderedMeta {
  /** Text for `<title>`. */
  title: string;
  /** Attribute values keyed by the tag they belong to. */
  attributes: Record<string, string>;
}

/**
 * Shape the meta for whoever writes it into the head: the `<title>` text plus the
 * `content` of each meta tag.
 *
 * Values are RAW. Both consumers escape on their own — HTMLRewriter escapes what
 * `setAttribute`/`setInnerContent` write, and so does the DOM — so escaping here would
 * ship `&amp;quot;` to readers. (The `at:` tags are different: they're appended as raw
 * HTML, so `atTags.ts` escapes them by hand.)
 */
export function renderPageMeta(meta: PageMeta, url: string): RenderedMeta {
  return {
    title: meta.title,
    attributes: {
      description: meta.description,
      'og:title': meta.title,
      'og:description': meta.description,
      'og:url': url,
    },
  };
}
