/**
 * The pages. Each is a render-from-state function: paint the chrome and a
 * loading state at once, then fetch and repaint as data arrives (CC-5). Public read
 * pages (game, profile, entry) need no sign-in and render well logged-out, since
 * they're where shared Atmosphere links land (D-40). Copy is in the maintainer's plain,
 * warm voice (D-30): sentence case, invitations not dead-ends, honest about the tech.
 */
import { beginLogin } from '../auth/oauth.js';
import { deleteProfile } from '../atproto/records.js';
import { resolveGame, resolveGames, searchGames } from '../bgg/resolveGame.js';
import type { GameMetadata } from '../bgg/types.js';
import { APPVIEW_WEB, COLLECTION, ORIGIN, PROFILE_RKEY } from '../config.js';
import { didEntryPath, entryPath, gamePath, gameTargetUrl, playsPath, profilePath } from '../links.js';
import type { GameRef, PlayRecord, ProfileRecord, RatingRecord } from '../records/types.js';

/** A play or rating record value seen through the entry-permalink lens (fields from either). */
type EntryValue = Partial<PlayRecord> & Partial<RatingRecord> & { game: GameRef };
import { appviewClient, getCommentThread, getProfile, getProfiles, type BskyProfile } from '../read/bsky.js';
import { atmospherePostUrl } from '../share/atmosphere-url.js';
import {
  gameDistinctPlayers,
  gamePlays,
  gameTotalPlays,
  playCountByDids,
} from '../read/constellation.js';
import { buildFriendsFeed } from '../read/friends.js';
import { resolveMiniDoc } from '../read/identity.js';
import { renderMarkdown } from '../read/markdown-render.js';
import { getRecordValue, listAllPlays, listAllRatings, pdsClient } from '../read/repo.js';
import { subscribeToPlays } from '../read/spacedust.js';
import { mostPlayed, playSummary, timesPlayed, topRated } from '../stats/personal.js';
import { wireActorTypeahead } from './actorTypeahead.js';
import type { PageCtx } from './context.js';
import { feedCard, type FeedAuthor } from './feedCard.js';
import { countNoun, formatDate, formatDateLong, hasReportableContent, relativeTime } from './format.js';
import { html, raw, render, type SafeHtml } from './html.js';
import { externalMark } from './icons.js';
import { renderLanding } from './landing.js';
import { performSignOut } from './accountMenu.js';
import { openLogFlow, openRateFlow } from './flows.js';
import { linkifyBio } from './richText.js';
import { avatar, gameCover, gradeBadge, playPhotos, reportLink, sectionTitle } from './render.js';
import { diceLoader, emptyState, errorState } from './states.js';

const appview = appviewClient();

/* ---- shared helpers ---------------------------------------------------------- */

function page(...parts: SafeHtml[]): SafeHtml {
  return html`<div class="page">${parts}</div>`;
}

function signInPrompt(ctx: PageCtx, message: string): SafeHtml {
  void ctx;
  return html`
    <div class="panel signin-card">
      <p>${message}</p>
      <a class="pixel-btn is-active" href="/login" data-link>Sign in with atproto</a>
    </div>
  `;
}

const loadError = (retry?: SafeHtml): SafeHtml =>
  html`${errorState({
    title: 'That roll went sideways',
    body: 'Something went wrong loading this. Give it another go in a moment.',
  })}${retry}`;

/** Resolve the display identity for a set of DIDs (best-effort, for feed cards). */
async function loadAuthors(dids: string[]): Promise<Map<string, FeedAuthor>> {
  const out = new Map<string, FeedAuthor>();
  const unique = [...new Set(dids)];
  // One batched call per 25 authors (getProfiles) instead of one request per DID.
  const profiles = await getProfiles(appview, unique);
  const byDid = new Map(profiles.map((p) => [p.did, p]));
  for (const did of unique) {
    const profile = byDid.get(did);
    out.set(did, {
      did,
      handle: profile?.handle ?? did,
      ...(profile?.displayName ? { displayName: profile.displayName } : {}),
      ...(profile?.avatar ? { avatar: profile.avatar } : {}),
    });
  }
  return out;
}

/* ---- / (home) ---------------------------------------------------------------- */

export function home(ctx: PageCtx): void {
  if (ctx.state.session) {
    ctx.navigate('/dashboard');
    return;
  }
  render(ctx.main, renderLanding());
}

