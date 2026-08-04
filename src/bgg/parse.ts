/**
 * BGG XML → typed data. Pure functions, no network, no Worker APIs —
 * so they unit-test thoroughly against recorded fixtures (the build philosophy:
 * test the pure logic hard, mock the network at the boundary).
 *
 * Two endpoints, two parsers:
 *   - `parseThing(xml)`  → GameMetadata   (xmlapi2/thing?id=…&stats=1)
 *   - `parseSearch(xml)` → SearchCandidate[] (xmlapi2/search?query=…)
 *
 * The `<statistics>` nesting (`<statistics><ratings><averageweight>` /
 * `<bayesaverage>`) and the entity-encoded `<description>` are the two things the
 * docs flag to get right; both are exercised by the fixtures.
 */
import { XMLParser } from 'fast-xml-parser';
import type { GameMetadata, SearchCandidate } from './types.js';

/** `<name>` and `<link>` repeat; force them to arrays so single-child cases don't collapse. */
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  textNodeName: '#text',
  parseAttributeValue: false,
  processEntities: true,
  isArray: (name) => name === 'name' || name === 'link' || name === 'item',
});

interface XmlAttr {
  type?: string;
  value?: string;
  id?: string;
}
type XmlNode = Record<string, unknown>;

function asArray<T>(v: T | T[] | undefined): T[] {
  if (v === undefined) return [];
  return Array.isArray(v) ? v : [v];
}

/**
 * Named HTML entities BGG leaves in `<description>` after XML decoding. Scoped to
 * what a board-game corpus actually contains: markup + typographic punctuation,
 * currency and fractions (prices in game descriptions), and the Latin-1 accented
 * letters that pepper European designer names and titles (Knizia, Kühn, Feld…).
 * Unknown `&…;` sequences are left untouched (see decodeEntities).
 */
const NAMED_ENTITIES: Record<string, string> = {
  // Markup + typographic.
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
  hellip: '…',
  bull: '•',
  middot: '·',
  laquo: '«',
  raquo: '»',
  sect: '§',
  para: '¶',
  dagger: '†',
  Dagger: '‡',
  prime: '′',
  Prime: '″',
  trade: '™',
  copy: '©',
  reg: '®',
  deg: '°',
  // Currency + math (prices and player counts show up in descriptions).
  pound: '£',
  euro: '€',
  cent: '¢',
  yen: '¥',
  times: '×',
  divide: '÷',
  minus: '−',
  plusmn: '±',
  frac12: '½',
  frac14: '¼',
  frac34: '¾',
  // Latin-1 accented letters — European designer names and game titles.
  agrave: 'à',
  aacute: 'á',
  acirc: 'â',
  atilde: 'ã',
  auml: 'ä',
  aring: 'å',
  aelig: 'æ',
  ccedil: 'ç',
  egrave: 'è',
  eacute: 'é',
  ecirc: 'ê',
  euml: 'ë',
  igrave: 'ì',
  iacute: 'í',
  icirc: 'î',
  iuml: 'ï',
  ntilde: 'ñ',
  ograve: 'ò',
  oacute: 'ó',
  ocirc: 'ô',
  otilde: 'õ',
  ouml: 'ö',
  oslash: 'ø',
  ugrave: 'ù',
  uacute: 'ú',
  ucirc: 'û',
  uuml: 'ü',
  yacute: 'ý',
  szlig: 'ß',
  Agrave: 'À',
  Aacute: 'Á',
  Auml: 'Ä',
  Aring: 'Å',
  AElig: 'Æ',
  Ccedil: 'Ç',
  Egrave: 'È',
  Eacute: 'É',
  Iacute: 'Í',
  Ntilde: 'Ñ',
  Oacute: 'Ó',
  Ouml: 'Ö',
  Oslash: 'Ø',
  Uacute: 'Ú',
  Uuml: 'Ü',
};

/**
 * Decode the entities BGG encodes in `<description>` text. fast-xml-parser already
 * resolves XML entities (`&amp;`, `&#10;`); BGG additionally HTML-encodes named
 * entities (often double-encoded, surfacing as `&rsquo;` after XML decode), which
 * this pass cleans up. Unknown `&…;` sequences are left untouched.
 */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (whole, body: string) => {
    if (body[0] === '#') {
      const codepoint =
        body[1] === 'x' || body[1] === 'X'
          ? parseInt(body.slice(2), 16)
          : parseInt(body.slice(1), 10);
      if (Number.isFinite(codepoint) && codepoint > 0 && codepoint <= 0x10ffff) {
        return String.fromCodePoint(codepoint);
      }
      return whole;
    }
    return NAMED_ENTITIES[body] ?? whole;
  });
}

