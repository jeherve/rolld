import { describe, expect, it } from 'vitest';
import type { RolldAgent } from '../src/atproto/client.js';
import {
  buildImagesEmbed,
  buildLinkFacets,
  createCompanionPost,
  defaultShareText,
} from '../src/share/bsky.js';
import type { ImageEmbed } from '../src/records/types.js';

describe('defaultShareText (D-16)', () => {
  it('drafts a play share', () => {
    expect(
      defaultShareText({ verb: 'Played', gameName: 'Gloomhaven', url: 'https://rolld.at/@me/play/3k' }),
    ).toBe('Played Gloomhaven — https://rolld.at/@me/play/3k');
  });

  it('includes the grade for a rating', () => {
    expect(
      defaultShareText({ verb: 'Rated', gameName: 'Catan', rating: 8, url: 'https://rolld.at/@me/rating/13' }),
    ).toBe('Rated Catan 8/10 — https://rolld.at/@me/rating/13');
  });
});

describe('buildLinkFacets (UTF-8 byte offsets)', () => {
  it('points the facet at the URL using byte positions', () => {
    const url = 'https://rolld.at/x';
    const text = `Played Catan — ${url}`;
    const [facet] = buildLinkFacets(text, url);
    expect(facet!.index.byteStart).toBe(Buffer.byteLength('Played Catan — '));
    expect(facet!.index.byteEnd).toBe(facet!.index.byteStart + url.length);
    expect(facet!.features[0]!.uri).toBe(url);
  });

  it('accounts for multibyte characters before the URL', () => {
    const url = 'https://rolld.at/x';
    const text = `🎲 ${url}`; // the die emoji is 4 bytes, 2 UTF-16 units
    const [facet] = buildLinkFacets(text, url);
    expect(facet!.index.byteStart).toBe(Buffer.byteLength('🎲 '));
  });

  it('returns [] when the URL is absent', () => {
    expect(buildLinkFacets('no link here', 'https://x')).toEqual([]);
  });
});

describe('buildImagesEmbed (D-33 — reuse blob refs)', () => {
  const img = (alt: string): ImageEmbed => ({
    image: { $type: 'blob', ref: { $link: 'cid' }, mimeType: 'image/jpeg', size: 1 },
    alt,
    aspectRatio: { width: 4, height: 3 },
  });

  it('maps play images to an app.bsky.embed.images, capping at 4', () => {
    const embed = buildImagesEmbed([img('a'), img('b'), img('c'), img('d'), img('e')])!;
    expect(embed.$type).toBe('app.bsky.embed.images');
    expect(embed.images).toHaveLength(4);
    expect(embed.images[0]).toEqual({
      image: { $type: 'blob', ref: { $link: 'cid' }, mimeType: 'image/jpeg', size: 1 },
      alt: 'a',
      aspectRatio: { width: 4, height: 3 },
    });
  });

  it('returns undefined for no images', () => {
    expect(buildImagesEmbed([])).toBeUndefined();
  });
});

describe('createCompanionPost', () => {
  it('creates an app.bsky.feed.post with link facets and returns the strongRef', async () => {
    const created: unknown[] = [];
    const agent = {
      async createRecord(collection: string, record: unknown) {
        created.push([collection, record]);
        return { uri: 'at://did/app.bsky.feed.post/3p', cid: 'cidp' };
      },
    } as unknown as RolldAgent;

    const ref = await createCompanionPost(agent, {
      text: 'Played Catan — https://rolld.at/@me/play/3k',
      now: () => '2026-06-30T00:00:00.000Z',
    });
    expect(ref).toEqual({ uri: 'at://did/app.bsky.feed.post/3p', cid: 'cidp' });
    const [collection, record] = created[0] as [string, Record<string, unknown>];
    expect(collection).toBe('app.bsky.feed.post');
    expect(record.facets).toBeDefined();
    expect(record.createdAt).toBe('2026-06-30T00:00:00.000Z');
  });
});