/* ---- /login ------------------------------------------------------------------ */

export function login(ctx: PageCtx): void {
  render(
    ctx.main,
    page(html`
      <div class="panel signin-card">
        <h1>Sign in</h1>
        <p>
          rolld uses your atproto account. Your plays and ratings live on your own account, not in
          a database here :)
        </p>
        <form id="login-form" class="login-form">
          <label class="mono" for="handle">Your handle</label>
          <div class="handle-field">
            <input id="handle" name="handle" class="text-input mono" placeholder="you.bsky.social" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" />
            <div class="typeahead" data-handle-results></div>
          </div>
          <button type="submit" class="pixel-btn is-active">Continue</button>
        </form>
        <p class="muted mono small" id="login-status"></p>
      </div>
    `),
  );
  const form = ctx.main.querySelector<HTMLFormElement>('#login-form')!;
  const status = ctx.main.querySelector<HTMLElement>('#login-status')!;
  const handleInput = form.querySelector<HTMLInputElement>('#handle')!;
  const handleResults = form.querySelector<HTMLElement>('[data-handle-results]')!;
  const continueBtn = form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
  // Same network-wide handle typeahead as the co-player field (D-56): pick an
  // account to fill the field, then confirm with Continue (no auto-redirect).
  wireActorTypeahead(handleInput, handleResults, {
    onPick: (s) => {
      handleInput.value = s.handle;
      handleResults.replaceChildren();
      continueBtn.focus();
    },
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const handle = new FormData(form).get('handle')?.toString().trim();
    if (!handle) return;
    status.textContent = 'Taking you to your account…';
    sessionStorage.setItem('rolld:returnTo', '/dashboard');
    beginLogin(handle).catch(() => {
      status.textContent = "Couldn't start sign-in. Check the handle and try again.";
    });
  });
}

/* ---- /dashboard -------------------------------------------------------------- */

export function dashboard(ctx: PageCtx): void {
  const session = ctx.state.session;
  if (!session) {
    render(ctx.main, page(signInPrompt(ctx, 'Sign in to see what your friends are playing.')));
    return;
  }
  const header = html`
    <div class="dash-head">
      <h1>Your table</h1>
      <button class="pixel-btn is-active" data-action="log">Log a play</button>
    </div>
  `;
  render(ctx.main, page(header, html`<div id="feed">${diceLoader('Setting the table…')}</div>`));

  const feedEl = ctx.main.querySelector<HTMLElement>('#feed')!;
  void (async () => {
    try {
      const feed = await buildFriendsFeed(session.did, session.pds, { followCap: 40 });
      if (feed.length === 0) {
        render(
          feedEl,
          emptyState({
            title: 'No games on the table yet',
            body: 'Log your first play to get the dice rolling. Share it, and your friends on the Atmosphere can follow along.',
          }),
        );
        return;
      }
      // Author identities and game metadata are independent fan-outs — run them
      // together so the dashboard waits on the slower of the two, not their sum.
      const [authors, metas] = await Promise.all([
        loadAuthors(feed.map((f) => f.authorDid)),
        resolveGames(feed.map((f) => f.play.game.id)),
      ]);
      render(
        feedEl,
        html`${feed.map((item) =>
          feedCard({
            play: item.play,
            rkey: item.rkey,
            uri: item.uri,
            author: authors.get(item.authorDid) ?? { did: item.authorDid, handle: item.authorDid },
            meta: metas.get(item.play.game.id) ?? null,
          }),
        )}`,
      );
      // Live tail (D-26): prepend plays from follows as they arrive, while open.
      const followDids = [...new Set(feed.filter((f) => !f.isOwn).map((f) => f.authorDid))];
      startLiveTail(ctx, feedEl, followDids, new Set(feed.map((f) => f.uri)));
    } catch {
      render(feedEl, loadError());
    }
  })();
}

/** Module-level handle so navigating away from the dashboard closes the socket. */
let liveUnsub: (() => void) | null = null;

/** Close the dashboard's live tail (called on navigation away). */
export function closeLiveTail(): void {
  liveUnsub?.();
  liveUnsub = null;
}

