import { describe, expect, it, vi } from 'vitest';
import { isUnverifiedHandle, resolveMiniDoc } from '../src/read/identity.js';
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
