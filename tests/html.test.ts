import { describe, expect, it } from 'vitest';
import { html, raw, render } from '../src/ui/html.js';

describe('html tagged template', () => {
  it('escapes interpolated strings by default', () => {
    const evil = '<img src=x onerror=alert(1)>';
    expect(html`<p>${evil}</p>`.toString()).toBe(
      '<p>&lt;img src=x onerror=alert(1)&gt;</p>',
    );
  });

  it('escapes the dangerous five characters', () => {
    expect(html`${`< > & " '`}`.toString()).toBe('&lt; &gt; &amp; &quot; &#39;');
  });

  it('renders numbers and leaves static markup untouched', () => {
    expect(html`<span class="n">${42}</span>`.toString()).toBe('<span class="n">42</span>');
  });

  it('treats null, undefined and false as empty', () => {
    expect(html`a${null}b${undefined}c${false}d`.toString()).toBe('abcd');
  });

  it('does not re-escape nested html results', () => {
    const inner = html`<b>${'<x>'}</b>`;
    expect(html`<p>${inner}</p>`.toString()).toBe('<p><b>&lt;x&gt;</b></p>');
  });

  it('joins arrays, escaping each item per its type', () => {
    const items = ['a&b', html`<li>${'<c>'}</li>`];
    expect(html`<ul>${items}</ul>`.toString()).toBe('<ul>a&amp;b<li>&lt;c&gt;</li></ul>');
  });

  it('raw() inserts pre-sanitized markup without escaping', () => {
    const sanitized = raw('<em>trusted</em>');
    expect(html`<p>${sanitized}</p>`.toString()).toBe('<p><em>trusted</em></p>');
  });
});

describe('render', () => {
  it('replaces a container’s contents with the rendered markup', () => {
    const root = document.createElement('div');
    render(root, html`<span>${'<hi>'}</span>`);
    expect(root.innerHTML).toBe('<span>&lt;hi&gt;</span>');
    expect(root.querySelector('span')?.textContent).toBe('<hi>');
  });

  it('escaping defeats an injected script', () => {
    const root = document.createElement('div');
    render(root, html`<div>${'<script>alert(1)</script>'}</div>`);
    expect(root.querySelector('script')).toBeNull();
  });
});