function attrNumber(node: unknown): number | undefined {
  const raw = (node as XmlAttr | undefined)?.value;
  if (raw === undefined || raw === '') return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

/** Pick the `type="primary"` name, falling back to the first one present. */
function primaryName(names: XmlAttr[]): string | undefined {
  const primary = names.find((n) => n.type === 'primary');
  return (primary ?? names[0])?.value;
}

function linkValues(links: XmlAttr[], type: string): string[] {
  return links.filter((l) => l.type === type && l.value).map((l) => decodeEntities(l.value!));
}

function parseItem(item: XmlNode, fetchedAt: string): GameMetadata {
  const id = String((item as XmlAttr).id ?? '');
  const names = asArray(item.name) as XmlAttr[];
  const links = asArray(item.link) as XmlAttr[];
  const ratings = ((item.statistics as XmlNode | undefined)?.ratings ?? {}) as XmlNode;

  const text = (node: unknown): string | undefined => {
    if (node === undefined || node === null) return undefined;
    // A bare text element parses to a string; an element with attributes to { '#text': … }.
    const value = typeof node === 'object' ? (node as XmlNode)['#text'] : node;
    return value === undefined || value === '' ? undefined : String(value);
  };

  const description = text(item.description);
  const categories = linkValues(links, 'boardgamecategory');
  const mechanics = linkValues(links, 'boardgamemechanic');

  const meta: GameMetadata = {
    id,
    name: decodeEntities(primaryName(names) ?? ''),
    fetchedAt,
  };
  const year = attrNumber(item.yearpublished);
  if (year !== undefined) meta.year = year;
  const thumbnail = text(item.thumbnail);
  if (thumbnail) meta.thumbnail = thumbnail;
  const image = text(item.image);
  if (image) meta.image = image;
  if (description) meta.description = decodeEntities(description);
  const minPlayers = attrNumber(item.minplayers);
  if (minPlayers !== undefined) meta.minPlayers = minPlayers;
  const maxPlayers = attrNumber(item.maxplayers);
  if (maxPlayers !== undefined) meta.maxPlayers = maxPlayers;
  const minPlaytime = attrNumber(item.minplaytime);
  if (minPlaytime !== undefined) meta.minPlaytime = minPlaytime;
  const maxPlaytime = attrNumber(item.maxplaytime);
  if (maxPlaytime !== undefined) meta.maxPlaytime = maxPlaytime;
  const weight = attrNumber(ratings.averageweight);
  if (weight !== undefined && weight > 0) meta.weight = weight;
  const bggRating = attrNumber(ratings.bayesaverage);
  if (bggRating !== undefined && bggRating > 0) meta.bggRating = bggRating;
  const usersRated = attrNumber(ratings.usersrated);
  if (usersRated !== undefined && usersRated > 0) meta.usersRated = usersRated;
  if (categories.length) meta.categories = categories;
  if (mechanics.length) meta.mechanics = mechanics;
  return meta;
}

/**
 * Parse a `thing?id=…&stats=1` response into one `GameMetadata` per `<item>`. BGG
 * accepts up to 20 comma-joined ids per call, so a batch hydrate returns many.
 * `fetchedAt` is stamped by the caller (the Worker owns the clock).
 */
export function parseThings(xml: string, fetchedAt: string): GameMetadata[] {
  const root = parser.parse(xml) as XmlNode;
  const items = asArray((root.items as XmlNode | undefined)?.item) as XmlNode[];
  return items.map((item) => parseItem(item, fetchedAt));
}

/**
 * Parse a single-id `thing` response. Throws if the XML has no `<item>` (the caller
 * maps that to a not-found).
 */
export function parseThing(xml: string, fetchedAt: string): GameMetadata {
  const [first] = parseThings(xml, fetchedAt);
  if (!first) throw new Error('BGG thing response has no <item>');
  return first;
}

/**
 * Parse a `search?query=…&type=boardgame` response into candidates. Returns []
 * for a no-results response. De-dupes repeated ids (BGG lists primary + alternate
 * name matches as separate `<item>`s with the same id), keeping the first.
 */
export function parseSearch(xml: string): SearchCandidate[] {
  const root = parser.parse(xml) as XmlNode;
  const items = asArray((root.items as XmlNode | undefined)?.item) as XmlNode[];
  const seen = new Set<string>();
  const out: SearchCandidate[] = [];
  for (const item of items) {
    const id = String((item as XmlAttr).id ?? '');
    if (!id || seen.has(id)) continue;
    const names = asArray(item.name) as XmlAttr[];
    const name = primaryName(names);
    if (!name) continue;
    seen.add(id);
    const candidate: SearchCandidate = { id, name: decodeEntities(name) };
    const year = attrNumber(item.yearpublished);
    if (year !== undefined) candidate.yearPublished = year;
    out.push(candidate);
  }
  return out;
}
