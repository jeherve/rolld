/**
 * The write flows (FLOW-1 log, FLOW-2 rate) and the share modal (CC-3), plus the
 * game-search typeahead (CC-1). These are the priority mobile surfaces (D-35), so
 * they're built as bottom sheets: the form sits in thumb reach, the quick-add path
 * (pick a game, pick a date, submit) is two taps, and the rest tucks into an "add
 * details" expansion. Success gets a small beat (D-36). This is the interactive
 * heart of the app — DOM glue over the tested write path.
 */
import { uploadAndEmbed } from '../atproto/blob.js';
import { writePlay, writeRating } from '../atproto/records.js';
import { searchGames } from '../bgg/resolveGame.js';
import { entryUrl, gamePath } from '../links.js';
import { type ActorSuggestion } from '../read/bsky.js';
import type { GameRef, ImageEmbed, Player } from '../records/types.js';
import { createCompanionPost, defaultShareText } from '../share/bsky.js';
import { graphemesRemaining } from '../text/graphemes.js';
import { wireActorTypeahead } from './actorTypeahead.js';
import type { PageCtx } from './context.js';
import { html, render, type SafeHtml } from './html.js';
import { gameCover } from './render.js';

/* ---- bottom-sheet shell ------------------------------------------------------ */

export interface Sheet {
  root: HTMLElement;
  body: HTMLElement;
  /** The pinned action bar. Empty and hidden unless `openSheet` got `actions`. */
  foot: HTMLElement;
  close(): void;
}

/**
 * The sheet is three bands: a head, a scrolling body, and an optional foot. Only
 * the body scrolls, so on a phone the ✕ and the submit button stay on screen
 * however far the form runs (D-35). Anything you put in `actions` sits in the
 * foot — a submit button there still drives the form via its `form` attribute.
 */
export function openSheet(title: string, content: SafeHtml, actions?: SafeHtml): Sheet {
  const root = document.createElement('div');
  root.className = 'sheet-overlay';
  render(
    root,
    html`<div class="sheet" role="dialog" aria-modal="true" aria-label="${title}">
      <div class="sheet-head">
        <h2>${title}</h2>
        <button class="sheet-close" aria-label="Close" data-close>✕</button>
      </div>
      <div class="sheet-body"></div>
      <div class="sheet-foot" hidden></div>
    </div>`,
  );
  document.body.appendChild(root);
  document.body.style.overflow = 'hidden';
  const body = root.querySelector<HTMLElement>('.sheet-body')!;
  render(body, content);
  const foot = root.querySelector<HTMLElement>('.sheet-foot')!;
  if (actions) {
    render(foot, actions);
    foot.hidden = false;
  }
  const close = (): void => {
    root.remove();
    document.body.style.overflow = '';
  };
  root.querySelector('[data-close]')!.addEventListener('click', close);
  root.addEventListener('click', (e) => {
    if (e.target === root) close();
  });
  return { root, body, foot, close };
}

/* ---- CC-1 game search field -------------------------------------------------- */

interface GamePicker {
  field: SafeHtml;
  /** Wire the typeahead after the field is in the DOM; resolves the chosen gameRef. */
  bind(container: HTMLElement, onPick: (game: GameRef) => void): void;
}

function gamePicker(prefill?: GameRef): GamePicker {
  const field = html`
    <div class="game-picker">
      <div class="picked" data-picked hidden></div>
      <input class="text-input mono" data-q placeholder="Search for a game" autocomplete="off" />
      <div class="typeahead" data-results></div>
    </div>
  `;
  return {
    field,
    bind(container, onPick) {
      const input = container.querySelector<HTMLInputElement>('[data-q]')!;
      const results = container.querySelector<HTMLElement>('[data-results]')!;
      const picked = container.querySelector<HTMLElement>('[data-picked]')!;
      const choose = (game: GameRef): void => {
        render(picked, html`<span class="chip">${game.name}${game.yearPublished ? html` (${game.yearPublished})` : ''} <button type="button" data-change>change</button></span>`);
        picked.hidden = false;
        input.hidden = true;
        results.replaceChildren();
        picked.querySelector('[data-change]')!.addEventListener('click', () => {
          picked.hidden = true;
          input.hidden = false;
          input.focus();
        });
        onPick(game);
      };
      if (prefill) choose(prefill);

      let timer: ReturnType<typeof setTimeout> | undefined;
      input.addEventListener('input', () => {
        clearTimeout(timer);
        const q = input.value.trim();
        if (q.length < 3) {
          results.replaceChildren();
          return;
        }
        // Debounced ~350ms (CC-1): BGG search is server-proxied + rate-limited.
        timer = setTimeout(() => {
          void searchGames(q)
            .then((games) => {
              render(
                results,
                html`${games.slice(0, 8).map(
                  (g) => html`<button type="button" class="ta-item ta-game" data-id="${g.id}" data-name="${g.name}" data-year="${g.yearPublished ?? ''}">
                    ${gameCover(g.name, g, 28)}
                    <span class="ta-game-name">${g.name}</span>${g.yearPublished ? html` <span class="muted mono">(${g.yearPublished})</span>` : ''}
                  </button>`,
                )}`,
              );
              for (const item of results.querySelectorAll<HTMLButtonElement>('.ta-item')) {
                item.addEventListener('click', () => {
                  const year = item.dataset.year;
                  choose({
                    id: item.dataset.id!,
                    name: item.dataset.name!,
                    ...(year ? { yearPublished: Number(year) } : {}),
                  });
                });
              }
            })
            .catch(() => render(results, html`<p class="muted small">Search is unavailable right now.</p>`));
        }, 350);
      });
    },
  };
}

