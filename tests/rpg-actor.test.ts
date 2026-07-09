import { describe, expect, it, vi } from 'vitest';

// Mock the repo read boundary; the logic under test (rpgActor.js) stays real.
const h = vi.hoisted(() => ({
  getRecordValue: vi.fn(),
  listRecords: vi.fn(),
}));

vi.mock('../src/read/repo.js', () => ({
  getRecordValue: h.getRecordValue,
  listRecords: h.listRecords,
}));

const { summarizeSystems, spriteFrame, fetchRpgActorPresence } = await import(
  '../src/read/rpgActor.js'
);

/** A minimal `actor.rpg.stats` RepoRecord for the summarizer. */
const stat = (rkey: string, value: Record<string, unknown>) => ({
  uri: `at://did/actor.rpg.stats/${rkey}`,
  cid: 'c',
  rkey,
  value,
});

describe('summarizeSystems', () => {
  it('drops the deprecated `self` aggregate record', () => {
    const out = summarizeSystems([stat('self', {}), stat('dnd', { system: 'dnd' })]);
    expect(out.map((s) => s.system)).toEqual(['dnd']);
  });

  it('falls back to the rkey when a record omits its `system` field', () => {
    const out = summarizeSystems([stat('chaossoccer', {})]);
    expect(out).toEqual([{ system: 'chaossoccer', name: 'chaossoccer' }]);
  });

  it('dedupes by system, first occurrence winning', () => {
    const out = summarizeSystems([
      stat('a', { system: 'dnd', data: { _meta: { name: 'First' } } }),
      stat('b', { system: 'dnd', data: { _meta: { name: 'Second' } } }),
    ]);
    expect(out).toEqual([{ system: 'dnd', name: 'First' }]);
  });

  it('prefers _meta.name, then a known label, then the raw key', () => {
    const out = summarizeSystems([
      stat('spotem', { system: 'spotem', data: { _meta: { name: "Spot 'Em!" } } }),
      stat('dnd', { system: 'dnd' }),
      stat('mystery', { system: 'mystery' }),
    ]);
    expect(out).toEqual([
      { system: 'spotem', name: "Spot 'Em!" },
      { system: 'dnd', name: 'D&D' },
      { system: 'mystery', name: 'mystery' },
    ]);
  });

  it('ignores a malformed _meta and preserves input order', () => {
    const out = summarizeSystems([
      stat('reverie', { system: 'reverie', data: 'not-an-object' }),
      stat('dcc', { system: 'dcc', data: { _meta: { name: '   ' } } }),
    ]);
    expect(out).toEqual([
      { system: 'reverie', name: 'Reverie' },
      { system: 'dcc', name: 'DCC' },
    ]);
  });
});

describe('spriteFrame', () => {
  it('crops to the front-idle frame of a standard 3×4 / 48px sheet', () => {
    expect(spriteFrame({ columns: 3, rows: 4, frameWidth: 48, frameHeight: 48 })).toEqual({
      frameW: 48,
      frameH: 48,
      sheetW: 144,
      sheetH: 192,
      offsetX: -48,
      offsetY: 0,
    });
  });

  it('derives the frame size from the sheet dimensions when frame fields are absent', () => {
    const f = spriteFrame({ columns: 3, rows: 4, width: 144, height: 192 });
    expect(f.frameW).toBe(48);
    expect(f.frameH).toBe(48);
    expect(f.offsetX).toBe(-48);
  });

  it('falls back to a 3×4 / 48px grid when everything is missing or garbage', () => {
    const f = spriteFrame({ columns: 0, rows: -1, frameWidth: NaN as unknown as number });
    expect(f).toEqual({
      frameW: 48,
      frameH: 48,
      sheetW: 144,
      sheetH: 192,
      offsetX: -48,
      offsetY: 0,
    });
  });

  it('keeps integer frame sizes for a sheet that does not divide evenly', () => {
    const f = spriteFrame({ columns: 3, width: 100 });
    expect(Number.isInteger(f.frameW)).toBe(true);
    expect(f.frameW).toBe(33);
  });

  it('handles a single-column sheet (middle column is column 0, no x offset)', () => {
    const f = spriteFrame({ columns: 1, rows: 4, frameWidth: 48, frameHeight: 48 });
    expect(f.offsetX).toBe(0);
  });
});

describe('fetchRpgActorPresence', () => {
  const client = {} as never;
  const sprite = {
    spriteSheet: { ref: { $link: 'bafsprite' } },
    columns: 3,
    rows: 4,
    frameWidth: 48,
    frameHeight: 48,
  };

  it('returns sprite + systems when the repo has both', async () => {
    h.getRecordValue.mockResolvedValueOnce(sprite);
    h.listRecords.mockResolvedValueOnce({ records: [stat('dnd', { system: 'dnd' })] });
    const p = await fetchRpgActorPresence(client, 'did:plc:x');
    expect(p?.sprite?.cid).toBe('bafsprite');
    expect(p?.sprite?.frame.offsetX).toBe(-48);
    expect(p?.systems).toEqual([{ system: 'dnd', name: 'D&D' }]);
  });

  it('returns a sprite-only presence (no systems)', async () => {
    h.getRecordValue.mockResolvedValueOnce(sprite);
    h.listRecords.mockResolvedValueOnce({ records: [] });
    const p = await fetchRpgActorPresence(client, 'did:plc:x');
    expect(p?.sprite?.cid).toBe('bafsprite');
    expect(p?.systems).toEqual([]);
  });

  it('returns a systems-only presence (no sprite)', async () => {
    h.getRecordValue.mockResolvedValueOnce(null);
    h.listRecords.mockResolvedValueOnce({ records: [stat('reverie', { system: 'reverie' })] });
    const p = await fetchRpgActorPresence(client, 'did:plc:x');
    expect(p?.sprite).toBeNull();
    expect(p?.systems).toEqual([{ system: 'reverie', name: 'Reverie' }]);
  });

  it('is dormant (null) when the repo has neither', async () => {
    h.getRecordValue.mockResolvedValueOnce(null);
    h.listRecords.mockResolvedValueOnce({ records: [] });
    expect(await fetchRpgActorPresence(client, 'did:plc:x')).toBeNull();
  });

  it('ignores a sprite record with no usable blob ref', async () => {
    h.getRecordValue.mockResolvedValueOnce({ columns: 3 });
    h.listRecords.mockResolvedValueOnce({ records: [] });
    expect(await fetchRpgActorPresence(client, 'did:plc:x')).toBeNull();
  });

  it('degrades to sprite-only when the stats list read fails', async () => {
    h.getRecordValue.mockResolvedValueOnce(sprite);
    h.listRecords.mockRejectedValueOnce(new Error('PDS down'));
    const p = await fetchRpgActorPresence(client, 'did:plc:x');
    expect(p?.sprite?.cid).toBe('bafsprite');
    expect(p?.systems).toEqual([]);
  });
});
