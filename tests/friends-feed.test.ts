import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the network-glue deps; keep feed.js (mergeFeed) real — it's pure.
const h = vi.hoisted(() => ({
  getFollows: vi.fn(),
  resolveMiniDoc: vi.fn(),
  listPlays: vi.fn(),
}));

vi.mock('../src/read/bsky.js', () => ({ appviewClient: () => ({}), getFollows: h.getFollows }));
vi.mock('../src/read/identity.js', () => ({ resolveMiniDoc: h.resolveMiniDoc }));
vi.mock('../src/read/repo.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/read/repo.js')>()),
  pdsClient: (url: string) => ({ url }) as never,
  listPlays: h.listPlays,
}));

const { buildFriendsFeed } = await import('../src/read/friends.js');

const play = (did: string, rk: string) => ({
  uri: `at://${did}/at.rolld.play/${rk}`,
  cid: 'c',
  rkey: rk,
  value: {
    $type: 'at.rolld.play',
    game: { id: '1', name: 'G' },
    target: 'https://rolld.at/g/1',
    playedAt: `2026-01-1${rk}T00:00:00Z`,
    createdAt: '2026-01-01T00:00:00Z',
  },
});

describe('buildFriendsFeed — no per-follow profile probe (perf, D-25/D-26)', () => {
  beforeEach(() => {
    h.getFollows.mockResolvedValue({
      follows: [{ did: 'did:plc:friend' }, { did: 'did:plc:stranger' }],
    });
    h.resolveMiniDoc.mockImplementation(async (did: string) => ({
      did,
      handle: 'h',
      pds: 'https://pds',
      signingKey: 'z',
    }));
    // friend + own have plays; stranger is a non-participant (empty list, no profile).
    h.listPlays.mockImplementation(async (_c: unknown, did: string) => ({
      records: did === 'did:plc:friend' ? [play(did, '2')] : did === 'did:plc:me' ? [play(did, '1')] : [],
    }));
  });

  it('includes a followed account with plays (no profile fetch) and skips a non-participant', async () => {
    const feed = await buildFriendsFeed('did:plc:me', 'https://mypds');
    const authors = feed.map((f) => f.authorDid);
    expect(authors).toContain('did:plc:friend'); // fails on the old profile-gated code
    expect(authors).toContain('did:plc:me');
    expect(authors).not.toContain('did:plc:stranger');
    // One listPlays per follow + one for own plays = 3. No extra getRecord(profile) probe.
    expect(h.listPlays).toHaveBeenCalledTimes(3);
  });
});
