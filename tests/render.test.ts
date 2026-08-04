import { describe, expect, it } from 'vitest';
import { gameCover, playPhotos } from '../src/ui/render.js';
import type { GameMetadata } from '../src/bgg/types.js';
import type { ImageEmbed } from '../src/records/types.js';

const meta = (extra: Partial<GameMetadata> = {}): GameMetadata =>
  ({ id: '1', name: 'Wingspan', thumbnail: 'https://bgg/thumb.jpg', image: 'https://bgg/full.jpg', ...extra }) as GameMetadata;

describe('gameCover — source selection', () => {
  it('uses the light thumbnail for the small inline cover', () => {
    const out = gameCover('Wingspan', meta(), 56).toString();
    expect(out).toContain('src="https://bgg/thumb.jpg"');
    expect(out).not.toContain('class="cover fill"');
  });

  it('uses the full-res image for a large fill tile', () => {
    const out = gameCover('Wingspan', meta(), 72, { fill: true }).toString();
    expect(out).toContain('src="https://bgg/full.jpg"');
    expect(out).toContain('class="cover fill"');
  });

  it('falls back to the thumbnail in fill mode when no full image exists', () => {
    const out = gameCover('Wingspan', meta({ image: undefined }), 72, { fill: true }).toString();
    expect(out).toContain('src="https://bgg/thumb.jpg"');
  });

  it('shows the name-snapshot placeholder until metadata arrives (CC-5)', () => {
    const out = gameCover('Wingspan', null, 72, { fill: true }).toString();
    expect(out).toContain('cover fill ph');
    expect(out).toContain('Wi');
  });
});

// The search rows put the cover right next to the same name as visible text, so an
// `alt` there makes a screen reader say "Trio Trio 2021" on every one of eight rows.
describe('gameCover — decorative covers', () => {
  it('drops the alt and hides the image when the name is already beside it', () => {
    const out = gameCover('Wingspan', meta(), 28, { decorative: true }).toString();
    expect(out).toContain('alt=""');
    expect(out).toContain('aria-hidden="true"');
    expect(out).not.toContain('alt="Wingspan"');
  });

  // Pin the default: most call sites are a cover with no name beside it, and they'd
  // lose their only accessible name if `decorative` ever became the default.
  it('keeps the real alt when it is not decorative', () => {
    const out = gameCover('Wingspan', meta(), 56).toString();
    expect(out).toContain('alt="Wingspan"');
    expect(out).not.toContain('aria-hidden');
  });

  it('still escapes the alt of a name that could break out of the attribute', () => {
    const out = gameCover('" onerror="alert(1)', meta(), 56).toString();
    expect(out).not.toContain('onerror="alert(1)"');
    expect(out).toContain('&quot;');
  });

  // `decorative` must not be spelled as an empty `name` — that empties the initials.
  it('keeps the placeholder initials when decorative and the art is missing', () => {
    const out = gameCover('Wingspan', null, 28, { decorative: true }).toString();
    expect(out).toContain('cover ph');
    expect(out).toContain('Wi');
    expect(out).toContain('aria-hidden="true"');
  });
});

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
