import type { Client } from '@atcute/client';
import { describe, expect, it, vi } from 'vitest';
import { listAllPlays } from '../src/read/repo.js';

/** Minimal atcute Client stub: serves listRecords pages in order, `ok()`-shaped. */
function pagedClient(pages: { records: unknown[]; cursor?: string }[]): Client {
  let call = 0;
  const get = vi.fn(async () => ({ ok: true, data: pages[call++] ?? { records: [] } }));
  return { get } as unknown as Client;
}

const rec = (i: number) => ({
  uri: `at://did:plc:me/at.rolld.play/r${i}`,
  cid: `cid${i}`,
  value: { $type: 'at.rolld.play', game: { id: '1', name: 'g' } },
});

describe('listAllPlays — cursor pagination (regression: reads were capped at one page)', () => {
  it('follows the cursor across pages and returns every record', async () => {
    const client = pagedClient([
      { records: Array.from({ length: 100 }, (_, i) => rec(i)), cursor: 'c1' },
      { records: Array.from({ length: 100 }, (_, i) => rec(100 + i)), cursor: 'c2' },
      { records: Array.from({ length: 76 }, (_, i) => rec(200 + i)) }, // no cursor → last page
    ]);
    const all = await listAllPlays(client, 'did:plc:me');
    expect(all).toHaveLength(276);
    expect(all[0]!.rkey).toBe('r0');
    expect(all[275]!.rkey).toBe('r275');
  });

  it('stops on a single page with no cursor', async () => {
    const client = pagedClient([{ records: [rec(0), rec(1)] }]);
    expect(await listAllPlays(client, 'did:plc:me')).toHaveLength(2);
  });

  it('bounds a PDS that never stops handing back a cursor (max cap)', async () => {
    const get = vi.fn(async () => ({
      ok: true,
      data: { records: Array.from({ length: 50 }, (_, i) => rec(i)), cursor: 'always' },
    }));
    const client = { get } as unknown as Client;
    const all = await listAllPlays(client, 'did:plc:me', { max: 250, pageLimit: 50 });
    expect(all).toHaveLength(250);
  });
});
