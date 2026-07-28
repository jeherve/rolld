import { describe, expect, it, vi } from 'vitest';
import { fetchEntry, fetchGame } from '../functions/pageData.js';

/**
 * What the Pages middleware fetches before it can title a page (D-62). Two rules
 * decide every case here: the moderation gate fails CLOSED, exactly as `checkBlocked`
 * does on the render path (D-41/D-49) — a taken-down play must not leak its game or
 * its note into a meta tag, and neither must a play we simply couldn't clear. And the
 * author's PDS is user-chosen, so its answers are read defensively (Sec#1).
 */

const ORIGIN = 'https://rolld.at';
const PDS = 'https://pds.example.com';
const DID = 'did:plc:abc';
const URI = `at://${DID}/at.rolld.play/3lab`;

const record = { game: { id: '1', name: 'Battle Sheep' }, playedAt: '2026-07-26T00:00:00.000Z' };

/** A fetch stub routing by URL: moderation check, PDS read, Worker game lookup. */
function stubFetch(routes: {
  blocked?: { dids?: string[]; uris?: string[] };
  moderationStatus?: number;
  recordStatus?: number;
  recordBody?: unknown;
}): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/api/moderation/check')) {
      return new Response(JSON.stringify(routes.blocked ?? { dids: [], uris: [] }), {
        status: routes.moderationStatus ?? 200,
      });
    }
    if (url.includes('getRecord')) {
      return new Response(JSON.stringify(routes.recordBody ?? { uri: URI, value: record }), {
        status: routes.recordStatus ?? 200,
      });
    }
    return new Response('{}', { status: 404 });
  }) as unknown as typeof fetch;
}

const entryArgs = { origin: ORIGIN, pds: PDS, did: DID, collection: 'at.rolld.play', rkey: '3lab' };

describe('fetchEntry — the record behind an entry page, or nothing', () => {
  it('returns the record value when the moderation check comes back clean', async () => {
    const value = await fetchEntry({ ...entryArgs, fetchImpl: stubFetch({}) });
    expect(value?.game?.name).toBe('Battle Sheep');
  });

  it('returns nothing when the author is on the blocklist', async () => {
    const fetchImpl = stubFetch({ blocked: { dids: [DID] } });
    expect(await fetchEntry({ ...entryArgs, fetchImpl })).toBeNull();
  });

  it('returns nothing when the record itself is on the blocklist', async () => {
    const fetchImpl = stubFetch({ blocked: { uris: [URI] } });
    expect(await fetchEntry({ ...entryArgs, fetchImpl })).toBeNull();
  });

  it('fails closed when the moderation check errors', async () => {
    const fetchImpl = stubFetch({ moderationStatus: 500 });
    expect(await fetchEntry({ ...entryArgs, fetchImpl })).toBeNull();
  });

  it('fails closed when the moderation check throws', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('/api/moderation/check')) throw new Error('offline');
      return new Response(JSON.stringify({ value: record }), { status: 200 });
    }) as unknown as typeof fetch;
    expect(await fetchEntry({ ...entryArgs, fetchImpl })).toBeNull();
  });

  it('returns nothing when the record is missing', async () => {
    const fetchImpl = stubFetch({ recordStatus: 404 });
    expect(await fetchEntry({ ...entryArgs, fetchImpl })).toBeNull();
  });

  it('refuses to follow a redirect out of the PDS', async () => {
    const fetchImpl = stubFetch({ recordStatus: 302 });
    expect(await fetchEntry({ ...entryArgs, fetchImpl })).toBeNull();
    const call = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.find((c) =>
      String(c[0]).includes('getRecord'),
    );
    expect(call?.[1]).toMatchObject({ redirect: 'manual' });
  });

  it('returns nothing when the record has no usable value', async () => {
    const fetchImpl = stubFetch({ recordBody: { uri: URI } });
    expect(await fetchEntry({ ...entryArgs, fetchImpl })).toBeNull();
  });

  it('names the record it is clearing, so the check is about this entry', async () => {
    const fetchImpl = stubFetch({});
    await fetchEntry({ ...entryArgs, fetchImpl });
    const call = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.find((c) =>
      String(c[0]).includes('/api/moderation/check'),
    );
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({ dids: [DID], uris: [URI] });
  });
});

describe('fetchGame — catalog metadata for a game page title', () => {
  const gameFetch = (body: unknown, status = 200): typeof fetch =>
    vi.fn(async () => new Response(JSON.stringify(body), { status })) as typeof fetch;

  it('returns the name and year from the Worker', async () => {
    const game = await fetchGame(ORIGIN, '161936', {
      fetchImpl: gameFetch({ id: '161936', name: 'Pandemic Legacy: Season 1', year: 2015 }),
    });
    expect(game).toEqual({ name: 'Pandemic Legacy: Season 1', yearPublished: 2015 });
  });

  it('returns nothing when the Worker has no such game', async () => {
    expect(await fetchGame(ORIGIN, '1', { fetchImpl: gameFetch({}, 404) })).toBeNull();
  });

  it('returns nothing when the answer carries no name', async () => {
    expect(await fetchGame(ORIGIN, '1', { fetchImpl: gameFetch({ id: '1' }) })).toBeNull();
  });

  it('returns nothing when the lookup throws', async () => {
    const boom = vi.fn(async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    expect(await fetchGame(ORIGIN, '1', { fetchImpl: boom })).toBeNull();
  });
});