function startLiveTail(ctx: PageCtx, feedEl: HTMLElement, followDids: string[], seen: Set<string>): void {
  liveUnsub?.();
  if (followDids.length === 0) {
    liveUnsub = null;
    return;
  }
  liveUnsub = subscribeToPlays(followDids, (uri) => {
    if (seen.has(uri) || !feedEl.isConnected) return;
    seen.add(uri);
    void prependLivePlay(ctx, feedEl, uri);
  });
}

/** Fetch a newly-arrived play and prepend its card with a subtle "new" mark. */
async function prependLivePlay(ctx: PageCtx, feedEl: HTMLElement, uri: string): Promise<void> {
  void ctx;
  const [, , did, , rkey] = uri.split('/');
  if (!did || !rkey) return;
  const doc = await resolveMiniDoc(did);
  if (!doc) return;
  const play = await getRecordValue<PlayRecord>(pdsClient(doc.pds), did, COLLECTION.play, rkey);
  if (!play) return;
  const [authors, metas] = await Promise.all([loadAuthors([did]), resolveGames([play.game.id])]);
  const card = document.createElement('div');
  card.className = 'live-new';
  render(
    card,
    feedCard({
      play,
      rkey,
      uri,
      author: authors.get(did) ?? { did, handle: doc.handle },
      meta: metas.get(play.game.id) ?? null,
    }),
  );
  feedEl.prepend(card);
}

/* ---- /g/:bggId (game page) --------------------------------------------------- */

export function gamePage(ctx: PageCtx, bggId: string): void {
  const target = gameTargetUrl(bggId);
  render(ctx.main, page(html`<div id="game">${diceLoader('Fetching the box…')}</div>`));
  const el = ctx.main.querySelector<HTMLElement>('#game')!;

  void (async () => {
    const [meta, totalPlays, players] = await Promise.all([
      resolveGame(bggId),
      gameTotalPlays(target).catch(() => null),
      gameDistinctPlayers(target).catch(() => null),
    ]);
    const session = ctx.state.session;
    let mine: { count: number; rating: RatingRecord | null } | null = null;
    if (session) {
      const [count, rating] = await Promise.all([
        playCountByDids(target, [session.did]).catch(() => 0),
        getRecordValue<RatingRecord>(pdsClient(session.pds), session.did, COLLECTION.rating, bggId).catch(
          () => null,
        ),
      ]);
      mine = { count, rating };
    }
    render(el, gamePageView(ctx, bggId, meta, { totalPlays, players }, mine));
    bindGameButtons(ctx, bggId, meta);
  })().catch(() => render(el, loadError()));
}

function gamePageView(
  ctx: PageCtx,
  bggId: string,
  meta: GameMetadata | null,
  community: { totalPlays: number | null; players: number | null },
  mine: { count: number; rating: RatingRecord | null } | null,
): SafeHtml {
  const name = meta?.name ?? `Game ${bggId}`;
  const bggUrl = `https://boardgamegeek.com/boardgame/${bggId}`;
  const youtube = `https://www.youtube.com/results?search_query=${encodeURIComponent(`${name} board game review`)}`;
  return html`
    <article class="game">
      <div class="game-hero">
        ${gameCover(name, meta, 120)}
        <div class="game-head">
          <h1>${name}${meta?.year ? html` <span class="muted">(${meta.year})</span>` : ''}</h1>
          ${meta
            ? html`<div class="facts mono muted">
                ${meta.minPlayers ? html`${meta.minPlayers}–${meta.maxPlayers} players` : ''}
                ${meta.minPlaytime ? html` · ${meta.minPlaytime}–${meta.maxPlaytime} min` : ''}
                ${meta.weight ? html` · complexity ${meta.weight.toFixed(1)}/5` : ''}
                ${meta.bggRating ? html` · BGG ${meta.bggRating.toFixed(1)}` : ''}
              </div>`
            : html`<p class="muted">We couldn't load this game's details right now.</p>`}
        </div>
      </div>

      <div class="cta-row">
        <button class="pixel-btn is-active" data-game-action="log">Log a play</button>
        <button class="pixel-btn" data-game-action="rate">${mine?.rating ? 'Update your grade' : 'Rate it'}</button>
      </div>

      ${mine
        ? html`<div class="panel your-stats">
            <h2 class="section">You</h2>
            <p>${mine.count > 0 ? countNoun(mine.count, 'play') : 'No plays logged yet.'}
              ${mine.rating ? html` · your grade ${gradeBadge(mine.rating.rating)}` : ''}</p>
          </div>`
        : ''}

      <div class="panel community">
        <h2 class="section">Across rolld</h2>
        <p>
          ${community.totalPlays === null
            ? 'Community stats are unavailable right now.'
            : html`${countNoun(community.totalPlays, 'play')} logged${community.players !== null
                ? html` by ${countNoun(community.players, 'player')}`
                : ''}.`}
        </p>
      </div>

      ${meta?.description
        ? html`<div class="game-desc"><h2 class="section">About</h2><p>${meta.description.slice(0, 600)}${meta.description.length > 600 ? '…' : ''}</p></div>`
        : ''}

      <div class="linkouts mono">
        <a href="${youtube}" target="_blank" rel="noopener noreferrer">Search this game on YouTube${externalMark}</a>
        <a href="${bggUrl}" target="_blank" rel="noopener noreferrer">View on BoardGameGeek${externalMark}</a>
      </div>
      ${ctx.state.session ? '' : signInPrompt(ctx, 'Track your own games on rolld.')}
    </article>
  `;
}