/* ---- success beat ------------------------------------------------------------ */

export function toast(message: string): void {
  const beat = document.createElement('div');
  beat.className = 'success-beat';
  beat.setAttribute('role', 'status');
  render(beat, html`<span class="die-settled" aria-hidden="true"></span> ${message}`);
  document.body.appendChild(beat);
  setTimeout(() => beat.remove(), 1800);
}

function successBeat(message: string): void {
  toast(message);
}

/* ---- FLOW-1: log a play ------------------------------------------------------ */

export function openLogFlow(ctx: PageCtx, prefill?: GameRef): void {
  const session = ctx.state.session;
  if (!session) {
    ctx.navigate('/login');
    return;
  }
  const picker = gamePicker(prefill);
  const today = new Date().toISOString().slice(0, 10);
  const sheet = openSheet(
    'Log a play',
    html`
      <form id="log-form">
        ${picker.field}
        <label class="mono" for="when">When</label>
        <input id="when" name="when" type="date" class="text-input mono" value="${today}" />

        <details class="add-details">
          <summary>Add details</summary>
          <div id="players"></div>
          <button type="button" class="pixel-btn small" data-add-player>+ player</button>
          <label class="mono" for="loc">Where</label>
          <input id="loc" name="loc" class="text-input mono" placeholder="someone's place, a cafe, a con…" />
          <label class="mono" for="dur">Duration (minutes)</label>
          <input id="dur" name="dur" type="number" min="0" class="text-input mono" />
          <label class="mono" for="photos">Photos (up to 4)</label>
          <input id="photos" name="photos" type="file" accept="image/*" multiple class="text-input mono" />
          <div id="photo-alts"></div>
          <label class="mono" for="note">Note</label>
          <textarea id="note" name="note" class="text-input mono" rows="4" placeholder="how did it go?"></textarea>
        </details>

        <label class="share-toggle mono"><input type="checkbox" id="share" /> Share on the Atmosphere</label>
      </form>
    `,
    html`
      <p class="mono small muted" id="log-status" role="status"></p>
      <button type="submit" form="log-form" class="pixel-btn is-active submit-cta">Log play</button>
    `,
  );

  let game: GameRef | null = null;
  picker.bind(sheet.body, (g) => (game = g));

  const players: Player[] = [];
  const playersEl = sheet.body.querySelector<HTMLElement>('#players')!;
  // Rows are appended, not re-rendered, so each one keeps its typed value and any
  // "tagged @handle" state when another player is added.
  const addPlayerRow = (): void => {
    const player: Player = { displayName: '' };
    players.push(player);
    const i = players.length - 1;
    const entry = document.createElement('div');
    entry.className = 'player-entry';
    entry.dataset.i = String(i);
    render(
      entry,
      html`<div class="player-row mono">
          <div class="player-name">
            <input class="text-input" data-name placeholder="name" autocomplete="off" autocapitalize="off" spellcheck="false" />
            <div class="typeahead" data-presults></div>
          </div>
          <input class="text-input score" data-score type="number" placeholder="score" />
          <label><input type="checkbox" data-winner /> won</label>
        </div>
        <p class="player-tag mono small" data-tag hidden></p>`,
    );
    playersEl.appendChild(entry);
    wirePlayerRow(entry, player);
    entry.querySelector<HTMLInputElement>('[data-name]')!.focus();
  };
  sheet.body.querySelector('[data-add-player]')!.addEventListener('click', addPlayerRow);

  // Per-photo alt text (D-33: alt is required) appears as files are chosen.
  const photoInput = sheet.body.querySelector<HTMLInputElement>('#photos')!;
  const altEl = sheet.body.querySelector<HTMLElement>('#photo-alts')!;
  photoInput.addEventListener('change', () => {
    const files = photoInput.files ? [...photoInput.files].slice(0, 4) : [];
    render(
      altEl,
      html`${files.map(
        (f, i) => html`<input class="text-input mono small" data-alt="${i}" placeholder="describe photo: ${f.name}" />`,
      )}`,
    );
  });

  const form = sheet.body.querySelector<HTMLFormElement>('#log-form')!;
  const status = sheet.foot.querySelector<HTMLElement>('#log-status')!;
  const submit = sheet.foot.querySelector<HTMLButtonElement>('.submit-cta')!;
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!game) {
      status.textContent = 'Pick a game first.';
      return;
    }
    const fd = new FormData(form);
    submit.disabled = true;
    status.textContent = 'Logging…';

    void (async () => {
      try {
        const images = await collectPhotos(session.agent, sheet.body);
        // A tagged winner is recorded by DID (links to their profile); an untyped
        // one by name. Both are honoured (winnerSummary reads either).
        const winners = players.filter((_, i) => winnerChecked(playersEl, i));
        const winnerDids = winners.filter((p) => p.did).map((p) => p.did!);
        const winnerNames = winners.filter((p) => !p.did && p.displayName?.trim()).map((p) => p.displayName!);
        const filledPlayers = players.filter((p) => p.displayName?.trim());
        const note = fd.get('note')?.toString() ?? '';
        const written = await writePlay(session.agent, {
          game: game!,
          playedAt: new Date(`${fd.get('when')}T12:00:00Z`).toISOString(),
          ...(filledPlayers.length ? { players: filledPlayers } : {}),
          ...(winnerDids.length ? { winnerDids } : {}),
          ...(winnerNames.length ? { winnerNames } : {}),
          ...(fd.get('loc')?.toString().trim() ? { location: fd.get('loc')!.toString() } : {}),
          ...(fd.get('dur') ? { durationMinutes: Number(fd.get('dur')) } : {}),
          ...(images.length ? { images } : {}),
          ...(note.trim() ? { note } : {}),
        });
        sheet.close();
        successBeat('Play logged!');
        if ((sheet.body.querySelector('#share') as HTMLInputElement)?.checked) {
          openShareModal(ctx, {
            verb: 'Played',
            gameName: game!.name,
            url: entryUrl(session.handle, 'play', written.rkey),
            ...(images.length ? { images } : {}),
          });
        }
        ctx.navigate('/dashboard');
      } catch {
        submit.disabled = false;
        status.textContent = "That didn't save. Your details are still here — try again.";
      }
    })();
  });
}

