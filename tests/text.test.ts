import { describe, expect, it } from 'vitest';
import {
  BSKY_POST_LIMIT,
  countGraphemes,
  graphemesRemaining,
  truncateGraphemes,
} from '../src/text/graphemes.js';
import { markdownToPlain } from '../src/text/markdown.js';

describe('countGraphemes', () => {
  it('counts ASCII as one each', () => {
    expect(countGraphemes('hello')).toBe(5);
  });

  it('counts an emoji ZWJ sequence as a single grapheme (Bluesky semantics)', () => {
    // Family emoji: multiple code points, one user-perceived character.
    expect(countGraphemes('👨‍👩‍👧‍👦')).toBe(1);
    // Flag = one grapheme; combining accent stays with its base letter.
    expect(countGraphemes('🇫🇷')).toBe(1);
    expect(countGraphemes('é')).toBe(1); // e + combining acute
  });

  it('the limit is 300', () => {
    expect(BSKY_POST_LIMIT).toBe(300);
    expect(graphemesRemaining('x'.repeat(290))).toBe(10);
    expect(graphemesRemaining('x'.repeat(310))).toBe(-10);
  });
});

describe('truncateGraphemes', () => {
  it('truncates without splitting a grapheme cluster', () => {
    const s = 'ab👨‍👩‍👧‍👦cd';
    expect(countGraphemes(s)).toBe(5);
    const t = truncateGraphemes(s, 3);
    expect(countGraphemes(t)).toBe(3);
    expect(t).toBe('ab👨‍👩‍👧‍👦'); // kept the whole family emoji, not a fragment
  });

  it('returns the whole string when under the limit', () => {
    expect(truncateGraphemes('short', 100)).toBe('short');
  });
});

describe('markdownToPlain', () => {
  it('strips emphasis, links, images, and inline code', () => {
    const md = 'A **bold** and _italic_ note with a [link](https://x.com) and `code`.';
    expect(markdownToPlain(md)).toBe('A bold and italic note with a link and code.');
  });

  it('keeps image alt text and drops the url', () => {
    expect(markdownToPlain('![the board](https://x/img.jpg)')).toBe('the board');
  });

  it('strips headings, blockquotes, and list markers', () => {
    const md = '# Title\n\n> quoted\n\n- one\n- two\n\n1. first';
    expect(markdownToPlain(md)).toBe('Title\n\nquoted\n\none\ntwo\n\nfirst');
  });

  it('unwraps fenced code blocks to their contents', () => {
    expect(markdownToPlain('```js\nconst x = 1;\n```')).toBe('const x = 1;');
  });

  it('collapses excess blank lines and trims', () => {
    expect(markdownToPlain('a\n\n\n\nb\n\n')).toBe('a\n\nb');
  });
});
