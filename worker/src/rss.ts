/**
 * Per-user RSS feed serialization (D-42). RSS needs a server response a static SPA
 * can't give, so the Worker generates it: a fourth open lens on data the user
 * already owns (alongside the page, the records, and the Bluesky post), letting
 * people follow someone's plays without an atproto account or a rolld login. Pure
 * serialization — the Worker route does the reads and caches the result in KV.
 */

// XML 1.0 forbids most C0 control characters outright (only tab, LF and CR are
// legal). A note carrying e.g. a form-feed would otherwise pass through verbatim
// and make the WHOLE feed document ill-formed — every subscriber's reader fails to
// parse it, not just the offending item. Strip the illegal ones before escaping.
const ILLEGAL_XML = /[\x00-\x08\x0B\x0C\x0E-\x1F]/g;

function xmlEscape(text: string): string {
  return text
    .replace(ILLEGAL_XML, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * ISO 8601 → RFC 822 date (what RSS `pubDate` wants). Deterministic for a given
 * input. Returns '' for an unparseable date so the caller can omit `<pubDate>`
 * rather than emit a literal "Invalid Date" (which breaks the feed).
 */
export function toRfc822(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : date.toUTCString();
}

export interface RssItem {
  title: string;
  link: string;
  guid: string;
  /** ISO 8601; serialized to RFC 822. */
  isoDate: string;
  description?: string;
}

export interface RssChannel {
  title: string;
  link: string;
  description: string;
  /** Absolute URL of the feed itself, for the atom:self link. */
  selfUrl?: string;
  items: RssItem[];
}

/** Serialize a channel to an RSS 2.0 document. */
export function buildRss(channel: RssChannel): string {
  const items = channel.items
    .map((item) => {
      const desc = item.description
        ? `\n      <description>${xmlEscape(item.description)}</description>`
        : '';
      const rfc822 = toRfc822(item.isoDate);
      const pubDate = rfc822 ? `\n      <pubDate>${rfc822}</pubDate>` : '';
      return `    <item>
      <title>${xmlEscape(item.title)}</title>
      <link>${xmlEscape(item.link)}</link>
      <guid isPermaLink="false">${xmlEscape(item.guid)}</guid>${pubDate}${desc}
    </item>`;
    })
    .join('\n');
  const self = channel.selfUrl
    ? `\n    <atom:link href="${xmlEscape(channel.selfUrl)}" rel="self" type="application/rss+xml"/>`
    : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${xmlEscape(channel.title)}</title>
    <link>${xmlEscape(channel.link)}</link>
    <description>${xmlEscape(channel.description)}</description>${self}
${items}
  </channel>
</rss>`;
}