function bindGameButtons(ctx: PageCtx, bggId: string, meta: GameMetadata | null): void {
  const ref = { id: bggId, name: meta?.name ?? `Game ${bggId}`, ...(meta?.year ? { yearPublished: meta.year } : {}) };
  ctx.main.querySelector('[data-game-action="log"]')?.addEventListener('click', () => {
    ctx.state.session ? openLogFlow(ctx, ref) : ctx.navigate('/login');
  });
  ctx.main.querySelector('[data-game-action="rate"]')?.addEventListener('click', () => {
    ctx.state.session ? openRateFlow(ctx, ref) : ctx.navigate('/login');
  });
}

export function gamePlaysList(ctx: PageCtx, bggId: string): void {
  const target = gameTargetUrl(bggId);
  render(ctx.main, page(html`<div id="gp">${diceLoader()}</div>`));
  const el = ctx.main.querySelector<HTMLElement>('#gp')!;
  void (async () => {
    const pageData = await gamePlays(target, { limit: 50 });
    const authors = await loadAuthors(pageData.records.map((r) => r.did));
    render(
      el,
      html`<h1>Plays of this game</h1>
        ${pageData.records.length === 0
          ? emptyState({ title: 'No plays logged yet', body: 'Be the first to log a play of this game.' })
          : html`${pageData.records.map((r) => {
              const a = authors.get(r.did);
              return html`<div class="record mono">
                <a href="${entryPath(a?.handle ?? r.did, 'play', r.rkey)}" data-link>${a?.displayName ?? `@${a?.handle ?? r.did}`}</a>
              </div>`;
            })}`}`,
    );
  })().catch(() => render(el, loadError()));
}

/* ---- /@handle (profile) ------------------------------------------------------ */

export function profile(ctx: PageCtx, handle: string): void {
  render(ctx.main, page(html`<div id="profile">${diceLoader('Finding them…')}</div>`));
  const el = ctx.main.querySelector<HTMLElement>('#profile')!;
  void (async () => {
    const doc = await resolveMiniDoc(handle);
    if (!doc) {
      render(el, emptyState({ motif: '🧭', title: "We couldn't find that handle", body: 'It may be mistyped, or the account may have moved.' }));
      return;
    }
    // Canonical-handle redirect (D-14): if the current handle differs, freshen the URL.
    if (doc.handle !== handle && doc.handle !== 'handle.invalid') {
      ctx.replace(profilePath(doc.handle));
    }
    const [bio, plays, ratings] = await Promise.all([
      getProfile(appview, doc.did),
      listAllPlays(pdsClient(doc.pds), doc.did).catch(() => []),
      listAllRatings(pdsClient(doc.pds), doc.did).catch(() => []),
    ]);
    const declared = await getRecordValue<ProfileRecord>(pdsClient(doc.pds), doc.did, COLLECTION.profile, PROFILE_RKEY);
    render(el, profileView(doc.handle, bio, plays.map((r) => r.value), ratings.map((r) => r.value), Boolean(declared)));
    void hydrateTopGames(el, plays.map((r) => r.value));
  })().catch(() => render(el, loadError()));
}

