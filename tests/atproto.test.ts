import { describe, expect, it, vi } from 'vitest';
import type { RolldAgent } from '../src/atproto/client.js';
import { searchActors } from '../src/atproto/people.js';
import {
  deletePlay,
  ensureProfile,
  rkeyFromUri,
  writePlay,
  writeRating,
} from '../src/atproto/records.js';
import type { GameRef } from '../src/records/types.js';

const GAME: GameRef = { id: '174430', name: 'Gloomhaven' };

/** A fake agent recording calls; getRecord returns whatever we seed. */
function fakeAgent(profile: unknown = null) {
  const calls: Record<string, unknown[]> = { create: [], put: [], del: [], get: [] };
  const agent = {
    did: 'did:plc:me',
    async getRecord(collection: string, rkey: string) {
      calls.get!.push([collection, rkey]);
      return profile;
    },
    async createRecord(collection: string, record: unknown) {
      calls.create!.push([collection, record]);
      return { uri: `at://did:plc:me/${collection}/3kgen`, cid: 'cid1' };
    },
    async putRecord(collection: string, rkey: string, record: unknown) {
      calls.put!.push([collection, rkey, record]);
      return { uri: `at://did:plc:me/${collection}/${rkey}`, cid: 'cid2' };
    },
    async deleteRecord(collection: string, rkey: string) {
      calls.del!.push([collection, rkey]);
    },
  };
  return { agent: agent as unknown as RolldAgent, calls };
}

describe('rkeyFromUri', () => {
  it('takes the last path segment', () => {
    expect(rkeyFromUri('at://did:plc:me/at.rolld.play/3kgen')).toBe('3kgen');
  });
});

describe('ensureProfile (D-25)', () => {
  it('creates the declaration when absent', async () => {
    const { agent, calls } = fakeAgent(null);
    await ensureProfile(agent);
    expect(calls.put).toHaveLength(1);
    expect((calls.put![0] as unknown[])[0]).toBe('at.rolld.profile');
  });

  it('skips when it already exists (preserves original createdAt)', async () => {
    const { agent, calls } = fakeAgent({ $type: 'at.rolld.profile', createdAt: 'x' });
    await ensureProfile(agent);
    expect(calls.put).toHaveLength(0);
  });
});

describe('writePlay', () => {
  it('writes a play (PDS assigns rkey) and ensures the profile first', async () => {
    const { agent, calls } = fakeAgent(null);
    const out = await writePlay(agent, { game: GAME });
    expect(calls.put).toHaveLength(1); // profile ensured
    expect((calls.create![0] as unknown[])[0]).toBe('at.rolld.play');
    expect(out.rkey).toBe('3kgen');
  });
});

describe('writeRating', () => {
  it('puts with rkey = the BGG id so re-rating overwrites (D-9)', async () => {
    const { agent, calls } = fakeAgent({ createdAt: 'x' });
    const out = await writeRating(agent, { game: GAME, rating: 9 });
    const put = calls.put!.find((c) => (c as unknown[])[0] === 'at.rolld.rating')! as unknown[];
    expect(put[1]).toBe('174430');
    expect(out.rkey).toBe('174430');
  });

  it('rejects an out-of-range rating before writing (validation guard)', async () => {
    const { agent, calls } = fakeAgent({ createdAt: 'x' });
    await expect(writeRating(agent, { game: GAME, rating: 11 })).rejects.toThrow(/rating/);
    expect(calls.put!.some((c) => (c as unknown[])[0] === 'at.rolld.rating')).toBe(false);
  });
});

describe('deletePlay', () => {
  it('deletes by rkey', async () => {
    const { agent, calls } = fakeAgent();
    await deletePlay(agent, '3kgen');
    expect(calls.del![0]).toEqual(['at.rolld.play', '3kgen']);
  });
});

describe('searchActors (CC-2)', () => {
  const ok = (actors: unknown[]): Response =>
    new Response(JSON.stringify({ actors }), { status: 200 });

  it('maps actor results to {did, handle, displayName, avatar}', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      ok([{ did: 'did:plc:a', handle: 'a.test', displayName: 'Ada', avatar: 'u', extra: 1 }]),
    );
    const out = await searchActors('ad', { fetchImpl });
    expect(out).toEqual([{ did: 'did:plc:a', handle: 'a.test', displayName: 'Ada', avatar: 'u' }]);
    expect(String(fetchImpl.mock.calls[0]![0])).toContain('searchActorsTypeahead?q=ad');
  });

  it('returns [] on a blank query and on a failed request', async () => {
    expect(await searchActors('   ')).toEqual([]);
    expect(await searchActors('x', { fetchImpl: async () => new Response('', { status: 500 }) })).toEqual([]);
  });
});
