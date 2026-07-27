import { describe, expect, it, vi } from 'vitest';
import { atTagRoute, atTagsFor, renderAtTags, resolveAtTags } from '../src/atTags.js';
import { COLLECTION } from '../src/config.js';
import { applyAtTags, syncAtTags } from '../src/ui/head.js';

/**
 * The at: meta tags (D-61) map a rolld page back to the record it renders, per the
 * community `at-tags` proposal. Two consumers share this logic: the Pages middleware
 * that injects the tags into the served HTML, and the SPA that keeps them honest
 * across client-side navigation. Both must agree, so the mapping lives here and is
 * tested here.
 */

describe('atTagRoute — which record a rolld path renders', () => {
  it('maps a handle-form play permalink to the play collection', () => {
    expect(atTagRoute('/@alice.test/play/3labcxyz')).toEqual({
      identifier: 'alice.test',
      collection: 'at.rolld.play',
      rkey: '3labcxyz',
    });
  });

  it('maps a handle-form rating permalink to the rating collection', () => {
    expect(atTagRoute('/@alice.test/rating/3labcxyz')).toEqual({
      identifier: 'alice.test',
      collection: 'at.rolld.rating',
      rkey: '3labcxyz',
    });
  });

  it('maps the durable DID-form permalink the same way (D-14)', () => {
    expect(atTagRoute('/did/did:plc:abc123/play/3labcxyz')).toEqual({
      identifier: 'did:plc:abc123',
      collection: 'at.rolld.play',
      rkey: '3labcxyz',
    });
  });

  it('maps person-scoped pages to an identity with no canonical record', () => {
    for (const path of ['/@alice.test', '/@alice.test/plays', '/@alice.test/g/224517']) {
      expect(atTagRoute(path)).toEqual({ identifier: 'alice.test' });
    }
  });

  it('ignores the query string', () => {
    expect(atTagRoute('/@alice.test/play/3lab?from=feed')).toEqual({
      identifier: 'alice.test',
      collection: 'at.rolld.play',
      rkey: '3lab',
    });
  });

  it('returns null for pages that render no record — game pages included', () => {
    for (const path of ['/', '/g/224517', '/g/224517/plays', '/dashboard', '/about', '/search']) {
      expect(atTagRoute(path)).toBeNull();
    }
  });

  it('names the collections the write path actually writes (config is the source of truth)', () => {
    expect(atTagRoute('/@alice.test/play/3lab')?.collection).toBe(COLLECTION.play);
    expect(atTagRoute('/@alice.test/rating/3lab')?.collection).toBe(COLLECTION.rating);
  });

  it('refuses an rkey outside the atproto record-key charset', () => {
    expect(atTagRoute('/@alice.test/play/3l"><script>')).toBeNull();
    expect(atTagRoute('/@alice.test/play/.')).toBeNull();
    expect(atTagRoute('/@alice.test/play/..')).toBeNull();
  });

  it('refuses a /did/ path whose identifier is not a DID', () => {
    expect(atTagRoute('/did/alice.test/play/3lab')).toBeNull();
    expect(atTagRoute('/did/did:plc:a b/play/3lab')).toBeNull();
  });

  it('refuses a handle outside the handle charset', () => {
    expect(atTagRoute('/@alice"onerror=x/plays')).toBeNull();
  });

  it('survives a malformed percent-escape instead of throwing', () => {
    expect(atTagRoute('/@alice.test/play/%zz')).toBeNull();
  });
});

describe('atTagsFor — the tags a resolved route emits', () => {
  it('gives an entry page a canonical record URI and its author', () => {
    expect(atTagsFor({ identifier: 'alice.test', collection: COLLECTION.play, rkey: '3lab' }, 'did:plc:abc')).toEqual([
      { name: 'at:canonical', content: 'at://did:plc:abc/at.rolld.play/3lab' },
      { name: 'at:author', content: 'at://did:plc:abc' },
    ]);
  });

  it('gives a person-scoped page an author only — no record backs the page', () => {
    expect(atTagsFor({ identifier: 'alice.test' }, 'did:plc:abc')).toEqual([
      { name: 'at:author', content: 'at://did:plc:abc' },
    ]);
  });

  it('emits nothing for a DID that fails validation', () => {
    expect(atTagsFor({ identifier: 'alice.test' }, 'not-a-did')).toEqual([]);
  });

  it('uses the collections the records are actually written to', () => {
    const [canonical] = atTagsFor(
      { identifier: 'a.test', collection: COLLECTION.rating, rkey: '3lab' },
      'did:plc:abc',
    );
    expect(canonical!.content).toBe(`at://did:plc:abc/${COLLECTION.rating}/3lab`);
  });
});

