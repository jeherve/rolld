import { describe, expect, it } from 'vitest';
import { linkifyBio } from '../src/ui/richText.js';

const render = (text: string): string => linkifyBio(text).toString();

describe('linkifyBio — facet detection (D-57)', () => {
  it('leaves plain text as escaped text with no links', () => {
    const out = render('just a board game nerd');
    expect(out).toBe('just a board game nerd');
    expect(out).not.toContain('<a');
  });

  it('linkifies an http(s) URL and strips the protocol for display', () => {
    const out = render('site: https://example.com/games');
    expect(out).toContain('href="https://example.com/games"');
    expect(out).toContain('target="_blank"');
    expect(out).toContain('>example.com/games</a>');
  });

  it('does not swallow trailing punctuation into a URL', () => {
    const out = render('see https://example.com.');
    expect(out).toContain('href="https://example.com"');
    // The trailing period stays outside the anchor.
    expect(out).toContain('</a>.');
  });

  it('links a @mention to the person’s rolld profile', () => {
    const out = render('made by @jeremy.herve.bzh');
    expect(out).toContain('href="/@jeremy.herve.bzh"');
    expect(out).toContain('data-link');
    expect(out).toContain('>@jeremy.herve.bzh</a>');
  });

  it('does not treat an email address as a mention', () => {
    const out = render('reach me at hi@example.com please');
    expect(out).not.toContain('data-link');
    expect(out).not.toContain('href="/@example.com"');
  });

  it('ignores a bare @word with no domain', () => {
    const out = render('cc @someone');
    expect(out).not.toContain('<a');
  });

  it('links a #hashtag to the Atmosphere tag feed', () => {
    const out = render('love #boardgames here');
    expect(out).toContain('/hashtag/boardgames');
    expect(out).toContain('>#boardgames</a>');
  });

  it('handles several facets in one bio', () => {
    const out = render('games with @alice.bsky.social — see https://catan.com #catan');
    expect(out).toContain('href="/@alice.bsky.social"');
    expect(out).toContain('href="https://catan.com"');
    expect(out).toContain('/hashtag/catan');
  });

  // Security: the whole point of routing through the html helper (D-19/D-20).
  it('escapes HTML in plain text so a bio can’t inject markup', () => {
    const out = render('<script>alert(1)</script>');
    expect(out).not.toContain('<script>');
    expect(out).toContain('&lt;script&gt;');
  });

  it('never emits a javascript: href (only http(s) is linked)', () => {
    const out = render('javascript:alert(1) is not a link');
    expect(out).not.toContain('href="javascript:');
    expect(out).not.toContain('<a');
  });

  it('preserves newlines as text (rendered via white-space: pre-wrap)', () => {
    expect(render('line one\nline two')).toBe('line one\nline two');
  });
});