function winnerChecked(playersEl: HTMLElement, i: number): boolean {
  return Boolean(
    playersEl.querySelector<HTMLInputElement>(`.player-entry[data-i="${i}"] [data-winner]`)?.checked,
  );
}

/**
 * Wire one player row (D-56): a free-text name field with a network-wide handle
 * typeahead over it. Typing searches the whole atproto network; picking a result
 * tags the co-player by DID so their name links to a real profile later, while a
 * plain typed name still works for someone who isn't on the network (D-15). Editing
 * the field after tagging drops back to free text.
 */
function wirePlayerRow(entry: HTMLElement, player: Player): void {
  const nameInput = entry.querySelector<HTMLInputElement>('[data-name]')!;
  const results = entry.querySelector<HTMLElement>('[data-presults]')!;
  const scoreInput = entry.querySelector<HTMLInputElement>('[data-score]')!;
  const tag = entry.querySelector<HTMLElement>('[data-tag]')!;

  const setTag = (handle?: string): void => {
    tag.textContent = handle ? `✓ tagged @${handle}` : '';
    tag.hidden = !handle;
  };
  const choose = (s: ActorSuggestion): void => {
    player.did = s.did;
    player.displayName = s.displayName ?? s.handle;
    nameInput.value = player.displayName;
    results.replaceChildren();
    setTag(s.handle);
  };

  scoreInput.addEventListener('input', () => {
    const v = scoreInput.value;
    player.score = v ? Number(v) : undefined;
  });

  wireActorTypeahead(nameInput, results, {
    onPick: choose,
    onType: () => {
      // A manual edit means this is free text again — drop any DID tag from a pick.
      player.displayName = nameInput.value;
      if (player.did) {
        delete player.did;
        setTag();
      }
    },
  });
}

async function collectPhotos(agent: Parameters<typeof writePlay>[0], body: HTMLElement): Promise<ImageEmbed[]> {
  const input = body.querySelector<HTMLInputElement>('#photos');
  const files = input?.files ? [...input.files].slice(0, 4) : [];
  if (!files.length) return [];
  const out: ImageEmbed[] = [];
  for (let i = 0; i < files.length; i++) {
    const alt = body.querySelector<HTMLInputElement>(`[data-alt="${i}"]`)?.value ?? '';
    out.push(await uploadAndEmbed(agent, files[i]!, alt));
  }
  return out;
}

/* ---- FLOW-2: rate a game ----------------------------------------------------- */