function profileView(
  handle: string,
  bio: BskyProfile | null,
  plays: PlayRecord[],
  ratings: RatingRecord[],
  declared: boolean,
): SafeHtml {
  const top = mostPlayed(plays, 6);
  const rated = topRated(ratings, 6);
  const summary = playSummary(plays);
  return html`
    <header class="profile-head">
      ${bio?.banner ? html`<img class="banner" src="${bio.banner}" alt="" />` : ''}
      <div class="profile-id">
        ${avatar(bio?.avatar, bio?.displayName ?? handle, 72)}
        <div>
          <h1>${bio?.displayName ?? handle}</h1>
          <p class="muted mono">@${handle}</p>
        </div>
      </div>
      ${bio?.description ? html`<p class="bio">${linkifyBio(bio.description)}</p>` : ''}
      <p class="mono muted small profile-meta">
        ${countNoun(summary.totalPlays, 'play')} · ${countNoun(summary.distinctGames, 'game')}
        · <a href="${playsPath(handle)}" data-link>full log</a>
        · <a href="${APPVIEW_WEB}/profile/${handle}" target="_blank" rel="noopener noreferrer">Bluesky${externalMark}</a>
        · <a href="${ORIGIN}/api/@${handle}/feed.xml" target="_blank" rel="noopener noreferrer">RSS</a>
      </p>
    </header>

    ${!declared
      ? emptyState({ motif: '🎲', title: `${bio?.displayName ?? handle} hasn't logged any games on rolld yet`, body: 'Check back later, or log your own.' })
      : html`
          ${top.length
            ? html`<section>${sectionTitle('Most played')}<div class="game-grid" data-top-games>
                ${top.map((g) => html`<a class="grid-game" href="${gamePath(g.game.id)}" data-link data-gid="${g.game.id}">
                  ${gameCover(g.game.name, null, 72, { fill: true })}<span class="gg-name">${g.game.name}</span><span class="gg-count mono muted">${countNoun(g.count, 'play')}</span>
                </a>`)}
              </div></section>`
            : ''}
          ${rated.length
            ? html`<section>${sectionTitle('Top rated')}<div class="rated-shelf">
                ${rated.map((r) => html`<a class="rated-row" href="${gamePath(r.game.id)}" data-link>
                  <span>${r.game.name}</span> ${gradeBadge(r.rating)}
                </a>`)}
              </div></section>`
            : ''}
        `}
  `;
}

/** After the profile renders, fill the top-games grid covers from BGG (CC-5). */
async function hydrateTopGames(root: Element, plays: PlayRecord[]): Promise<void> {
  const ids = mostPlayed(plays, 6).map((g) => g.game.id);
  if (!ids.length) return;
  const metas = await resolveGames(ids);
  for (const node of root.querySelectorAll<HTMLElement>('[data-gid]')) {
    const meta = metas.get(node.dataset.gid!);
    const cover = node.querySelector('.cover.ph');
    // Prefer the full-res image for these large tiles; fall back to the thumbnail.
    const src = meta?.image ?? meta?.thumbnail;
    if (src && cover) {
      const img = document.createElement('img');
      img.className = 'cover fill';
      img.src = src;
      img.alt = meta!.name;
      img.loading = 'lazy';
      cover.replaceWith(img);
    }
  }
}

/* ---- /@handle/plays ---------------------------------------------------------- */

export function playLog(ctx: PageCtx, handle: string): void {
  render(ctx.main, page(html`<div id="log">${diceLoader()}</div>`));
  const el = ctx.main.querySelector<HTMLElement>('#log')!;
  void (async () => {
    const doc = await resolveMiniDoc(handle);
    if (!doc) {
      render(el, emptyState({ motif: '🧭', title: "We couldn't find that handle" }));
      return;
    }
    const plays = await listAllPlays(pdsClient(doc.pds), doc.did);
    if (plays.length === 0) {
      render(el, html`<h1>@${doc.handle}'s plays</h1>${emptyState({ title: 'No plays yet', body: 'When they log a game, it shows up here.' })}`);
      return;
    }
    const sorted = [...plays].sort((a, b) => b.value.playedAt.localeCompare(a.value.playedAt));
    const metas = await resolveGames(sorted.map((r) => r.value.game.id));
    const author: FeedAuthor = { did: doc.did, handle: doc.handle };
    render(
      el,
      html`<h1>@${doc.handle}'s plays</h1>
        ${sorted.map((r) =>
          feedCard({ play: r.value, rkey: r.rkey, uri: r.uri, author, meta: metas.get(r.value.game.id) ?? null }),
        )}`,
    );
  })().catch(() => render(el, loadError()));
}

