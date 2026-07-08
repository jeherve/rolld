import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { wireActorTypeahead } from '../src/ui/actorTypeahead.js';
import type { ActorSuggestion } from '../src/read/bsky.js';

const alice: ActorSuggestion = { did: 'did:plc:alice', handle: 'alice.bsky.social', displayName: 'Alice' };
const bob: ActorSuggestion = { did: 'did:plc:bob', handle: 'bob.example', avatar: 'https://cdn/bob.jpg' };

/** Mount an input + results container wired to a stub search, as the login/log flow do. */
function setup(search: (q: string) => Promise<ActorSuggestion[]>) {
  const input = document.createElement('input');
  const results = document.createElement('div');
  const picks: ActorSuggestion[] = [];
  wireActorTypeahead(input, results, { onPick: (s) => picks.push(s), search });
  const type = (v: string) => {
    input.value = v;
    input.dispatchEvent(new Event('input'));
  };
  return { input, results, picks, type };
}

describe('wireActorTypeahead', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('debounces and searches once the query is long enough', async () => {
    const search = vi.fn(async () => [alice]);
    const { results, type } = setup(search);

    type('al');
    expect(search).not.toHaveBeenCalled(); // still inside the debounce window
    await vi.advanceTimersByTimeAsync(250);

    expect(search).toHaveBeenCalledExactlyOnceWith('al');
    const rows = results.querySelectorAll('.ta-actor');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.getAttribute('data-handle')).toBe('alice.bsky.social');
    expect(rows[0]!.textContent).toContain('Alice');
    expect(rows[0]!.textContent).toContain('@alice.bsky.social');
  });

  it('does not search below the two-character minimum, and clears results', async () => {
    const search = vi.fn(async () => [alice]);
    const { results, type } = setup(search);

    type('alice'); // seed a dropdown
    await vi.advanceTimersByTimeAsync(250);
    expect(results.querySelectorAll('.ta-actor')).toHaveLength(1);

    type('a'); // back under the minimum
    await vi.advanceTimersByTimeAsync(250);
    expect(search).toHaveBeenCalledTimes(1); // no second call
    expect(results.querySelectorAll('.ta-actor')).toHaveLength(0);
  });

  it('reports the picked suggestion, falling back to the handle when unnamed', async () => {
    const search = vi.fn(async () => [bob]);
    const { results, picks, type } = setup(search);

    type('bob');
    await vi.advanceTimersByTimeAsync(250);
    const row = results.querySelector<HTMLButtonElement>('.ta-actor')!;
    expect(row.textContent).toContain('@bob.example'); // no displayName → handle shows
    row.click();

    expect(picks).toEqual([{ did: 'did:plc:bob', handle: 'bob.example' }]);
  });

  it('drops stale results when a newer keystroke wins the race', async () => {
    // First query resolves slowly with the old result; a newer query supersedes it.
    const search = vi.fn(async (q: string) => (q === 'al' ? [alice] : [bob]));
    const { input, results, type } = setup(search);

    type('al');
    await vi.advanceTimersByTimeAsync(250); // 'al' search in flight
    type('bob'); // input now says "bob" before 'al' would render
    await vi.advanceTimersByTimeAsync(250);

    const rows = results.querySelectorAll('.ta-actor');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.getAttribute('data-handle')).toBe('bob.example'); // not the stale alice
    void input;
  });

  it('fires onType on every keystroke, before searching', async () => {
    const onType = vi.fn();
    const input = document.createElement('input');
    const results = document.createElement('div');
    wireActorTypeahead(input, results, { onPick: () => {}, onType, search: async () => [] });

    input.value = 'a';
    input.dispatchEvent(new Event('input'));
    input.value = 'al';
    input.dispatchEvent(new Event('input'));
    expect(onType).toHaveBeenCalledTimes(2);
  });

  it('clears the dropdown when the search fails (best-effort, D-15)', async () => {
    const search = vi.fn(async () => {
      throw new Error('typeahead down');
    });
    const { results, type } = setup(search);

    type('alice');
    await vi.advanceTimersByTimeAsync(250);
    expect(results.querySelectorAll('.ta-actor')).toHaveLength(0);
  });
});
