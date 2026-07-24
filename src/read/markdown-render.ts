/**
 * Markdown -> SANITIZED HTML (D-20). Notes are user-authored, so this is the one
 * place vanilla puts XSS responsibility squarely on us - there's no framework
 * default escaping to lean on. The design makes safety the *structural* property,
 * not a cleanup pass:
 *
 *   1. Every piece of text is HTML-escaped FIRST, so any tags the user typed become
 *      inert text - there is no raw-HTML passthrough at all.
 *   2. Only a fixed whitelist of tags is ever emitted (p, headings, strong, em, del,
 *      code, pre, a, ul/ol/li, blockquote, hr, br).
 *   3. Link hrefs are scheme-checked - "javascript:", "data:", etc. are dropped to
 *      plain text; only http(s)/mailto/relative survive, with rel+noopener.
 *
 * The output is a trusted HTML string; callers wrap it with the `html` helper's
 * `raw()` to inject it (the one sanctioned `raw()` for user content). Hard-tested
 * against XSS vectors.
 */
import { escapeHtml } from '../ui/html.js';

/** A url is safe if it has no scheme (relative/anchor) or an http(s)/mailto scheme. */
function safeHref(escapedUrl: string): string | null {
  // Strip ASCII control chars (0x00-0x1F) and DEL, then trim whitespace, BEFORE the
  // scheme test. A browser silently drops a leading control char when it navigates, so
  // "\x01javascript:" would slip a live scheme past the start-anchored regex below (it
  // fails to match because the string starts with a non-letter) and reach the href
  // unchanged. Cleaning first means the scheme allowlist sees the scheme the browser
  // will (D-20; CWE-79).
  const url = escapedUrl.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  const scheme = url.match(/^([a-z][a-z0-9+.-]*):/i);
  if (scheme && !/^(https?|mailto)$/i.test(scheme[1]!)) return null;
  return url;
}

/** Emphasis + links on an escaped, code-free fragment. */
function renderEmphasis(s: string): string {
  let out = s;
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, text: string, url: string) => {
    const href = safeHref(url);
    if (!href) return text;
    return `<a href="${href}" target="_blank" rel="noopener noreferrer nofollow">${text}</a>`;
  });
  out = out.replace(/(\*\*|__)(.+?)\1/g, '<strong>$2</strong>');
  out = out.replace(/(^|[^*_])([*_])(?!\s)(.+?)(?<!\s)\2/g, '$1<em>$3</em>');
  out = out.replace(/~~(.+?)~~/g, '<del>$1</del>');
  return out;
}

/**
 * Inline formatting on already-escaped text. Code spans are split out FIRST and
 * never reprocessed (so backticked text stays literal), then the surrounding
 * fragments get emphasis/links. Splitting (rather than placeholder substitution)
 * sidesteps any chance of a sentinel colliding with the user's text.
 */
function renderInline(escaped: string): string {
  const parts = escaped.split(/`([^`]+)`/g); // even indices = text, odd = code contents
  let out = '';
  for (let i = 0; i < parts.length; i++) {
    out += i % 2 === 1 ? `<code>${parts[i]}</code>` : renderEmphasis(parts[i]!);
  }
  return out;
}

const isBlank = (l: string): boolean => l.trim() === '';
const HR = /^\s*([-*_])(\s*\1){2,}\s*$/;
const HEADING = /^(#{1,6})\s+(.*)$/;
const UL = /^\s*[-*+]\s+(.*)$/;
const OL = /^\s*\d+\.\s+(.*)$/;
const QUOTE = /^\s*>\s?(.*)$/;
const FENCE = /^\s*```/;

const startsBlock = (l: string): boolean =>
  HR.test(l) || HEADING.test(l) || QUOTE.test(l) || UL.test(l) || OL.test(l) || FENCE.test(l);

/** Render a Markdown note to safe HTML. */
export function renderMarkdown(markdown: string): string {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const out: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;
    if (isBlank(line)) {
      i++;
      continue;
    }

    // Fenced code block - escape contents verbatim, no inline processing.
    if (FENCE.test(line)) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !FENCE.test(lines[i]!)) code.push(lines[i++]!);
      i++; // closing fence (or EOF)
      out.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`);
      continue;
    }

    if (HR.test(line)) {
      out.push('<hr>');
      i++;
      continue;
    }

    const heading = line.match(HEADING);
    if (heading) {
      const level = heading[1]!.length;
      out.push(`<h${level}>${renderInline(escapeHtml(heading[2]!.trim()))}</h${level}>`);
      i++;
      continue;
    }

    if (QUOTE.test(line)) {
      const inner: string[] = [];
      while (i < lines.length && QUOTE.test(lines[i]!)) {
        inner.push(lines[i]!.match(QUOTE)![1]!);
        i++;
      }
      out.push(`<blockquote><p>${renderInline(escapeHtml(inner.join(' ')))}</p></blockquote>`);
      continue;
    }

    if (UL.test(line) || OL.test(line)) {
      const ordered = OL.test(line);
      const re = ordered ? OL : UL;
      const items: string[] = [];
      while (i < lines.length && re.test(lines[i]!)) {
        items.push(`<li>${renderInline(escapeHtml(lines[i]!.match(re)![1]!.trim()))}</li>`);
        i++;
      }
      const tag = ordered ? 'ol' : 'ul';
      out.push(`<${tag}>${items.join('')}</${tag}>`);
      continue;
    }

    // Paragraph - collect until a blank line or a block starter; user line breaks kept.
    const para: string[] = [];
    while (i < lines.length && !isBlank(lines[i]!) && !startsBlock(lines[i]!)) {
      para.push(lines[i]!);
      i++;
    }
    const joined = para.map((l) => renderInline(escapeHtml(l))).join('<br>');
    out.push(`<p>${joined}</p>`);
  }

  return out.join('\n');
}
