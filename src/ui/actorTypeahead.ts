/**
 * The network-wide handle typeahead (D-56), shared by the co-player field in the
 * log flow and the sign-in handle field. Typing searches the whole atproto
 * network; picking a result hands back the account. Debounced ~250ms so a fast
 * typist doesn't fire a request per keystroke, with a race guard so a newer
 * keystroke's results win. Best-effort: if the search fails the dropdown just
 * clears and the raw text still works (D-15).
 */
import { searchActors, type ActorSuggestion } from '../read/bsky.js';
import { html, render } from './html.js';
import { avatar } from './render.js';

export interface ActorTypeaheadOptions {
  /** Called when the user picks a suggestion. */
  onPick: (s: ActorSuggestion) => void;
  /** Called on every keystroke, before searching (e.g. to drop a prior tag). */
  onType?: () => void;
  /** Search backend; defaults to the merged network typeahead. Injectable for tests. */
  search?: (q: string) => Promise<ActorSuggestion[]>;
}

/**
 * Wire the typeahead over `input`, rendering suggestions into `results` and
 * calling `onPick` when one is chosen. Returns a disposer that clears any
 * pending debounce timer.
 */
export function wireActorTypeahead(
  input: HTMLInputElement,
  results: HTMLElement,
  opts: ActorTypeaheadOptions,
): () => void {
  const search = opts.search ?? searchActors;
  let timer: ReturnType<typeof setTimeout> | undefined;

  input.addEventListener('input', () => {
    opts.onType?.();
    clearTimeout(timer);
    const q = input.value.trim();
    if (q.length < 2) {
      results.replaceChildren();
      return;
    }
    timer = setTimeout(() => {
      void search(q)
        .then((actors) => {
          if (input.value.trim() !== q) return; // a newer keystroke won the race
          render(
            results,
            html`${actors.map(
              (a) => html`<button type="button" class="ta-item ta-actor" data-did="${a.did}" data-handle="${a.handle}" data-name="${a.displayName ?? ''}">
                ${avatar(a.avatar, a.handle, 22)}
                <span class="ta-actor-name">${a.displayName ?? `@${a.handle}`}</span>
                <span class="muted mono">@${a.handle}</span>
              </button>`,
            )}`,
          );
          for (const item of results.querySelectorAll<HTMLButtonElement>('.ta-actor')) {
            item.addEventListener('click', () =>
              opts.onPick({
                did: item.dataset.did!,
                handle: item.dataset.handle!,
                ...(item.dataset.name ? { displayName: item.dataset.name } : {}),
              }),
            );
          }
        })
        .catch(() => results.replaceChildren());
    }, 250);
  });

  return () => clearTimeout(timer);
}
