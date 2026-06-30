/**
 * The feed card (Phase 4) — one logged play as seen in a feed or play log. Shows
 * who played, the game, when, who else was there, a note snippet, and any photos.
 * Tapping it opens the entry permalink. The whole card is built from data the
 * caller already has (the play record + a resolved author + optional hydrated game
 * metadata), so it renders immediately and fills the cover when BGG arrives (CC-5).
 */
import type { GameMetadata } from '../bgg/types.js';
import { entryPath } from '../links.js';
import type { PlayRecord } from '../records/types.js';
import { playersSummary, relativeTime, winnerSummary } from './format.js';
import { html, type SafeHtml } from './html.js';
import { avatar, gameCover, playPhotos, reportLink } from './render.js';

export interface FeedAuthor {
  did: string;
  handle: string;
  displayName?: string;
  avatar?: string;
}

export interface FeedCardData {
  play: PlayRecord;
  rkey: string;
  author: FeedAuthor;
  meta?: GameMetadata | null;
  uri: string;
}

function noteSnippet(play: PlayRecord): SafeHtml | null {
  const text = play.textContent?.trim();
  if (!text) return null;
  const snippet = text.length > 200 ? `${text.slice(0, 200)}…` : text;
  return html`<p class="note-snippet">${snippet}</p>`;
}

export function feedCard(data: FeedCardData, now: number = Date.now()): SafeHtml {
  const { play, author, meta, rkey } = data;
  const name = play.game.name;
  const winner = winnerSummary(play);
  const displayName = author.displayName ?? `@${author.handle}`;
  return html`
    <article class="feed-card">
      <div class="fc-head">
        <a class="who" href="/@${author.handle}" data-link>
          ${avatar(author.avatar, displayName, 36)}
          <span class="name">${displayName}</span>
        </a>
        <span class="when mono muted">${relativeTime(play.playedAt, now)}</span>
      </div>
      <a class="fc-game" href="/g/${play.game.id}" data-link>
        ${gameCover(name, meta ?? null, 56)}
        <span class="g-name">${name}${play.game.yearPublished ? html` <span class="muted">(${play.game.yearPublished})</span>` : ''}</span>
      </a>
      <div class="fc-meta mono muted">
        played ${playersSummary(play)}${winner ? html` · ${winner}` : ''}
      </div>
      ${noteSnippet(play)} ${playPhotos(play.images, author.did)}
      <div class="fc-foot">
        <a class="permalink mono" href="${entryPath(author.handle, 'play', rkey)}" data-link>view play</a>
        ${reportLink(data.uri)}
      </div>
    </article>
  `;
}
