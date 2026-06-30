import { afterEach, describe, expect, it, vi } from 'vitest';
import worker, { type Env, type KvStore } from '../worker/src/index.js';
import { blockedSubset, loadBlocklist } from '../worker/src/moderation.js';
import { safeUpstreamOrigin } from '../worker/src/http.js';
import { buildRss, toRfc822 } from '../worker/src/rss.js';

function fakeKv(seed: Record<string, string> = {}): KvStore {
  const store = new Map<string, string>(Object.entries(seed));
  return {
    async get(key: string, type?: 'json' | 'text') {
      const v = store.get(key);
      if (v === undefined) return null;
      return type === 'json' ? JSON.parse(v) : v;
    },
    async put(key: string, value: string) {
      store.set(key, value);
    },
  } as KvStore;
}

const env = (kv: KvStore): Env => ({ BGG_TOKEN: 'tok', BGG_CACHE: kv });

afterEach(() => vi.unstubAllGlobals());

describe('RSS serialization (D-42)', () => {
  it('converts ISO dates to RFC 822', () => {
    expect(toRfc822('2026-06-30T12:00:00.000Z')).toBe('Tue, 30 Jun 2026 12:00:00 GMT');
  });

  it('builds a valid RSS document and XML-escapes text', () => {
    const xml = buildRss({
      title: 'me on rolld',
      link: 'https://rolld.at/@me',
      description: 'plays & ratings',
      selfUrl: 'https://rolld.at/@me/feed.xml',
      items: [
        {
          title: 'Played Tea & Trade',
          link: 'https://rolld.at/@me/play/3k',
          guid: 'at://did/at.rolld.play/3k',
          isoDate: '2026-06-30T12:00:00Z',
        },
      ],
    });
    expect(xml).toContain('<rss version="2.0"');
    expect(xml).toContain('<description>plays &amp; ratings</description>');
    expect(xml).toContain('<title>Played Tea &amp; Trade</title>');
    expect(xml).toContain('<pubDate>Tue, 30 Jun 2026 12:00:00 GMT</pubDate>');
    expect(xml).toContain('rel="self"');
  });

  // Regression: a record with no usable date fell back to '' upstream, and
  // toRfc822('') emitted a literal "Invalid Date", making the whole feed ill-formed.
  it('omits pubDate for an unparseable date rather than emitting "Invalid Date"', () => {
    expect(toRfc822('')).toBe('');
    expect(toRfc822('not-a-date')).toBe('');
    const xml = buildRss({
      title: 't',
      link: 'https://rolld.at/@me',
      description: 'd',
      items: [{ title: 'x', link: 'https://l', guid: 'g', isoDate: '' }],
    });
    expect(xml).not.toContain('Invalid Date');
    expect(xml).not.toContain('<pubDate>');
  });

  // Regression: C0 control chars are illegal in XML 1.0 and would break parsing of
  // the entire document for every subscriber.
  it('strips illegal XML control characters from user text', () => {
    const xml = buildRss({
      title: 'me',
      link: 'https://rolld.at/@me',
      description: 'd',
      items: [
        {
          title: 'title\x0Cwith\x07controls',
          link: 'https://l',
          guid: 'g',
          isoDate: '2026-06-30T12:00:00Z',
          description: 'body\x0Cwith\x1Fcontrols',
        },
      ],
    });
    expect(xml).not.toMatch(/[\x00-\x08\x0B\x0C\x0E-\x1F]/);
    expect(xml).toContain('<title>titlewithcontrols</title>');
    expect(xml).toContain('<description>bodywithcontrols</description>');
  });
});

describe('moderation blocklist (D-41)', () => {
  it('loads an empty blocklist when KV has no entry', async () => {
    expect(await loadBlocklist(fakeKv())).toEqual({ dids: [], uris: [] });
  });

  it('blockedSubset returns only the named items that are blocked (no enumeration)', () => {
    const bl = { dids: ['did:plc:bad'], uris: ['at://did/x/1'] };
    expect(
      blockedSubset(bl, { dids: ['did:plc:good', 'did:plc:bad'], uris: ['at://did/x/2'] }),
    ).toEqual({ dids: ['did:plc:bad'], uris: [] });
  });
});

