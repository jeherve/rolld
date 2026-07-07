/**
 * Per-user RSS feed generation (D-42), Worker-side. Resolves the user (Slingshot),
 * reads their plays + ratings (their PDS, the same standard `listRecords` the SPA
 * uses), and serializes to RSS, applying the moderation blocklist (don't emit
 * blocked content, D-41). The Worker route caches the result in KV with a short TTL
 * since readers poll. Worker-local (no browser imports) so it stays in the Worker's
 * dependency-free build.
 */
import { safeUpstreamOrigin } from './http.js';
import { type Blocklist, isBlockedDid, isBlockedUri } from './moderation.js';
import { buildRss, type RssItem } from './rss.js';

const ORIGIN = 'https://rolld.at';
const SLINGSHOT = 'https://slingshot.microcosm.blue';

interface ResolvedUser {
  did: string;
  handle: string;
  pds: string;
}

async function resolveUser(identifier: string): Promise<ResolvedUser | null> {
  const res = await fetch(
    `${SLINGSHOT}/xrpc/blue.microcosm.identity.resolveMiniDoc?identifier=${encodeURIComponent(identifier)}`,
  );
  if (!res.ok) return null;
  const d = (await res.json()) as { did?: string; handle?: string; pds?: string };
  // The PDS endpoint is attacker-controllable (the user picks it); validate it so
  // the feed reader can't be turned into an SSRF proxy either (Sec#1).
  const pds = d.pds ? safeUpstreamOrigin(d.pds) : null;
  if (!d.did || !d.handle || !pds) return null;
  return { did: d.did, handle: d.handle, pds };
}

interface RawRecord {
  uri: string;
  value: {
    game?: { name?: string };
    playedAt?: string;
    createdAt?: string;
    rating?: number;
    textContent?: string;
  };
}

async function listRecords(pds: string, did: string, collection: string): Promise<RawRecord[]> {
  const url = `${pds}/xrpc/com.atproto.repo.listRecords?repo=${encodeURIComponent(did)}&collection=${collection}&limit=50`;
  const res = await fetch(url);
  if (!res.ok) return [];
  return ((await res.json()) as { records?: RawRecord[] }).records ?? [];
}

const rkeyOf = (uri: string): string => uri.slice(uri.lastIndexOf('/') + 1);

/** Build a user's RSS feed XML, or null if they can't be resolved / are blocked. */
export async function buildUserFeedXml(
  identifier: string,
  blocklist: Blocklist,
): Promise<string | null> {
  const user = await resolveUser(identifier);
  if (!user || isBlockedDid(blocklist, user.did)) return null;

  const [plays, ratings] = await Promise.all([
    listRecords(user.pds, user.did, 'at.rolld.play'),
    listRecords(user.pds, user.did, 'at.rolld.rating'),
  ]);

  const items: RssItem[] = [];
  for (const rec of plays) {
    if (isBlockedUri(blocklist, rec.uri)) continue;
    const name = rec.value.game?.name ?? 'a game';
    items.push({
      title: `Played ${name}`,
      link: `${ORIGIN}/@${user.handle}/play/${rkeyOf(rec.uri)}`,
      guid: rec.uri,
      isoDate: rec.value.playedAt ?? rec.value.createdAt ?? '',
      ...(rec.value.textContent ? { description: rec.value.textContent } : {}),
    });
  }
  for (const rec of ratings) {
    if (isBlockedUri(blocklist, rec.uri)) continue;
    const name = rec.value.game?.name ?? 'a game';
    items.push({
      title: `Rated ${name} ${rec.value.rating ?? '?'}/10`,
      link: `${ORIGIN}/@${user.handle}/rating/${rkeyOf(rec.uri)}`,
      guid: rec.uri,
      isoDate: rec.value.createdAt ?? '',
      ...(rec.value.textContent ? { description: rec.value.textContent } : {}),
    });
  }
  items.sort((a, b) => b.isoDate.localeCompare(a.isoDate));

  return buildRss({
    title: `${user.handle} on rolld`,
    link: `${ORIGIN}/@${user.handle}`,
    description: `Board game plays and ratings by ${user.handle}`,
    selfUrl: `${ORIGIN}/api/@${user.handle}/feed.xml`,
    items,
  });
}
