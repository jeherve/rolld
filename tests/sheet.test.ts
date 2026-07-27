/**
 * The bottom sheet's shell (D-35). The regression these guard is a mobile one: the
 * whole sheet used to be one scroller, so on a phone a long "Log a play" form
 * scrolled its own title, its ✕ and its submit button off the screen, and the
 * sticky CTA had form fields sliding through the gap around it. The fix splits the
 * sheet into a fixed head, a scrolling body and a fixed foot — so the tests assert
 * the three bands exist and that the CTA really does live outside the form.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { openSheet } from '../src/ui/flows.js';
import { html } from '../src/ui/html.js';

beforeEach(() => {
  document.body.innerHTML = '';
  document.body.style.overflow = '';
});

describe('openSheet', () => {
  it('splits the sheet into head, body and foot', () => {
    const sheet = openSheet('Log a play', html`<p>form</p>`);
    const el = document.querySelector('.sheet')!;
    expect([...el.children].map((c) => c.className)).toEqual([
      'sheet-head',
      'sheet-body',
      'sheet-foot',
    ]);
    sheet.close();
  });

  it('keeps the title and the ✕ out of the scrolling body', () => {
    const sheet = openSheet('Log a play', html`<p>form</p>`);
    const head = document.querySelector('.sheet-head')!;
    expect(head.querySelector('h2')?.textContent).toBe('Log a play');
    expect(head.querySelector('[data-close]')).not.toBeNull();
    expect(sheet.body.querySelector('[data-close]')).toBeNull();
    sheet.close();
  });

  it('hides the foot until there are actions to pin there', () => {
    const bare = openSheet('Share', html`<p>text</p>`);
    expect(bare.foot.hidden).toBe(true);
    bare.close();

    const withCta = openSheet('Share', html`<p>text</p>`, html`<button>Post</button>`);
    expect(withCta.foot.hidden).toBe(false);
    expect(withCta.foot.querySelector('button')?.textContent).toBe('Post');
    withCta.close();
  });

  it('restores page scrolling when it closes', () => {
    const sheet = openSheet('Log a play', html`<p>form</p>`);
    expect(document.body.style.overflow).toBe('hidden');
    sheet.close();
    expect(document.body.style.overflow).toBe('');
    expect(document.querySelector('.sheet-overlay')).toBeNull();
  });
});

describe('the pinned submit button', () => {
  it('drives the form from outside it, via the form attribute', () => {
    const sheet = openSheet(
      'Log a play',
      html`<form id="log-form"><input name="a" /></form>`,
      html`<button type="submit" form="log-form" class="submit-cta">Log play</button>`,
    );
    const form = sheet.body.querySelector<HTMLFormElement>('#log-form')!;
    const button = sheet.foot.querySelector<HTMLButtonElement>('.submit-cta')!;

    // Outside the form in the DOM, but still owned by it — that's what makes a
    // fixed foot possible without breaking submit.
    expect(form.contains(button)).toBe(false);
    expect(button.getAttribute('form')).toBe('log-form');

    let submitted = false;
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      submitted = true;
    });
    button.click();
    expect(submitted).toBe(true);
    sheet.close();
  });
});
