import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BggError, fetchThingXml } from '../worker/src/bgg.js';
import worker, { type Env, type KvStore } from '../worker/src/index.js';

const THING = readFileSync(resolve(process.cwd(), 'tests/fixtures/bgg-thing-174430.xml'), 'utf8');

const noSleep = (): Promise<void> => Promise.resolve();
const xml = (body: string, status = 200): Response =>
  new Response(body, { status, headers: { 'Content-Type': 'application/xml' } });

/** In-memory KV satisfying the Worker's structural `KvStore`. */
function fakeKv(): KvStore & { size: () => number } {
  const store = new Map<string, string>();
  return {
    async get(key: string, type?: 'json' | 'text') {
      const v = store.get(key);
      if (v === undefined) return null;
      return type === 'json' ? JSON.parse(v) : v;
    },
    async put(key: string, value: string) {
      store.set(key, value);
    },
    size: () => store.size,
  } as KvStore & { size: () => number };
}

const req = (path: string): Request => new Request(`https://rolld.at${path}`);

afterEach(() => vi.unstubAllGlobals());

describe('bgg fetch-with-retry', () => {
  it('retries a 202 (queued) then returns the body', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(xml('', 202))
      .mockResolvedValueOnce(xml('<items/>'));
    const out = await fetchThingXml('1', 'tok', { fetchImpl, sleep: noSleep });
    expect(out).toBe('<items/>');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('retries a 502 (transient) and a 503 (busy)', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(xml('', 502))
      .mockResolvedValueOnce(xml('', 503))
      .mockResolvedValueOnce(xml('<items/>'));
    expect(await fetchThingXml('1', 'tok', { fetchImpl, sleep: noSleep })).toBe('<items/>');
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('sends the Bearer token and throws (no retry) on 401', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(xml('Unauthorized', 401));
    await expect(fetchThingXml('1', 'secret', { fetchImpl, sleep: noSleep })).rejects.toBeInstanceOf(
      BggError,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const headers = (fetchImpl.mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer secret');
  });

  it('gives up after exhausting attempts', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(xml('', 503));
    await expect(
      fetchThingXml('1', 'tok', { fetchImpl, sleep: noSleep, maxAttempts: 3 }),
    ).rejects.toThrow(/after 3 attempts/);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });
});

describe('worker routes', () => {
  const env = (kv: KvStore): Env => ({ BGG_TOKEN: 'tok', BGG_CACHE: kv });

  it('serves /api/game/<id>, caches it, and hits cache on the second call', async () => {
    const kv = fakeKv();
    const fetchImpl = vi.fn(async () => xml(THING));
    vi.stubGlobal('fetch', fetchImpl);

    const r1 = await worker.fetch(req('/api/game/174430'), env(kv));
    expect(r1.status).toBe(200);
    expect((await r1.json()).name).toBe('Gloomhaven');
    expect(kv.size()).toBe(1);

    const r2 = await worker.fetch(req('/api/game/174430'), env(kv));
    expect((await r2.json()).name).toBe('Gloomhaven');
    // Second call served from KV — BGG fetched exactly once.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('returns 404 for a valid id BGG returns nothing for', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => xml('<items></items>')));
    const r = await worker.fetch(req('/api/game/000'), env(fakeKv()));
    expect(r.status).toBe(404);
    expect((await r.json()).error).toBe('GameNotFound');
  });

  it('serves /api/search ranked, covered, and short-TTL cached', async () => {
    const SEARCH = readFileSync(resolve(process.cwd(), 'tests/fixtures/bgg-search-catan.xml'), 'utf8');
    const kv = fakeKv();
    // Two upstream calls now: the search, then one `thing` hydrate for the top 20.
    const fetchImpl = vi.fn(async (url: string | URL | Request) =>
      String(url).includes('/search?') ? xml(SEARCH) : xml(THING),
    );
    vi.stubGlobal('fetch', fetchImpl);

    const r = await worker.fetch(req('/api/search?q=catan'), env(kv));
    const body = await r.json();
    expect(body[0].id).toBe('13');
    expect(body[0].name).toBe('CATAN');
    expect(body[0].yearPublished).toBe(1995);
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    await worker.fetch(req('/api/search?q=catan'), env(kv));
    expect(fetchImpl).toHaveBeenCalledTimes(2); // second query served from KV
  });

  it('merges the cover onto a hydrated candidate', async () => {
    const SEARCH = '<items><item id="174430"><name type="primary" value="Gloomhaven"/><yearpublished value="2017"/></item></items>';
    const fetchImpl = vi.fn(async (url: string | URL | Request) =>
      String(url).includes('/search?') ? xml(SEARCH) : xml(THING),
    );
    vi.stubGlobal('fetch', fetchImpl);

    const r = await worker.fetch(req('/api/search?q=gloomhaven'), env(fakeKv()));
    const body = await r.json();
    expect(body[0].thumbnail).toContain('thumb');
    expect(body[0].usersRated).toBe(55432);
  });

  // D-32: hydration is an enhancement. Losing it must cost covers, not search.
  it('still returns ranked candidates when hydration fails', async () => {
    const SEARCH = '<items><item id="174430"><name type="primary" value="Gloomhaven"/><yearpublished value="2017"/></item></items>';
    const fetchImpl = vi.fn(async (url: string | URL | Request) =>
      String(url).includes('/search?') ? xml(SEARCH) : xml('Unauthorized', 401),
    );
    vi.stubGlobal('fetch', fetchImpl);

    const r = await worker.fetch(req('/api/search?q=gloomhaven'), env(fakeKv()));
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body[0].name).toBe('Gloomhaven');
    expect(body[0].thumbnail).toBeUndefined();
  });

  // The 401 above never reaches the retry loop — `bggGet` throws on it immediately.
  // A *retryable* status is the slow path: on the default policy hydration would sleep
  // 5s+10s+20s before giving up, stalling a typed query for 35s to discard the covers
  // anyway. The call count is the real assertion — without it this passes unfixed.
  it('degrades immediately, without retrying, when hydration hits a busy BGG', async () => {
    const SEARCH = '<items><item id="174430"><name type="primary" value="Gloomhaven"/><yearpublished value="2017"/></item></items>';
    const fetchImpl = vi.fn(async (url: string | URL | Request) =>
      String(url).includes('/search?') ? xml(SEARCH) : xml('', 503),
    );
    vi.stubGlobal('fetch', fetchImpl);

    const r = await worker.fetch(req('/api/search?q=gloomhaven'), env(fakeKv()));
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body[0].name).toBe('Gloomhaven');
    expect(body[0].thumbnail).toBeUndefined();
    // One search + one hydrate attempt. Any more means the backoff ran.
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('returns [] for a too-short search without calling BGG', async () => {
    const fetchImpl = vi.fn(async () => xml('<items/>'));
    vi.stubGlobal('fetch', fetchImpl);
    const r = await worker.fetch(req('/api/search?q=a'), env(fakeKv()));
    expect(await r.json()).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('maps a BGG 401 to a 502 (service misconfigured)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => xml('Unauthorized', 401)));
    const r = await worker.fetch(req('/api/game/1'), env(fakeKv()));
    expect(r.status).toBe(502);
    expect((await r.json()).error).toBe('BggUnauthorized');
  });

  // Regression: an unbounded ?ids= list would drive sequential BGG calls and pin a
  // Worker invocation — DoS amplification (Sec#2).
  it('rejects an over-long /api/games ids list without calling BGG', async () => {
    const fetchImpl = vi.fn(async () => xml('<items/>'));
    vi.stubGlobal('fetch', fetchImpl);
    const ids = Array.from({ length: 101 }, (_v, i) => String(i + 1)).join(',');
    const r = await worker.fetch(req(`/api/games?ids=${ids}`), env(fakeKv()));
    expect(r.status).toBe(400);
    expect((await r.json()).error).toBe('TooManyIds');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('still serves a within-cap /api/games request', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => xml('<items></items>')));
    const r = await worker.fetch(req('/api/games?ids=1,2,3'), env(fakeKv()));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual([]); // BGG returned nothing, but the request was accepted
  });

  it('answers CORS preflight and sets the allow-origin header', async () => {
    const r = await worker.fetch(
      new Request('https://rolld.at/api/game/1', {
        method: 'OPTIONS',
        headers: { Origin: 'https://rolld.at' },
      }),
      env(fakeKv()),
    );
    expect(r.status).toBe(204);
    expect(r.headers.get('Access-Control-Allow-Origin')).toBe('https://rolld.at');
  });
});