/* ---- entry permalinks -------------------------------------------------------- */

export function entry(ctx: PageCtx, kind: 'play' | 'rating', handle: string, rkey: string): void {
  renderEntry(ctx, kind, handle, rkey, false);
}
export function entryByDid(ctx: PageCtx, kind: 'play' | 'rating', did: string, rkey: string): void {
  renderEntry(ctx, kind, did, rkey, true);
}

function renderEntry(ctx: PageCtx, kind: 'play' | 'rating', identifier: string, rkey: string, byDid: boolean): void {
  render(ctx.main, page(html`<div id="entry">${diceLoader()}</div>`));
  const el = ctx.main.querySelector<HTMLElement>('#entry')!;
  void (async () => {
    const doc = await resolveMiniDoc(identifier);
    if (!doc) {
      render(el, emptyState({ motif: '🧭', title: "We couldn't find that entry" }));
      return;
    }
    if (!byDid && doc.handle !== identifier && doc.handle !== 'handle.invalid') {
      ctx.replace(entryPath(doc.handle, kind, rkey));
    }
    const collection = kind === 'play' ? COLLECTION.play : COLLECTION.rating;
    const client = pdsClient(doc.pds);
    const value = await getRecordValue<EntryValue>(client, doc.did, collection, rkey);
    if (!value) {
      render(el, emptyState({ motif: '📦', title: "This entry isn't available" }));
      return;
    }
    const meta = await resolveGame(value.game.id);
    render(el, entryView(ctx, kind, doc.handle, doc.did, rkey, value, meta));
    void loadComments(el, value);
  })().catch(() => render(el, loadError()));
}

function entryView(
  ctx: PageCtx,
  kind: 'play' | 'rating',
  handle: string,
  did: string,
  rkey: string,
  value: EntryValue,
  meta: GameMetadata | null,
): SafeHtml {
  const uri = `at://${did}/${kind === 'play' ? COLLECTION.play : COLLECTION.rating}/${rkey}`;
  // Render the note via its union `$type` (D-11), not its shape: an unknown future
  // content member falls back to the universal `textContent` instead of being
  // mis-rendered as Markdown. The markdown itself is guarded to a string so a
  // malformed record can't throw inside the sanitizer.
  const markdown =
    value.content?.$type === 'at.markpub.markdown' ? value.content.text?.markdown : undefined;
  const noteHtml =
    typeof markdown === 'string'
      ? raw(renderMarkdown(markdown))
      : value.textContent
        ? html`<p>${value.textContent}</p>`
        : null;
  return html`
    <article class="entry">
      <a class="entry-game" href="${gamePath(value.game.id)}" data-link>
        ${gameCover(value.game.name, meta, 72)}
        <span>${value.game.name}</span>
      </a>
      <p class="mono muted">
        <a href="${profilePath(handle)}" data-link>@${handle}</a>
        ${kind === 'play'
          ? html` played this on ${value.playedAt ? formatDateLong(value.playedAt) : ''}`
          : html` graded this ${value.rating ? gradeBadge(value.rating) : ''}`}
      </p>
      ${kind === 'play' ? playPhotos(value.images, did, true) : ''}
      ${noteHtml ? html`<div class="note">${noteHtml}</div>` : ''}
      <div class="entry-foot">
        <a class="mono small" href="${didEntryPath(did, kind, rkey)}" data-link>permanent link</a>
        ${hasReportableContent(value) ? reportLink(uri) : ''}
      </div>
      <div id="comments"></div>
      ${ctx.state.session ? '' : signInPrompt(ctx, 'Keep your own log of every game you play.')}
    </article>
  `;
}

/** Comments = the companion post's reply thread on the Atmosphere, read-only (D-40 move 5). */
async function loadComments(root: Element, value: EntryValue): Promise<void> {
  const ref = value.bskyPostRef;
  const slot = root.querySelector('#comments');
  if (!ref || !slot) return;
  const thread = await getCommentThread(appview, ref.uri);
  if (!thread) return;
  render(
    slot,
    html`
      <h2 class="section">From the Atmosphere</h2>
      <p class="mono muted small">${thread.likeCount} likes · ${thread.replyCount} replies</p>
      ${thread.comments.map(
        (c) => html`<div class="comment">
          <span class="mono">${c.authorDisplayName ?? `@${c.authorHandle}`}</span>
          <p>${c.text}</p>
        </div>`,
      )}
      <a class="mono small" href="${atmospherePostUrl(ref.uri)}" target="_blank" rel="noopener noreferrer">Reply on the Atmosphere</a>
    `,
  );
}

