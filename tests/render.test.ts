import { describe, expect, it } from 'vitest';
import { playPhotos } from '../src/ui/render.js';
import type { ImageEmbed } from '../src/records/types.js';

const embed = (cid: string, alt = 'a board'): ImageEmbed => ({
  image: { $type: 'blob', ref: { $link: cid }, mimeType: 'image/jpeg', size: 1000 },
  alt,
});

describe('playPhotos — defended against malformed embeds', () => {
  it('renders a usable photo through the Worker blob proxy', () => {
    const out = playPhotos([embed('bafyabc')], 'did:plc:me')!.toString();
    expect(out).toContain('/api/blob/did%3Aplc%3Ame/bafyabc');
    expect(out).toContain('class="photo"');
  });

  it('returns null when there are no images', () => {
    expect(playPhotos(undefined, 'did:plc:me')).toBeNull();
    expect(playPhotos([], 'did:plc:me')).toBeNull();
  });

  // Regression: image embeds come from other users' PDSes with no runtime check.
  // An embed missing its blob ref used to throw on `img.image.ref.$link`.
  it('drops an embed missing its blob ref instead of throwing', () => {
    const bad = { alt: 'x' } as unknown as ImageEmbed; // no `image`
    expect(() => playPhotos([bad], 'did:plc:me')).not.toThrow();
    const mixed = playPhotos([bad, embed('bafyok')], 'did:plc:me')!.toString();
    expect(mixed).toContain('bafyok');
    expect(mixed.match(/class="photo"/g)).toHaveLength(1); // only the good one
  });

  it('returns null when every embed is malformed', () => {
    const bad = { image: {} } as unknown as ImageEmbed;
    expect(playPhotos([bad], 'did:plc:me')).toBeNull();
  });

  it('escapes alt text (no attribute breakout)', () => {
    const out = playPhotos([embed('bafy', '" onload="alert(1)')], 'did:plc:me')!.toString();
    expect(out).not.toContain('onload="alert(1)"');
    expect(out).toContain('&quot;');
  });

  it('big layout adds the entry-size class', () => {
    expect(playPhotos([embed('bafy')], 'did:plc:me', true)!.toString()).toContain('class="photos big"');
  });

  it('caps at four photos', () => {
    const six = Array.from({ length: 6 }, (_v, i) => embed(`cid${i}`));
    const out = playPhotos(six, 'did:plc:me')!.toString();
    expect(out.match(/class="photo"/g)).toHaveLength(4);
  });
});
