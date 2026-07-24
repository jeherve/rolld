/**
 * The render-path moderation filter (D-41/D-49). rolld can't delete records that live
 * on other people's PDSes, so a takedown means rolld stops *displaying* them: before
 * rendering foreign records the client names the DIDs/URIs it's about to show and the
 * Worker returns the blocked subset (`POST /api/moderation/check`). The blocklist
 * itself never reaches the browser. This is the logic worth testing hard — the fetch
 * boundary is mocked; the wiring into each view is DOM glue.
 *
 * The one non-obvious rule is fail-CLOSED: if the check can't be completed (Worker
 * down, bad reply) every named item is treated as blocked, because a takedown is
 * usually CSAM or abuse and must never be shown on a hiccup.
 */
import { describe, expect, it, vi } from 'vitest';
import { checkBlocked, dropBlocked, isHidden } from '../src/read/moderation.js';

/** A fetch stub that answers POST /api/moderation/check with the given blocked subset. */
const okFetch = (blocked: { dids?: string[]; uris?: string[] }) =>
  vi.fn(async () => new Response(JSON.stringify(blocked), { status: 200 }));

const boomFetch = () =>
  vi.fn(async () => {
    throw new Error('worker unreachable');
  });

describe('checkBlocked — the targeted blocklist query', () => {
  it('POSTs the named dids/uris and returns only the blocked subset', async () => {
    const fetchImpl = okFetch({ dids: ['did:plc:bad'], uris: [] });
    const set = await checkBlocked(
      { dids: ['did:plc:bad', 'did:plc:ok'], uris: ['at://did:plc:ok/at.rolld.play/1'] },
      { fetchImpl, baseUrl: 'https://api.test' },
    );
    const [url, init] = fetchImpl.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toBe('https://api.test/api/moderation/check');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({
      dids: ['did:plc:bad', 'did:plc:ok'],
      uris: ['at://did:plc:ok/at.rolld.play/1'],
    });
    expect([...set.dids]).toEqual(['did:plc:bad']);
    expect([...set.uris]).toEqual([]);
  });

  it('skips the network entirely when nothing is named', async () => {
    const fetchImpl = okFetch({});
    const set = await checkBlocked({ dids: [], uris: [] }, { fetchImpl });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(set.dids.size + set.uris.size).toBe(0);
  });

  it('fails CLOSED on a rejected fetch — every named item is treated as blocked', async () => {
    const set = await checkBlocked(
      { dids: ['did:plc:a'], uris: ['at://did:plc:a/at.rolld.play/1'] },
      { fetchImpl: boomFetch() },
    );
    expect(set.dids.has('did:plc:a')).toBe(true);
    expect(set.uris.has('at://did:plc:a/at.rolld.play/1')).toBe(true);
  });

  it('fails CLOSED on a non-200 response', async () => {
    const fetchImpl = vi.fn(async () => new Response('nope', { status: 500 }));
    const set = await checkBlocked({ dids: ['did:plc:a'] }, { fetchImpl });
    expect(set.dids.has('did:plc:a')).toBe(true);
  });
});

describe('dropBlocked — feed / list filtering', () => {
  const item = (did: string, rk: string) => ({
    authorDid: did,
    uri: `at://${did}/at.rolld.play/${rk}`,
  });
  const accessors = { did: (f: { authorDid: string }) => f.authorDid, uri: (f: { uri: string }) => f.uri };

  it('drops every record from a blocked DID (the takedown case)', async () => {
    const feed = [item('did:plc:bad', '1'), item('did:plc:ok', '2'), item('did:plc:bad', '3')];
    const visible = await dropBlocked(feed, accessors, {
      fetchImpl: okFetch({ dids: ['did:plc:bad'], uris: [] }),
    });
    expect(visible.map((f) => f.uri)).toEqual(['at://did:plc:ok/at.rolld.play/2']);
  });

  it('drops a single taken-down record by URI, keeping the rest', async () => {
    const feed = [item('did:plc:ok', '1'), item('did:plc:ok', '2')];
    const visible = await dropBlocked(feed, accessors, {
      fetchImpl: okFetch({ dids: [], uris: ['at://did:plc:ok/at.rolld.play/2'] }),
    });
    expect(visible.map((f) => f.uri)).toEqual(['at://did:plc:ok/at.rolld.play/1']);
  });

  it('fails CLOSED — a failed check hides the whole list rather than showing it', async () => {
    const feed = [item('did:plc:a', '1'), item('did:plc:b', '2')];
    const visible = await dropBlocked(feed, accessors, { fetchImpl: boomFetch() });
    expect(visible).toEqual([]);
  });

  it('is a no-op (no network) for an empty list', async () => {
    const fetchImpl = okFetch({});
    expect(await dropBlocked([], { did: () => '' }, { fetchImpl })).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('isHidden — single-subject gate (entry permalink / author page)', () => {
  const uri = 'at://did:plc:ok/at.rolld.play/xyz';

  it('reports a blocked record URI as hidden → the entry renders the not-available state', async () => {
    expect(await isHidden('did:plc:ok', uri, { fetchImpl: okFetch({ dids: [], uris: [uri] }) })).toBe(true);
  });

  it('reports a blocked author DID as hidden (whole profile/log taken down)', async () => {
    expect(
      await isHidden('did:plc:bad', undefined, { fetchImpl: okFetch({ dids: ['did:plc:bad'], uris: [] }) }),
    ).toBe(true);
  });

  it('shows an entry that is on neither list', async () => {
    expect(await isHidden('did:plc:ok', uri, { fetchImpl: okFetch({ dids: [], uris: [] }) })).toBe(false);
  });

  it('fails CLOSED — an unreachable check hides the entry', async () => {
    expect(await isHidden('did:plc:ok', uri, { fetchImpl: boomFetch() })).toBe(true);
  });
});
