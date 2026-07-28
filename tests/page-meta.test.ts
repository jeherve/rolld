import { describe, expect, it } from 'vitest';
import { buildPageMeta, metaRoute, renderPageMeta, siteMeta } from '../src/pageMeta.js';
import { applyPageMeta, syncPageHead } from '../src/ui/head.js';
import type { PlayRecord, RatingRecord } from '../src/records/types.js';

/**
 * Per-page titles and descriptions (D-62). Same split as the `at:` tags: this pure
 * layer decides what every route says, the middleware and the SPA both consume it.
 * The rule underneath every case here — when we don't have a confident answer, we
 * say nothing and the static block in `index.html` stands.
 */

const play = (over: Partial<PlayRecord> = {}): PlayRecord => ({
  $type: 'at.rolld.play',
  game: { id: '161936', name: 'Pandemic Legacy: Season 1' },
  target: 'https://rolld.at/g/161936',
  playedAt: '2026-07-26T19:00:00.000Z',
  createdAt: '2026-07-26T20:00:00.000Z',
  ...over,
});

const rating = (over: Partial<RatingRecord> = {}): RatingRecord => ({
  $type: 'at.rolld.rating',
  game: { id: '161936', name: 'Pandemic Legacy: Season 1' },
  target: 'https://rolld.at/g/161936',
  rating: 8,
  createdAt: '2026-07-26T20:00:00.000Z',
  ...over,
});

describe('metaRoute — what a path is, and what it needs fetched', () => {
  it('reads an entry permalink in both the handle and the durable form', () => {
    expect(metaRoute('/@alice.test/play/3lab')).toEqual({
      kind: 'entry',
      identifier: 'alice.test',
      collection: 'at.rolld.play',
      rkey: '3lab',
    });
    expect(metaRoute('/did/did:plc:abc/rating/3lab')).toEqual({
      kind: 'entry',
      identifier: 'did:plc:abc',
      collection: 'at.rolld.rating',
      rkey: '3lab',
    });
  });

  it('reads the person-scoped pages', () => {
    expect(metaRoute('/@alice.test')).toEqual({ kind: 'person', identifier: 'alice.test' });
    expect(metaRoute('/@alice.test/plays')).toEqual({ kind: 'personPlays', identifier: 'alice.test' });
    expect(metaRoute('/@alice.test/g/161936')).toEqual({
      kind: 'personGame',
      identifier: 'alice.test',
      bggId: '161936',
    });
  });

  it('reads the game pages', () => {
    expect(metaRoute('/g/161936')).toEqual({ kind: 'game', bggId: '161936' });
    expect(metaRoute('/g/161936/plays')).toEqual({ kind: 'gamePlays', bggId: '161936' });
  });

  it('answers static routes outright, with nothing to fetch', () => {
    const about = metaRoute('/about');
    expect(about?.kind).toBe('static');
    expect(about?.meta?.title).toMatch(/rolld/);
    expect(metaRoute('/')?.kind).toBe('static');
    expect(metaRoute('/search')?.kind).toBe('static');
  });

  it('leaves the generic block alone for anything it does not recognise', () => {
    expect(metaRoute('/nowhere')).toBeNull();
    expect(metaRoute('/@alice.test/play/3l"><script>')).toBeNull();
    expect(metaRoute('/did/alice.test/play/3lab')).toBeNull();
    expect(metaRoute('/@alice.test/play/%zz')).toBeNull();
  });
});

