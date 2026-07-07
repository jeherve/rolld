import { describe, expect, it, vi } from 'vitest';
import type { Client } from '@atcute/client';
import { isUnverifiedHandle, resolveMiniDoc } from '../src/read/identity.js';
import { getProfiles, searchActors } from '../src/read/bsky.js';
import { playsToFeedItems } from '../src/read/friends.js';
import { gameTargetUrl } from '../src/links.js';
import type { PlayRecord } from '../src/records/types.js';
import type { RepoRecord } from '../src/read/repo.js';

describe('resolveMiniDoc (Slingshot, D-14)', () => {
  it('maps the MiniDoc and surfaces the unverified-handle sentinel', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          did: 'did:plc:abc',
          handle: 'handle.invalid',
          pds: 'https://pds.example',
          signing_key: 'zkey',
        }),
        { status: 200 },
      ),
    );
    const doc = (await resolveMiniDoc('alice.test', { fetchImpl }))!;
    expect(doc).toEqual({
      did: 'did:plc:abc',
      handle: 'handle.invalid',
      pds: 'https://pds.example',
      signingKey: 'zkey',
    });
    expect(isUnverifiedHandle(doc)).toBe(true);
  });

  it('returns null on failure (graceful degradation)', async () => {
    expect(await resolveMiniDoc('x', { fetchImpl: async () => new Response('', { status: 400 }) })).toBeNull();
  });
});

describe('playsToFeedItems (D-26)', () => {
  it('maps repo records to feed items with the own marker', () => {
    const rec: RepoRecord<PlayRecord> = {
      uri: 'at://did:plc:me/at.rolld.play/3k',
      cid: 'cid',
      rkey: '3k',
      value: {
        $type: 'at.rolld.play',
        game: { id: '13', name: 'Catan' },
        target: gameTargetUrl('13'),
        playedAt: '2026-06-30T00:00:00Z',
        createdAt: '2026-06-30T00:00:00Z',
      },
    };
    const [item] = playsToFeedItems('did:plc:me', [rec], true);
    expect(item).toMatchObject({ uri: rec.uri, authorDid: 'did:plc:me', rkey: '3k', isOwn: true });
    expect(item!.play.game.name).toBe('Catan');
  });
});

/* ---- batched profile hydration (perf: avoid the N+1 on getProfile) ---- */

// A fake atcute Client whose `get` runs `impl(params)`. `ok()` unwraps `{ ok, data }`.
const fakeAppview = (impl: (actors: string[]) => unknown): Client =>
  ({ get: (_nsid: string, opts: { params: { actors: string[] } }) => impl(opts.params.actors) }) as unknown as Client;

describe('getProfiles — batched, chunked, fault-tolerant', () => {
  it('chunks into groups of 25, dedupes, and merges the results', async () => {
    const calls: number[] = [];
    const client = fakeAppview((actors) => {
      calls.push(actors.length);
      return { ok: true, data: { profiles: actors.map((did) => ({ did, handle: `${did}.test` })) } };
    });
    const dids = Array.from({ length: 30 }, (_v, i) => `did:plc:${i}`);
    const profiles = await getProfiles(client, [...dids, dids[0]!]); // includes a duplicate
    expect(calls).toEqual([25, 5]); // ceil(30 unique / 25) = 2 requests, not 30
    expect(profiles).toHaveLength(30);
    expect(profiles[0]).toMatchObject({ did: 'did:plc:0', handle: 'did:plc:0.test' });
  });

  it('degrades a failed chunk to empty rather than throwing the whole batch', async () => {
    const client = fakeAppview(() => {
      throw new Error('appview unavailable');
    });
    await expect(getProfiles(client, ['did:plc:a', 'did:plc:b'])).resolves.toEqual([]);
  });
});

/* ---- player-tag typeahead (D-56) ---- */

const fakeTypeahead = (impl: (q: string) => unknown): Client =>
  ({ get: (_nsid: string, opts: { params: { q: string } }) => impl(opts.params.q) }) as unknown as Client;

describe('searchActors — network-wide handle typeahead (D-56)', () => {
  it('maps actors to suggestions, keeping displayName/avatar optional', async () => {
    const client = fakeTypeahead(() => ({
      ok: true,
      data: {
        actors: [
          { did: 'did:plc:a', handle: 'alice.bsky.social', displayName: 'Alice', avatar: 'https://x/a.png' },
          { did: 'did:plc:b', handle: 'bob.test' },
        ],
      },
    }));
    await expect(searchActors('al', { client })).resolves.toEqual([
      { did: 'did:plc:a', handle: 'alice.bsky.social', displayName: 'Alice', avatar: 'https://x/a.png' },
      { did: 'did:plc:b', handle: 'bob.test' },
    ]);
  });

  it('skips the request entirely for a blank query', async () => {
    const client = fakeTypeahead(() => {
      throw new Error('should not be called');
    });
    await expect(searchActors('   ', { client })).resolves.toEqual([]);
  });

  it('degrades to empty on failure, so the name field still works as free text (D-15)', async () => {
    const client = fakeTypeahead(() => {
      throw new Error('typeahead down');
    });
    await expect(searchActors('alice', { client })).resolves.toEqual([]);
  });
});
