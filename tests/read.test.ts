import { describe, expect, it, vi } from 'vitest';
import {
  buildQueryUrl,
  gameDistinctPlayers,
  gamePlays,
  gameTotalPlays,
  linkingRecordUri,
  playCountByDids,
} from '../src/read/constellation.js';
import { mergeFeed, prependLive, type FeedItem } from '../src/read/feed.js';
import { renderMarkdown } from '../src/read/markdown-render.js';
import { gameTargetUrl } from '../src/links.js';
import type { PlayRecord } from '../src/records/types.js';

const TARGET = gameTargetUrl('174430');

describe('Constellation query building', () => {
  it('encodes target + collection + the .target path', () => {
    const url = buildQueryUrl('https://c', '/links/count', {
      target: TARGET,
      collection: 'at.rolld.play',
    });
    expect(url).toContain('target=https%3A%2F%2Frolld.at%2Fg%2F174430');
    expect(url).toContain('collection=at.rolld.play');
    expect(url).toContain('path=.target');
  });

  it('appends repeatable did= for the my/friends filters', () => {
    const url = buildQueryUrl('https://c', '/links/count', {
      target: TARGET,
      collection: 'at.rolld.play',
      dids: ['did:plc:a', 'did:plc:b'],
    });
    expect(url).toContain('&did=did%3Aplc%3Aa');
    expect(url).toContain('&did=did%3Aplc%3Ab');
  });

  it('reconstructs an at-uri from a linking record', () => {
    expect(linkingRecordUri({ did: 'did:plc:a', collection: 'at.rolld.play', rkey: '3k' })).toBe(
      'at://did:plc:a/at.rolld.play/3k',
    );
  });
});

describe('Constellation reads (mocked at the fetch boundary)', () => {
  const json = (body: unknown): Response => new Response(JSON.stringify(body), { status: 200 });

  it('gameTotalPlays returns the count', async () => {
    const fetchImpl = vi.fn(async () => json({ total: 159 }));
    expect(await gameTotalPlays(TARGET, { fetchImpl })).toBe(159);
  });

  it('playCountByDids scopes by did', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => json({ total: 3 }));
    const n = await playCountByDids(TARGET, ['did:plc:me'], { fetchImpl });
    expect(n).toBe(3);
    expect(String(fetchImpl.mock.calls[0]![0])).toContain('did=did%3Aplc%3Ame');
  });

  it('gameDistinctPlayers hits the distinct-dids endpoint', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => json({ total: 42 }));
    expect(await gameDistinctPlayers(TARGET, { fetchImpl })).toBe(42);
    expect(String(fetchImpl.mock.calls[0]![0])).toContain('/links/count/distinct-dids');
  });

  it('gamePlays returns records + cursor', async () => {
    const fetchImpl = vi.fn(async () =>
      json({
        total: 2,
        linking_records: [{ did: 'did:plc:a', collection: 'at.rolld.play', rkey: '1' }],
        cursor: 'abc',
      }),
    );
    const page = await gamePlays(TARGET, {}, { fetchImpl });
    expect(page.total).toBe(2);
    expect(page.records).toHaveLength(1);
    expect(page.cursor).toBe('abc');
  });
});

/* ---- feed merge/sort ---- */

const play = (id: string, playedAt: string, createdAt = playedAt): PlayRecord => ({
  $type: 'at.rolld.play',
  game: { id, name: `g${id}` },
  target: gameTargetUrl(id),
  playedAt,
  createdAt,
});
const item = (did: string, rkey: string, p: PlayRecord, isOwn = false): FeedItem => ({
  uri: `at://${did}/at.rolld.play/${rkey}`,
  authorDid: did,
  rkey,
  play: p,
  isOwn,
});

describe('mergeFeed (D-26/D-27)', () => {
  it('merges own + follows plays, newest playedAt first', () => {
    const own = [item('did:me', 'a', play('1', '2026-06-30T10:00:00Z'), true)];
    const follows = [
      item('did:f1', 'b', play('2', '2026-06-29T10:00:00Z')),
      item('did:f2', 'c', play('3', '2026-06-30T12:00:00Z')),
    ];
    const merged = mergeFeed([own, follows]);
    expect(merged.map((m) => m.rkey)).toEqual(['c', 'a', 'b']);
  });

  it('de-dupes by uri and keeps the own marker', () => {
    const p = play('1', '2026-06-30T10:00:00Z');
    const merged = mergeFeed([
      [item('did:me', 'a', p, false)],
      [item('did:me', 'a', p, true)],
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.isOwn).toBe(true);
  });

  it('prependLive ignores a duplicate', () => {
    const p = play('1', '2026-06-30T10:00:00Z');
    const feed = [item('did:me', 'a', p)];
    expect(prependLive(feed, item('did:me', 'a', p))).toHaveLength(1);
    expect(prependLive(feed, item('did:f', 'z', play('9', '2026-07-01T00:00:00Z')))).toHaveLength(2);
  });
});

/* ---- the security-critical sanitizer (D-20) ---- */

describe('renderMarkdown — sanitization (D-20)', () => {
  it('escapes raw HTML tags into inert text (no passthrough)', () => {
    const html = renderMarkdown('hello <script>alert(1)</script> world');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('neutralizes an img onerror injection', () => {
    const html = renderMarkdown('<img src=x onerror=alert(1)>');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });

  it('drops a javascript: link to plain text but keeps the label', () => {
    const html = renderMarkdown('[click me](javascript:alert(1))');
    expect(html).not.toContain('javascript:');
    expect(html).toContain('click me');
    expect(html).not.toContain('<a ');
  });

  it('drops a data: URI link', () => {
    const html = renderMarkdown('[x](data:text/html,<script>alert(1)</script>)');
    expect(html).not.toContain('<a ');
  });

  it('renders a safe http link with noopener/nofollow', () => {
    const html = renderMarkdown('see [rolld](https://rolld.at/about)');
    expect(html).toContain('<a href="https://rolld.at/about"');
    expect(html).toContain('rel="noopener noreferrer nofollow"');
  });

  it('renders bold, italic, inline code and a heading', () => {
    expect(renderMarkdown('# Title')).toBe('<h1>Title</h1>');
    expect(renderMarkdown('a **b** c')).toContain('<strong>b</strong>');
    expect(renderMarkdown('a _b_ c')).toContain('<em>b</em>');
    expect(renderMarkdown('use `npm test`')).toContain('<code>npm test</code>');
  });

  it('does not format inside inline code (and keeps it escaped)', () => {
    const html = renderMarkdown('`a *b* <c>`');
    expect(html).toContain('<code>a *b* &lt;c&gt;</code>');
    expect(html).not.toContain('<em>');
  });

  it('renders lists and blockquotes', () => {
    expect(renderMarkdown('- one\n- two')).toBe('<ul><li>one</li><li>two</li></ul>');
    expect(renderMarkdown('1. a\n2. b')).toBe('<ol><li>a</li><li>b</li></ol>');
    expect(renderMarkdown('> quoted')).toBe('<blockquote><p>quoted</p></blockquote>');
  });

  it('keeps user line breaks within a paragraph', () => {
    expect(renderMarkdown('line one\nline two')).toBe('<p>line one<br>line two</p>');
  });
});