describe('buildPageMeta — entry pages', () => {
  const route = { kind: 'entry', identifier: 'alice.test', collection: 'at.rolld.play', rkey: '3lab' } as const;

  it('names the player and the game, and quotes the note', () => {
    const meta = buildPageMeta(route, {
      handle: 'alice.test',
      record: play({ textContent: 'Another good game. We survived August.' }),
    });
    expect(meta?.title).toBe('@alice.test played Pandemic Legacy: Season 1');
    expect(meta?.description).toBe('“Another good game. We survived August.”');
  });

  it('falls back to a structural line when the play carries no note', () => {
    const meta = buildPageMeta(route, { handle: 'alice.test', record: play() });
    expect(meta?.description).toBe(
      'A play of Pandemic Legacy: Season 1, logged on rolld by @alice.test on 26 July 2026.',
    );
  });

  it('includes the score on a rating', () => {
    const meta = buildPageMeta(
      { kind: 'entry', identifier: 'alice.test', collection: 'at.rolld.rating', rkey: '161936' },
      { handle: 'alice.test', record: rating() },
    );
    expect(meta?.title).toBe('@alice.test rated Pandemic Legacy: Season 1 8/10');
    expect(meta?.description).toBe('@alice.test rated Pandemic Legacy: Season 1 8/10 on rolld.');
  });

  it('still names the game when the handle never resolved', () => {
    const meta = buildPageMeta(route, { record: play() });
    expect(meta?.title).toBe('Pandemic Legacy: Season 1 on rolld');
  });

  it('says nothing at all without the record — the generic block is the honest answer', () => {
    expect(buildPageMeta(route, { handle: 'alice.test' })).toBeNull();
    expect(buildPageMeta(route)).toBeNull();
  });

  it('survives a record whose game object is missing (a foreign writer, CC-guard)', () => {
    const broken = { $type: 'at.rolld.play', createdAt: '2026-07-26T20:00:00.000Z' } as unknown as PlayRecord;
    expect(buildPageMeta(route, { handle: 'alice.test', record: broken })).toBeNull();
  });

  it('collapses newlines so a multi-line note stays one clean sentence', () => {
    const meta = buildPageMeta(route, {
      handle: 'alice.test',
      record: play({ textContent: 'First line.\n\nSecond   line.\t Third.' }),
    });
    expect(meta?.description).toBe('“First line. Second line. Third.”');
  });

  it('truncates a long note rather than shipping a wall of text', () => {
    const meta = buildPageMeta(route, {
      handle: 'alice.test',
      record: play({ textContent: 'x'.repeat(400) }),
    });
    expect(meta!.description.length).toBeLessThanOrEqual(202); // 200 + the quotes
    expect(meta!.description).toContain('…');
  });

  it('truncates a very long title too', () => {
    const meta = buildPageMeta(route, {
      handle: 'alice.test',
      record: play({ game: { id: '1', name: 'A'.repeat(200) } }),
    });
    expect(meta!.title.length).toBeLessThanOrEqual(71);
    expect(meta!.title).toContain('…');
  });
});

describe('buildPageMeta — person and game pages', () => {
  it('describes a profile from the handle alone', () => {
    const meta = buildPageMeta({ kind: 'person', identifier: 'alice.test' }, { handle: 'alice.test' });
    expect(meta?.title).toBe('@alice.test on rolld');
    expect(meta?.description).toBe('Board game plays and ratings by @alice.test.');
  });

  it('describes a play log', () => {
    expect(
      buildPageMeta({ kind: 'personPlays', identifier: 'alice.test' }, { handle: 'alice.test' })?.title,
    ).toBe("@alice.test's play log");
  });

  it('names the game on a per-person game page, and copes when it cannot', () => {
    const route = { kind: 'personGame', identifier: 'alice.test', bggId: '161936' } as const;
    expect(
      buildPageMeta(route, { handle: 'alice.test', game: { name: 'Battle Sheep' } })?.title,
    ).toBe("@alice.test's plays of Battle Sheep");
    expect(buildPageMeta(route, { handle: 'alice.test' })?.title).toBe("@alice.test's plays");
  });

  it('titles a game page with the year when there is one', () => {
    const route = { kind: 'game', bggId: '161936' } as const;
    expect(
      buildPageMeta(route, { game: { name: 'Pandemic Legacy: Season 1', yearPublished: 2015 } })?.title,
    ).toBe('Pandemic Legacy: Season 1 (2015) — rolld');
    expect(buildPageMeta(route, { game: { name: 'Battle Sheep' } })?.title).toBe('Battle Sheep — rolld');
  });

  it('describes a game page without republishing BGG\'s own text (D-18)', () => {
    const meta = buildPageMeta({ kind: 'game', bggId: '161936' }, { game: { name: 'Battle Sheep' } });
    expect(meta?.description).toBe("See who's playing Battle Sheep on rolld, and log your own plays.");
  });

  it('says nothing for a game page whose metadata never arrived', () => {
    expect(buildPageMeta({ kind: 'game', bggId: '161936' })).toBeNull();
  });

  it('hands back the static route meta unchanged', () => {
    const route = metaRoute('/about')!;
    expect(buildPageMeta(route)).toEqual(route.meta);
  });
});