/* ---- /@handle/g/:bggId ------------------------------------------------------- */

export function userGame(ctx: PageCtx, handle: string, bggId: string): void {
  render(ctx.main, page(html`<div id="ug">${diceLoader()}</div>`));
  const el = ctx.main.querySelector<HTMLElement>('#ug')!;
  void (async () => {
    const doc = await resolveMiniDoc(handle);
    if (!doc) {
      render(el, emptyState({ motif: '🧭', title: "We couldn't find that handle" }));
      return;
    }
    const client = pdsClient(doc.pds);
    const [plays, rating, meta] = await Promise.all([
      listAllPlays(client, doc.did).then((records) => records.filter((r) => r.value.game.id === bggId)),
      getRecordValue<RatingRecord>(client, doc.did, COLLECTION.rating, bggId),
      resolveGame(bggId),
    ]);
    render(
      el,
      html`<h1>@${doc.handle} · ${meta?.name ?? `Game ${bggId}`}</h1>
        <p class="mono muted">${countNoun(timesPlayed(plays.map((r) => r.value), bggId), 'play')}${rating ? html` · graded ${gradeBadge(rating.rating)}` : ''}</p>
        ${plays.map((r) => html`<div class="record mono"><a href="${entryPath(doc.handle, 'play', r.rkey)}" data-link>${formatDate(r.value.playedAt)} · ${relativeTime(r.value.playedAt)}</a></div>`)}`,
    );
  })().catch(() => render(el, loadError()));
}

/* ---- /search ----------------------------------------------------------------- */

export function search(ctx: PageCtx): void {
  render(
    ctx.main,
    page(html`
      <h1>Find a game</h1>
      <form id="search-form" class="search-form">
        <input id="q" class="text-input mono" placeholder="Search by name" autocomplete="off" />
        <button class="pixel-btn is-active" type="submit">Search</button>
      </form>
      <div id="results"></div>
    `),
  );
  const form = ctx.main.querySelector<HTMLFormElement>('#search-form')!;
  const results = ctx.main.querySelector<HTMLElement>('#results')!;
  const initial = new URLSearchParams(location.search).get('q');
  const input = ctx.main.querySelector<HTMLInputElement>('#q')!;
  const run = async (q: string): Promise<void> => {
    if (q.trim().length < 2) return;
    render(results, diceLoader('Searching…'));
    try {
      const games = await searchGames(q);
      render(
        results,
        games.length === 0
          ? emptyState({ title: 'No games found', body: 'Check the spelling, or try a shorter name.' })
          : html`${games.map((g) => html`<a class="record" href="${gamePath(g.id)}" data-link>${g.name}${g.yearPublished ? html` <span class="muted mono">(${g.yearPublished})</span>` : ''}</a>`)}`,
      );
    } catch {
      render(results, errorState({ title: 'Search is unavailable', body: 'Give it another go in a moment.' }));
    }
  };
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    void run(input.value);
  });
  if (initial) {
    input.value = initial;
    void run(initial);
  }
}

/* ---- /settings --------------------------------------------------------------- */

export function settings(ctx: PageCtx): void {
  const session = ctx.state.session;
  if (!session) {
    render(ctx.main, page(signInPrompt(ctx, 'Sign in to manage your account.')));
    return;
  }
  render(
    ctx.main,
    page(html`
      <h1>Settings</h1>
      <div class="panel">
        <p class="mono">Signed in as @${session.handle}</p>
        <button class="pixel-btn" data-action="signout">Sign out</button>
      </div>
      <div class="panel">
        <h2 class="section">Leave rolld</h2>
        <p>
          You can remove your rolld participation. You'll stop showing up in other people's feeds.
          Your plays and ratings stay on your account unless you delete them yourself.
        </p>
        <button class="pixel-btn" data-action="optout">Remove my rolld profile</button>
        <p class="mono small muted" id="optout-status"></p>
      </div>
    `),
  );
  ctx.main.querySelector('[data-action="signout"]')?.addEventListener('click', () => {
    void performSignOut(ctx);
  });
  ctx.main.querySelector('[data-action="optout"]')?.addEventListener('click', () => {
    const status = ctx.main.querySelector<HTMLElement>('#optout-status')!;
    status.textContent = 'Removing…';
    void (async () => {
      try {
        await deleteProfile(session.agent);
        status.textContent = 'Done. Your rolld profile is gone.';
      } catch {
        status.textContent = "That didn't work. Try again in a moment.";
      }
    })();
  });
}

