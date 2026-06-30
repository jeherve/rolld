import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearGameCache,
  resolveGame,
  resolveGames,
  SearchError,
  searchGames,
} from '../src/bgg/resolveGame.js';
import type { GameMetadata } from '../src/bgg/types.js';

const meta = (id: string, name: string): GameMetadata => ({ id, name, fetchedAt: 'now' });

const ok = (body: unknown): Response =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

beforeEach(() => clearGameCache());

describe('resolveGame', () => {
  it('fetches /api/game/<id> from the Worker and returns metadata', async () => {
    const fetchImpl = vi.fn(async () => ok(meta('174430', 'Gloomhaven')));
    const m = await resolveGame('174430', { fetchImpl, baseUrl: 'https://w' });
    expect(m?.name).toBe('Gloomhaven');
    expect(fetchImpl).toHaveBeenCalledWith('https://w/api/game/174430', expect.anything());
  });

  it('memoizes — a second call makes no second request', async () => {
    const fetchImpl = vi.fn(async () => ok(meta('13', 'CATAN')));
    await resolveGame('13', { fetchImpl });
    await resolveGame('13', { fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('returns null on a 404 (caller falls back to the name snapshot, D-32)', async () => {
    const fetchImpl = vi.fn(async () => new Response('', { status: 404 }));
    expect(await resolveGame('999', { fetchImpl })).toBeNull();
  });

  it('returns null on a network failure — never throws (graceful degradation)', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('offline');
    });
    expect(await resolveGame('1', { fetchImpl })).toBeNull();
  });
});

describe('resolveGames', () => {
  it('requests only the un-memoized ids in one batch call', async () => {
    const fetchImpl = vi.fn(async () => ok([meta('1', 'A')]));
    await resolveGame('2', { fetchImpl: async () => ok(meta('2', 'B')) }); // seed memo
    const out = await resolveGames(['1', '2'], { fetchImpl, baseUrl: 'https://w' });
    expect(fetchImpl).toHaveBeenCalledWith('https://w/api/games?ids=1', expect.anything());
    expect(out.get('1')?.name).toBe('A');
    expect(out.get('2')?.name).toBe('B');
  });

  it('makes no request when everything is memoized', async () => {
    await resolveGame('5', { fetchImpl: async () => ok(meta('5', 'E')) });
    const fetchImpl = vi.fn(async () => ok([]));
    await resolveGames(['5'], { fetchImpl });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('searchGames', () => {
  it('returns candidates from the Worker search route', async () => {
    const fetchImpl = vi.fn(async () => ok([{ id: '13', name: 'CATAN', yearPublished: 1995 }]));
    const results = await searchGames('catan', { fetchImpl, baseUrl: 'https://w' });
    expect(results[0]?.id).toBe('13');
    expect(fetchImpl).toHaveBeenCalledWith('https://w/api/search?q=catan', expect.anything());
  });

  it('short-circuits queries under 2 chars without a request', async () => {
    const fetchImpl = vi.fn(async () => ok([]));
    expect(await searchGames('c', { fetchImpl })).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('throws SearchError on a failed request (CC-1 error state)', async () => {
    const fetchImpl = vi.fn(async () => new Response('', { status: 503 }));
    await expect(searchGames('catan', { fetchImpl })).rejects.toBeInstanceOf(SearchError);
  });
});
