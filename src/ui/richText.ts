/**
 * Bio rich text (D-57). Bluesky's AppView hands back a profile description as a
 * flat string with no facets, so — like the Bluesky app does on render — rolld
 * detects the facets itself: links, @mentions, and #hashtags, and turns them into
 * anchors. Everything else stays plain, escaped text.
 *
 * Safety: every segment (including the display text of a link) goes through the
 * escaping `html` helper, and only `https?://` URLs are ever linked, so a bio can
 * never smuggle a `javascript:` href or break out of an attribute (D-19/D-20).
 * Mentions link to the person's rolld profile; hashtags to the Atmosphere's tag feed.
 */
import { APPVIEW_WEB } from '../config.js';
import { profilePath } from '../links.js';
import { html, type SafeHtml } from './html.js';

// One pass, three alternatives. A mention/hashtag is only honoured when it sits on
// a word boundary (checked below), so "you@example.com" isn't read as a mention.
const TOKEN_RE = new RegExp(
  '(?<url>https?:\\/\\/[^\\s<]+)' +
    '|(?<mention>@[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?(?:\\.[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?)+)' +
    '|(?<tag>#[A-Za-z_]\\w*)',
  'g',
);

/** Trailing punctuation that shouldn't be swallowed into a URL ("(see foo.com).") */
const TRAILING = /[.,;:!?)\]}'"]+$/;

function displayUrl(url: string): string {
  return url.replace(/^https?:\/\//, '').replace(/\/$/, '');
}

function linkNode(url: string): SafeHtml {
  return html`<a href="${url}" target="_blank" rel="noopener noreferrer nofollow">${displayUrl(url)}</a>`;
}

function mentionNode(mention: string): SafeHtml {
  const handle = mention.slice(1);
  return html`<a href="${profilePath(handle)}" data-link>${mention}</a>`;
}

function tagNode(tag: string): SafeHtml {
  const name = tag.slice(1);
  return html`<a href="${APPVIEW_WEB}/hashtag/${encodeURIComponent(name)}" target="_blank" rel="noopener noreferrer">${tag}</a>`;
}

/**
 * Render a bio string as safe HTML with its links, mentions, and hashtags made
 * interactive. Plain strings pass straight through (escaped). Newlines are kept as
 * text — `.bio` is `white-space: pre-wrap` — so the shape of the bio survives.
 */
export function linkifyBio(text: string): SafeHtml {
  const parts: SafeHtml[] = [];
  let last = 0;
  TOKEN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TOKEN_RE.exec(text)) !== null) {
    const groups = m.groups!;
    const start = m.index;
    // Mentions/tags mid-word (emails, "C#") are not facets — leave them as text.
    if ((groups.mention || groups.tag) && start > 0 && /[A-Za-z0-9]/.test(text[start - 1]!)) {
      continue;
    }
    let matched = m[0];
    if (groups.url) matched = matched.replace(TRAILING, '');
    if (!matched) continue;
    if (start > last) parts.push(html`${text.slice(last, start)}`);
    parts.push(groups.url ? linkNode(matched) : groups.mention ? mentionNode(matched) : tagNode(matched));
    last = start + matched.length;
  }
  if (last < text.length) parts.push(html`${text.slice(last)}`);
  return html`${parts}`;
}
