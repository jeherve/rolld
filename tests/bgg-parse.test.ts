import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { decodeEntities, parseSearch, parseThing } from '../src/bgg/parse.js';

const fixture = (name: string): string =>
  readFileSync(resolve(process.cwd(), 'tests/fixtures', name), 'utf8');

const THING = fixture('bgg-thing-174430.xml');
const SEARCH = fixture('bgg-search-catan.xml');

describe('parseThing', () => {
  const meta = parseThing(THING, '2026-06-30T00:00:00.000Z');

  it('picks the primary name over alternates', () => {
    expect(meta.name).toBe('Gloomhaven');
    expect(meta.id).toBe('174430');
  });

  it('extracts the scalar fields', () => {
    expect(meta.year).toBe(2017);
    expect(meta.minPlayers).toBe(1);
    expect(meta.maxPlayers).toBe(4);
    expect(meta.minPlaytime).toBe(60);
    expect(meta.maxPlaytime).toBe(120);
    expect(meta.thumbnail).toContain('thumb');
    expect(meta.image).toContain('original');
  });

  it('reads weight and bggRating from the nested <statistics><ratings>', () => {
    // averageweight 3.8616, bayesaverage 8.51012 — the stats=1 block.
    expect(meta.weight).toBeCloseTo(3.8616, 4);
    expect(meta.bggRating).toBeCloseTo(8.51012, 4);
  });

  it('reads usersRated, the popularity signal search ranks on', () => {
    expect(meta.usersRated).toBe(55432);
  });

  it('filters <link> tags by type into categories and mechanics', () => {
    expect(meta.categories).toEqual(['Adventure', 'Exploration', 'Fantasy']);
    expect(meta.mechanics).toEqual([
      'Action Queue',
      'Campaign / Battle Card Driven',
      'Cooperative Game',
    ]);
  });

  it('decodes entities and newlines in the description', () => {
    expect(meta.description).toBeDefined();
    // &#10;&#10; → real paragraph break.
    expect(meta.description).toContain('\n\n');
    // &amp;amp; → literal ampersand; &amp;rsquo;/&amp;mdash; → typographic glyphs.
    expect(meta.description).toContain('skills & reasons');
    expect(meta.description).toContain('It’s a real campaign—don’t miss it.');
    // No undecoded entity residue.
    expect(meta.description).not.toContain('&amp;');
    expect(meta.description).not.toContain('&rsquo;');
    expect(meta.description).not.toContain('&#10;');
  });

  it('stamps the caller-provided fetchedAt', () => {
    expect(meta.fetchedAt).toBe('2026-06-30T00:00:00.000Z');
  });

  it('throws on a response with no item', () => {
    expect(() => parseThing('<items></items>', 'now')).toThrow(/no <item>/);
  });

  it('decodes double-encoded entities in the name and link labels', () => {
    // Regression: BGG double-encodes (`&amp;#039;` → `&#039;` after XML parse), so the
    // name/link decode pass must run too — not just the description. Real cases:
    // "Collector's Edition", the "Children's Game" category, "Print & Play".
    const xml = `<items><item type="boardgame" id="7"><name type="primary" value="Collector&amp;#039;s Caf&amp;eacute;"/>
      <link type="boardgamecategory" value="Children&amp;#039;s Game"/>
      <link type="boardgamemechanic" value="Print &amp;amp; Play"/>
    </item></items>`;
    const m = parseThing(xml, 'now');
    expect(m.name).toBe("Collector's Café");
    expect(m.categories).toEqual(["Children's Game"]);
    expect(m.mechanics).toEqual(['Print & Play']);
  });

  it('omits weight when averageweight is 0 (unrated game)', () => {
    const xml = `<items><item type="boardgame" id="9"><name type="primary" value="Obscure"/>
      <statistics><ratings><averageweight value="0"/><bayesaverage value="0"/></ratings></statistics>
    </item></items>`;
    const m = parseThing(xml, 'now');
    expect(m.weight).toBeUndefined();
    expect(m.bggRating).toBeUndefined();
  });
});

describe('parseSearch', () => {
  const candidates = parseSearch(SEARCH);

  it('returns id + name + year for each distinct game', () => {
    expect(candidates[0]).toEqual({ id: '13', name: 'CATAN', yearPublished: 1995 });
  });

  it('de-dupes repeated ids (primary + alternate name matches), keeping the primary', () => {
    const ids = candidates.map((c) => c.id);
    expect(ids).toEqual(['13', '178900', '276693', '328871']);
    // The alternate-name "Die Siedler von Catan" item shared id 13 and was dropped.
    expect(candidates.find((c) => c.id === '13')!.name).toBe('CATAN');
  });

  it('omits yearPublished when the result has none', () => {
    const starfarers = candidates.find((c) => c.id === '276693')!;
    expect(starfarers.name).toBe('Catan: Starfarers');
    expect(starfarers.yearPublished).toBeUndefined();
  });

  it('decodes double-encoded entities in candidate names', () => {
    // Regression: live search returned "Catan 3D Collector&#039;s Edition" verbatim.
    const xml = `<items total="1"><item type="boardgame" id="17419">
      <name type="primary" value="Catan 3D Collector&amp;#039;s Edition"/>
      <yearpublished value="2005"/></item></items>`;
    expect(parseSearch(xml)[0]).toEqual({
      id: '17419',
      name: "Catan 3D Collector's Edition",
      yearPublished: 2005,
    });
  });

  it('returns [] for a no-results response', () => {
    expect(parseSearch('<items total="0"></items>')).toEqual([]);
  });
});

describe('decodeEntities', () => {
  it('decodes numeric (decimal + hex) and named entities', () => {
    expect(decodeEntities('a&#10;b')).toBe('a\nb');
    expect(decodeEntities('&#x2014;')).toBe('—');
    expect(decodeEntities('tea &amp; cake')).toBe('tea & cake');
    expect(decodeEntities('don&rsquo;t')).toBe('don’t');
  });

  it('decodes currency, fractions, and accented Latin letters (European titles/designers)', () => {
    // Regression: a real BGG description (Brass: Birmingham) left `&pound;` visible.
    expect(decodeEntities('take a &pound;30 loan')).toBe('take a £30 loan');
    expect(decodeEntities('&euro;5 / &frac12; point')).toBe('€5 / ½ point');
    expect(decodeEntities('Reiner Knizia, Stefan Feld, K&uuml;hn')).toBe(
      'Reiner Knizia, Stefan Feld, Kühn',
    );
    expect(decodeEntities('caf&eacute; &middot; &ccedil;a')).toBe('café · ça');
  });

  it('leaves unknown entities untouched', () => {
    expect(decodeEntities('&unknownthing;')).toBe('&unknownthing;');
  });
});
