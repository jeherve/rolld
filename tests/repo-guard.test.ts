import type { Client } from '@atcute/client';
import { describe, expect, it, vi } from 'vitest';
import { COLLECTION } from '../src/config.js';
import { getRecordValue, listAllPlays, listPlays } from '../src/read/repo.js';

/**
 * Foreign play/rating records are read via `listRecords`/`getRecord` and cast `as T`
 * with no lexicon re-validation, so a malicious or broken writer can omit the
 * lexicon-required `game` object. Before the guard, the missing `game` crashed every
 * render path that dereferenced `play.game.id`/`play.game.name` (the dashboard feed,
 * feedCard, playLog, entry permalink) — one bad record took down a whole region
 * (CWE-476). These assert such records are dropped/skipped at the read boundary.
 */

/** Minimal atcute Client stub: serves listRecords pages in order, `ok()`-shaped. */
function pagedClient(pages: { records: unknown[]; cursor?: string }[]): Client {
  let call = 0;
  const get = vi.fn(async () => ({ ok: true, data: pages[call++] ?? { records: [] } }));
  return { get } as unknown as Client;
}

/** A well-formed play record. */
const good = (i: number) => ({
  uri: `at://did:plc:me/at.rolld.play/g${i}`,
  cid: `cid${i}`,
  value: { $type: 'at.rolld.play', game: { id: `${i}`, name: `Game ${i}` } },
});

/** A malformed play record: the lexicon-required `game` object is omitted. */
const gameless = (i: number) => ({
  uri: `at://did:plc:me/at.rolld.play/x${i}`,
  cid: `xid${i}`,
  value: { $type: 'at.rolld.play', target: 'https://rolld.at/g/1', playedAt: '2026-01-01T00:00:00Z' },
});

describe('repo read guard — drops foreign records missing a valid `game` (CWE-476)', () => {
  it('listPlays keeps well-formed records and drops the gameless one', async () => {
    const client = pagedClient([{ records: [good(1), gameless(2), good(3)] }]);
    const page = await listPlays(client, 'did:plc:me');
    expect(page.records.map((r) => r.rkey)).toEqual(['g1', 'g3']);
    // The dashboard sink used to throw here on the gameless record.
    expect(() => page.records.map((r) => r.value.game.id)).not.toThrow();
  });

  it('listAllPlays drops gameless records across pages', async () => {
    const client = pagedClient([
      { records: [good(1), gameless(2)], cursor: 'c1' },
      { records: [gameless(3), good(4)] },
    ]);
    const all = await listAllPlays(client, 'did:plc:me');
    expect(all.map((r) => r.rkey)).toEqual(['g1', 'g4']);
  });

  it('getRecordValue returns null for a play whose `game` is missing', async () => {
    const client = { get: vi.fn(async () => ({ ok: true, data: { value: gameless(1).value } })) } as unknown as Client;
    expect(await getRecordValue(client, 'did:plc:me', COLLECTION.play, 'x1')).toBeNull();
  });

  it('getRecordValue leaves a non-game collection (profile) untouched', async () => {
    const profile = { $type: 'at.rolld.profile', createdAt: '2026-01-01T00:00:00Z' };
    const client = { get: vi.fn(async () => ({ ok: true, data: { value: profile } })) } as unknown as Client;
    expect(await getRecordValue(client, 'did:plc:me', COLLECTION.profile, 'self')).toEqual(profile);
  });
});