describe('worker moderation + feed routes', () => {
  it('POST /api/moderation/check echoes the blocked subset', async () => {
    const kv = fakeKv({
      'moderation:blocklist': JSON.stringify({ dids: ['did:plc:bad'], uris: [] }),
    });
    const req = new Request('https://rolld.at/api/moderation/check', {
      method: 'POST',
      body: JSON.stringify({ dids: ['did:plc:bad', 'did:plc:ok'] }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await worker.fetch(req, env(kv));
    expect(await res.json()).toEqual({ dids: ['did:plc:bad'], uris: [] });
  });

  it('GET /api/blob clamps a non-image content-type to octet-stream with nosniff (XSS guard)', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const u = String(input);
      if (u.includes('resolveMiniDoc')) {
        return new Response(JSON.stringify({ did: 'did:plc:x', handle: 'x.test', pds: 'https://pds.test' }), {
          status: 200,
        });
      }
      // A malicious "image" blob served as text/html by the PDS.
      return new Response('<script>alert(1)</script>', {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      });
    });
    vi.stubGlobal('fetch', fetchImpl);
    const res = await worker.fetch(
      new Request('https://rolld.at/api/blob/did:plc:x/bafyimg'),
      env(fakeKv()),
    );
    expect(res.headers.get('Content-Type')).toBe('application/octet-stream');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('Content-Security-Policy')).toContain('sandbox');
  });

  it('GET /api/blob refuses a blocked DID (D-41)', async () => {
    const kv = fakeKv({ 'moderation:blocklist': JSON.stringify({ dids: ['did:plc:bad'], uris: [] }) });
    const res = await worker.fetch(
      new Request('https://rolld.at/api/blob/did:plc:bad/bafyimg'),
      env(kv),
    );
    expect(res.status).toBe(404);
  });

  it('passes through a real image content-type', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const u = String(input);
      if (u.includes('resolveMiniDoc')) {
        return new Response(JSON.stringify({ did: 'did:plc:x', handle: 'x.test', pds: 'https://pds.test' }), {
          status: 200,
        });
      }
      return new Response('jpegbytes', { status: 200, headers: { 'Content-Type': 'image/jpeg' } });
    });
    vi.stubGlobal('fetch', fetchImpl);
    const res = await worker.fetch(new Request('https://rolld.at/api/blob/did:plc:x/c'), env(fakeKv()));
    expect(res.headers.get('Content-Type')).toBe('image/jpeg');
  });

  // Regression (Sec#1): the PDS endpoint comes from an attacker-controllable
  // identity doc. A self-chosen endpoint pointing at an internal host must NOT be
  // fetched — otherwise the blob proxy is an SSRF tool.
  it('refuses to fetch a blob from an unsafe (internal/IP) PDS endpoint', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const u = String(input);
      if (u.includes('resolveMiniDoc')) {
        // Attacker's did:web points its PDS at the cloud metadata endpoint.
        return new Response(JSON.stringify({ did: 'did:web:evil', handle: 'evil', pds: 'https://169.254.169.254' }), {
          status: 200,
        });
      }
      throw new Error('SSRF: getBlob must never be fetched for an unsafe PDS');
    });
    vi.stubGlobal('fetch', fetchImpl);
    const res = await worker.fetch(
      new Request('https://rolld.at/api/blob/did:web:evil/bafy'),
      env(fakeKv()),
    );
    expect(res.status).toBe(404);
    // resolveMiniDoc was the only fetch; getBlob was never reached.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  describe('safeUpstreamOrigin (SSRF guard)', () => {
    it('accepts a normal https PDS and returns its bare origin', () => {
      expect(safeUpstreamOrigin('https://pds.example.com/some/path?x=1')).toBe('https://pds.example.com');
      expect(safeUpstreamOrigin('https://bsky.social')).toBe('https://bsky.social');
    });

    it('rejects non-https, IP literals, localhost and single-label hosts', () => {
      expect(safeUpstreamOrigin('http://pds.example.com')).toBeNull(); // not https
      expect(safeUpstreamOrigin('https://169.254.169.254')).toBeNull(); // metadata IP
      expect(safeUpstreamOrigin('https://127.0.0.1')).toBeNull();
      expect(safeUpstreamOrigin('https://localhost')).toBeNull();
      expect(safeUpstreamOrigin('https://[::1]')).toBeNull(); // IPv6 literal
      expect(safeUpstreamOrigin('https://internal')).toBeNull(); // single-label
      expect(safeUpstreamOrigin('not a url')).toBeNull();
    });
  });

  it('GET /@<handle>/feed.xml resolves, reads plays, and serializes RSS', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const u = String(input);
      if (u.includes('resolveMiniDoc')) {
        return new Response(
          JSON.stringify({ did: 'did:plc:me', handle: 'me.test', pds: 'https://pds.test' }),
          { status: 200 },
        );
      }
      if (u.includes('collection=at.rolld.play')) {
        return new Response(
          JSON.stringify({
            records: [
              {
                uri: 'at://did:plc:me/at.rolld.play/3k',
                value: { game: { name: 'Catan' }, playedAt: '2026-06-30T00:00:00Z' },
              },
            ],
          }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ records: [] }), { status: 200 }); // ratings
    });
    vi.stubGlobal('fetch', fetchImpl);

    const res = await worker.fetch(new Request('https://rolld.at/@me.test/feed.xml'), env(fakeKv()));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('application/rss+xml');
    const xml = await res.text();
    expect(xml).toContain('<title>Played Catan</title>');
    expect(xml).toContain('https://rolld.at/@me.test/play/3k');
  });
});