describe('resolveAtTags — path in, tags out, one identity resolution', () => {
  it('resolves a handle to a DID before building the tags', async () => {
    const resolve = vi.fn(async () => 'did:plc:abc');
    expect(await resolveAtTags('/@alice.test/play/3lab', resolve)).toEqual([
      { name: 'at:canonical', content: 'at://did:plc:abc/at.rolld.play/3lab' },
      { name: 'at:author', content: 'at://did:plc:abc' },
    ]);
    expect(resolve).toHaveBeenCalledWith('alice.test');
  });

  it('skips resolution entirely on the DID-form permalink', async () => {
    const resolve = vi.fn(async () => null);
    expect(await resolveAtTags('/did/did:plc:abc/rating/3lab', resolve)).toEqual([
      { name: 'at:canonical', content: 'at://did:plc:abc/at.rolld.rating/3lab' },
      { name: 'at:author', content: 'at://did:plc:abc' },
    ]);
    expect(resolve).not.toHaveBeenCalled();
  });

  it('emits nothing when the handle cannot be resolved', async () => {
    expect(await resolveAtTags('/@ghost.test/plays', async () => null)).toEqual([]);
  });

  it('emits nothing for an untagged path without calling the resolver', async () => {
    const resolve = vi.fn(async () => 'did:plc:abc');
    expect(await resolveAtTags('/g/224517', resolve)).toEqual([]);
    expect(resolve).not.toHaveBeenCalled();
  });
});

describe('renderAtTags — the HTML injected into <head>', () => {
  it('renders one self-closing meta per tag', () => {
    expect(
      renderAtTags([
        { name: 'at:canonical', content: 'at://did:plc:abc/at.rolld.play/3lab' },
        { name: 'at:author', content: 'at://did:plc:abc' },
      ]),
    ).toBe(
      '<meta name="at:canonical" content="at://did:plc:abc/at.rolld.play/3lab" />' +
        '<meta name="at:author" content="at://did:plc:abc" />',
    );
  });

  it('renders nothing for no tags', () => {
    expect(renderAtTags([])).toBe('');
  });

  it('escapes the content it is handed — the head is not a place to trust input', () => {
    expect(renderAtTags([{ name: 'at:author', content: 'at://x"><script>alert(1)</script>' }])).toBe(
      '<meta name="at:author" content="at://x&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;" />',
    );
  });
});

describe('applyAtTags — keeping the live DOM honest across SPA navigation', () => {
  it('adds the tags to the head', () => {
    document.head.innerHTML = '';
    applyAtTags([{ name: 'at:canonical', content: 'at://did:plc:abc/at.rolld.play/3lab' }]);
    const meta = document.head.querySelector('meta[name="at:canonical"]');
    expect(meta?.getAttribute('content')).toBe('at://did:plc:abc/at.rolld.play/3lab');
  });

  it('replaces the previous page tags instead of stacking them up', () => {
    document.head.innerHTML = '';
    applyAtTags([{ name: 'at:canonical', content: 'at://did:plc:abc/at.rolld.play/one' }]);
    applyAtTags([{ name: 'at:canonical', content: 'at://did:plc:abc/at.rolld.play/two' }]);
    const metas = document.head.querySelectorAll('meta[name="at:canonical"]');
    expect(metas.length).toBe(1);
    expect(metas[0]!.getAttribute('content')).toBe('at://did:plc:abc/at.rolld.play/two');
  });

  it('clears the tags on a page that has none, and leaves other meta alone', () => {
    document.head.innerHTML = '<meta name="description" content="rolld" />';
    applyAtTags([{ name: 'at:author', content: 'at://did:plc:abc' }]);
    applyAtTags([]);
    expect(document.head.querySelectorAll('meta[name^="at:"]').length).toBe(0);
    expect(document.head.querySelector('meta[name="description"]')).not.toBeNull();
  });
});

describe('syncAtTags — one navigation, one set of tags', () => {
  const atTags = () => [...document.head.querySelectorAll('meta[name^="at:"]')];

  it('drops the previous page tags before the new identity resolves', async () => {
    document.head.innerHTML = '<meta name="at:canonical" content="at://did:plc:abc/at.rolld.play/old" />';
    history.pushState(null, '', '/@alice.test/play/new');
    let release!: (did: string) => void;
    const pending = syncAtTags('/@alice.test/play/new', () => new Promise((r) => (release = r)));

    expect(atTags()).toHaveLength(0); // the gap must not show the old record

    release('did:plc:abc');
    await pending;
    expect(atTags()[0]?.getAttribute('content')).toBe('at://did:plc:abc/at.rolld.play/new');
  });

  it('discards a resolution that lands after the reader has navigated away', async () => {
    document.head.innerHTML = '';
    let release!: (did: string) => void;
    let path = '/@alice.test/play/one';
    const pending = syncAtTags(path, () => new Promise((r) => (release = r)), () => path);

    path = '/dashboard'; // the reader clicked on before Slingshot answered
    release('did:plc:abc');
    await pending;

    expect(atTags()).toHaveLength(0);
  });

  it('leaves the head clean on a page that renders no record', async () => {
    document.head.innerHTML = '<meta name="at:author" content="at://did:plc:abc" />';
    await syncAtTags('/g/224517', async () => 'did:plc:abc');
    expect(atTags()).toHaveLength(0);
  });
});
