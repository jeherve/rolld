import { describe, expect, it } from 'vitest';
import { render } from '../src/ui/html.js';
import { renderHeader } from '../src/ui/header.js';
import { renderFooter } from '../src/ui/footer.js';
import { diceLoader, emptyState, errorState } from '../src/ui/states.js';
import { REPO_URL, AUTHOR_PROFILE_URL } from '../src/config.js';

function mount(part: ReturnType<typeof renderHeader>): HTMLElement {
  const root = document.createElement('div');
  render(root, part);
  return root;
}

describe('renderHeader', () => {
  it('links the lowercase wordmark home', () => {
    const a = mount(renderHeader({ session: null })).querySelector('.wordmark a');
    expect(a?.getAttribute('href')).toBe('/');
    expect(a?.textContent).toBe('rolld');
  });

  it('carries the two-colour double-l', () => {
    const root = mount(renderHeader({ session: null }));
    expect(root.querySelector('.wordmark .l1')).not.toBeNull();
    expect(root.querySelector('.wordmark .l2')).not.toBeNull();
  });
});

describe('renderFooter', () => {
  it('links to the author profile and the repo on Tangled', () => {
    const root = mount(renderFooter());
    const hrefs = [...root.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(hrefs).toContain(AUTHOR_PROFILE_URL);
    expect(hrefs).toContain(REPO_URL);
  });

  it('keeps the About link', () => {
    expect(mount(renderFooter()).querySelector('a[href="/about"]')).not.toBeNull();
  });

  it('renders the pixel face as an image and the Tangled mark inline as svg', () => {
    const root = mount(renderFooter());
    expect(root.querySelector('img.avatar')?.getAttribute('src')).toBe('/jeremy-herve.svg');
    expect(root.querySelector(`a[href="${REPO_URL}"] svg`)).not.toBeNull();
  });
});

describe('state motifs', () => {
  it('the loader announces itself with a status role', () => {
    expect(mount(diceLoader()).querySelector('[role="status"]')).not.toBeNull();
  });

  it('an empty state shows its invitation copy', () => {
    const root = mount(emptyState({ title: 'Nothing here', body: 'Add something' }));
    expect(root.textContent).toContain('Nothing here');
    expect(root.textContent).toContain('Add something');
  });

  it('an error state is announced as an alert', () => {
    expect(mount(errorState()).querySelector('[role="alert"]')).not.toBeNull();
  });
});