/* ---- /about ------------------------------------------------------------------ */

export function about(ctx: PageCtx): void {
  render(
    ctx.main,
    page(html`
      <article class="prose">
        <h1>About rolld</h1>
        <p>
          rolld is a log of the board games you play, and how you rate them. It's built on
          atproto, the open network behind the Atmosphere, so the games you log live as records on
          your own account, not in a database I keep.
        </p>
        <h2>Your data is yours</h2>
        <p>
          Every play and every grade is a record signed by you, sitting in your own personal data
          server. If rolld disappeared tomorrow, your log would still be there, still readable by
          any other app on the network. I think that's how this kind of thing should work :)
        </p>
        <h2>Almost no server</h2>
        <p>
          There's no big backend here. The social reads (who played what, how many times) come
          from Constellation, a public index of the whole network, so I don't run my own. The one
          piece of server is a small worker that fetches and caches game details from
          BoardGameGeek, which is where the covers and complexity ratings come from.
        </p>
        <h2>Social when your people arrive</h2>
        <p>
          Your plays are public records, so your friends on the Atmosphere can follow along, and you
          can see what they're playing. Until they show up, the log is worth keeping on its own.
        </p>
        <p class="mono muted">
          Game data from BoardGameGeek. Built by
          <a href="https://jeremy.herve.bzh" target="_blank" rel="noopener noreferrer">Jeremy Herve</a>.
        </p>
      </article>
    `),
  );
  void ctx;
}

/* ---- policy pages ------------------------------------------------------------ */

const POLICIES: Record<string, { title: string; body: SafeHtml }> = {
  'community-guidelines': {
    title: 'Community guidelines',
    body: html`
      <p>rolld is a friendly place to track and talk about board games. A few things keep it that way.</p>
      <h2>Be decent</h2>
      <p>No harassment, hate, or threats. No spam. Photos should be about your games, not other people without their okay.</p>
      <h2>Zero tolerance for child sexual abuse material</h2>
      <p>
        CSAM is never allowed. When it's found, the image stops being served immediately and the
        case is reported to the authorities. This is not negotiable.
      </p>
      <h2>How moderation works here</h2>
      <p>
        rolld can't delete records from your account, because they live on your own server, not
        mine. What I can do is stop showing content on rolld. That's what a takedown means here.
      </p>
      <p class="muted">This is a draft and will be finalized before launch.</p>
    `,
  },
  terms: {
    title: 'Terms of service',
    body: html`
      <p>
        rolld is provided as-is, for free, with no guarantees. Your plays and ratings are yours,
        stored on your own atproto account. You're responsible for what you post.
      </p>
      <p>
        I may stop displaying content that breaks the community guidelines. I can't take down what
        lives on your account, only what shows on rolld.
      </p>
      <p class="muted">This is a draft awaiting legal review and isn't legal advice.</p>
    `,
  },
  privacy: {
    title: 'Privacy',
    body: html`
      <p>
        rolld doesn't run a database of your activity. Your plays and ratings live on your own
        atproto account and are public records by design, the same way a post on the Atmosphere is.
      </p>
      <p>
        Game details are fetched and cached from BoardGameGeek. There's no tracking and no ads.
      </p>
      <p class="muted">This is a draft awaiting legal review (GDPR applies) and isn't legal advice.</p>
    `,
  },
};

export function policy(ctx: PageCtx, which: string): void {
  const p = POLICIES[which];
  if (!p) {
    notFound(ctx);
    return;
  }
  render(ctx.main, page(html`<article class="prose"><h1>${p.title}</h1>${p.body}</article>`));
}

/* ---- 404 --------------------------------------------------------------------- */

export function notFound(ctx: PageCtx): void {
  render(
    ctx.main,
    page(
      errorState({
        motif: '🗺️',
        title: "We can't find that page",
        body: 'The link may be wrong, or that page isn\'t here. Head back to the start.',
      }),
    ),
  );
}