describe('renderPageMeta — which tag gets which value', () => {
  const meta = { title: 'A "great" play & more', description: 'Line <one>' };
  const url = 'https://rolld.at/@alice.test/play/3lab';

  /**
   * Values stay RAW here. Both consumers escape natively — HTMLRewriter when it
   * writes an attribute or `setInnerContent`, `setAttribute` in the DOM — so escaping
   * on this side would ship `&amp;quot;` to readers. Unlike the `at:` tags, which are
   * appended as HTML and therefore must be escaped by hand.
   */
  it('passes values through unescaped, because both consumers escape', () => {
    const tags = renderPageMeta(meta, url);
    expect(tags.title).toBe('A "great" play & more');
    expect(tags.attributes['og:title']).toBe('A "great" play & more');
    expect(tags.attributes['description']).toBe('Line <one>');
    expect(tags.attributes['og:description']).toBe('Line <one>');
  });

  it('carries the canonical page URL', () => {
    expect(renderPageMeta(meta, url).attributes['og:url']).toBe(url);
  });
});

describe('applyPageMeta — the head the reader sees while clicking around', () => {
  const head = () => ({
    title: document.title,
    description: document.head.querySelector('meta[name="description"]')?.getAttribute('content'),
    ogTitle: document.head.querySelector('meta[property="og:title"]')?.getAttribute('content'),
    ogUrl: document.head.querySelector('meta[property="og:url"]')?.getAttribute('content'),
  });

  const reset = () => {
    document.head.innerHTML =
      '<meta name="description" content="static" />' +
      '<meta property="og:title" content="static" />' +
      '<meta property="og:description" content="static" />' +
      '<meta property="og:url" content="https://rolld.at" />';
    document.title = 'static';
  };

  it('writes the title and every meta tag it owns', () => {
    reset();
    applyPageMeta({ title: 'A play', description: 'A note' }, 'https://rolld.at/@a.test/play/3lab');
    expect(head()).toEqual({
      title: 'A play',
      description: 'A note',
      ogTitle: 'A play',
      ogUrl: 'https://rolld.at/@a.test/play/3lab',
    });
  });

  it('falls back to the site copy when a page has nothing of its own to say', () => {
    reset();
    applyPageMeta({ title: 'A play', description: 'A note' }, 'https://rolld.at/x');
    applyPageMeta(null, 'https://rolld.at/dashboard');
    expect(head().title).toBe(siteMeta().title);
    expect(head().description).toBe(siteMeta().description);
    expect(head().ogUrl).toBe('https://rolld.at/dashboard');
  });

  it('never writes user text as markup', () => {
    reset();
    applyPageMeta({ title: '<script>x</script>', description: '"quoted"' }, 'https://rolld.at/x');
    expect(document.head.querySelector('script')).toBeNull();
    expect(head().ogTitle).toBe('<script>x</script>');
  });
});

describe('syncPageHead — what a navigation can say before any data loads', () => {
  const title = () => document.title;

  it('names the person straight from the URL, with nothing fetched', () => {
    history.pushState(null, '', '/@alice.test/plays');
    syncPageHead('/@alice.test/plays');
    expect(title()).toBe("@alice.test's play log");
  });

  it('uses the static copy on a static route', () => {
    history.pushState(null, '', '/about');
    syncPageHead('/about');
    expect(title()).toBe('About rolld');
  });

  it('resets to the site title on a page whose data has not arrived', () => {
    history.pushState(null, '', '/@alice.test/play/3lab');
    syncPageHead('/@alice.test/play/3lab');
    expect(title()).toBe(siteMeta().title);
  });

  it('resets on an unknown path rather than keeping the last page title', () => {
    history.pushState(null, '', '/@alice.test/plays');
    syncPageHead('/@alice.test/plays');
    history.pushState(null, '', '/nowhere');
    syncPageHead('/nowhere');
    expect(title()).toBe(siteMeta().title);
  });

  it('says nothing about a DID-form permalink it cannot name', () => {
    history.pushState(null, '', '/did/did:plc:abc/play/3lab');
    syncPageHead('/did/did:plc:abc/play/3lab');
    expect(title()).toBe(siteMeta().title);
  });
});