export function openRateFlow(ctx: PageCtx, prefill?: GameRef): void {
  const session = ctx.state.session;
  if (!session) {
    ctx.navigate('/login');
    return;
  }
  const picker = gamePicker(prefill);
  const sheet = openSheet(
    'Rate a game',
    html`
      <form id="rate-form">
        ${picker.field}
        <label class="mono">Your grade</label>
        <div class="grade-picker" id="grades">
          ${Array.from({ length: 10 }, (_, n) => html`<button type="button" class="pixel-btn grade-btn" data-grade="${n + 1}">${n + 1}</button>`)}
        </div>
        <label class="mono" for="review">Review (optional)</label>
        <textarea id="review" class="text-input mono" rows="4" placeholder="what did you think?"></textarea>
        <label class="share-toggle mono"><input type="checkbox" id="share" /> Share on the Atmosphere</label>
      </form>
    `,
    html`
      <p class="mono small muted" id="rate-status" role="status"></p>
      <button type="submit" form="rate-form" class="pixel-btn is-active submit-cta">Save grade</button>
    `,
  );

  let game: GameRef | null = null;
  picker.bind(sheet.body, (g) => (game = g));
  let grade = 0;
  const grades = sheet.body.querySelector<HTMLElement>('#grades')!;
  for (const btn of grades.querySelectorAll<HTMLButtonElement>('.grade-btn')) {
    btn.addEventListener('click', () => {
      grade = Number(btn.dataset.grade);
      for (const b of grades.querySelectorAll('.grade-btn')) b.classList.toggle('is-active', b === btn);
    });
  }

  const form = sheet.body.querySelector<HTMLFormElement>('#rate-form')!;
  const status = sheet.foot.querySelector<HTMLElement>('#rate-status')!;
  const submit = sheet.foot.querySelector<HTMLButtonElement>('.submit-cta')!;
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!game) {
      status.textContent = 'Pick a game first.';
      return;
    }
    if (grade < 1) {
      status.textContent = 'Pick a grade from 1 to 10.';
      return;
    }
    submit.disabled = true;
    status.textContent = 'Saving…';
    const review = sheet.body.querySelector<HTMLTextAreaElement>('#review')!.value;
    void (async () => {
      try {
        const written = await writeRating(session.agent, {
          game: game!,
          rating: grade,
          ...(review.trim() ? { note: review } : {}),
        });
        sheet.close();
        successBeat('Grade saved!');
        if ((sheet.body.querySelector('#share') as HTMLInputElement)?.checked) {
          openShareModal(ctx, {
            verb: 'Rated',
            gameName: game!.name,
            rating: grade,
            url: entryUrl(session.handle, 'rating', written.rkey),
          });
        }
        ctx.navigate(gamePath(game!.id));
      } catch {
        submit.disabled = false;
        status.textContent = "That didn't save. Try again in a moment.";
      }
    })();
  });
}

/* ---- CC-3: share-to-the-Atmosphere modal ------------------------------------- */

interface ShareInput {
  verb: 'Played' | 'Rated';
  gameName: string;
  rating?: number;
  url: string;
  images?: ImageEmbed[];
}

export function openShareModal(ctx: PageCtx, input: ShareInput): void {
  const session = ctx.state.session;
  if (!session) return;
  const draft = defaultShareText(input);
  const sheet = openSheet(
    'Share on the Atmosphere',
    html`
      <textarea id="share-text" class="text-input mono" rows="4">${draft}</textarea>
      <p class="mono small" id="count"></p>
    `,
    html`
      <p class="mono small muted" id="share-status" role="status"></p>
      <button id="share-post" class="pixel-btn is-active submit-cta">Post to the Atmosphere</button>
    `,
  );
  const textarea = sheet.body.querySelector<HTMLTextAreaElement>('#share-text')!;
  const count = sheet.body.querySelector<HTMLElement>('#count')!;
  const updateCount = (): void => {
    const left = graphemesRemaining(textarea.value);
    count.textContent = `${left} left`;
    count.classList.toggle('over', left < 0);
  };
  textarea.addEventListener('input', updateCount);
  updateCount();

  const status = sheet.foot.querySelector<HTMLElement>('#share-status')!;
  const post = sheet.foot.querySelector<HTMLButtonElement>('#share-post')!;
  post.addEventListener('click', () => {
    if (graphemesRemaining(textarea.value) < 0) {
      status.textContent = 'A little too long for the Atmosphere — trim it down.';
      return;
    }
    post.disabled = true;
    status.textContent = 'Posting…';
    void (async () => {
      try {
        await createCompanionPost(session.agent, {
          text: textarea.value,
          ...(input.images ? { images: input.images } : {}),
        });
        sheet.close();
        successBeat('Shared!');
      } catch {
        post.disabled = false;
        status.textContent = "Couldn't post that. Try again in a moment.";
      }
    })();
  });
  void ctx;
}
