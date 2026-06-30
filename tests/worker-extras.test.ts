import { afterEach, describe, expect, it, vi } from 'vitest';
import worker, { type Env, type KvStore } from '../worker/src/index.js';
import { blockedSubset, loadBlocklist } from '../worker/src/moderation.js';
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
