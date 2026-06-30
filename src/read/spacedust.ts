/**
 * Spacedust live tail (D-26 — the enhancement layer, added last).
 * Once the dashboard's history has loaded (Slingshot), open a Spacedust websocket
 * subscribed to the play link-source, filtered to the user's followed DIDs, and
 * prepend arriving plays. `instant` is left OFF so Spacedust's 21s buffer drops
 * quickly-undone writes (no flicker). The feed must work WITHOUT this (graceful
 * degradation, D-23) — this only adds the live prepend.
 *
 * v0 caveat: Spacedust has no replay and no delete events, so it's strictly the
 * live tail, never history. The exact event shape is still settling, so the parser
 * is defensive. URL building + parsing are pure (tested); the socket is glue.
 */
import { SPACEDUST_BASE } from '../config.js';
import { SPACEDUST_PLAY_SOURCE } from '../links.js';

export interface SubscribeOptions {
  baseUrl?: string;
  sources?: string[];
  subjectDids?: string[];
  instant?: boolean;
}

/** Build the `wss://…/subscribe?…` URL with repeatable wanted* params. */
export function buildSubscribeUrl(opts: SubscribeOptions = {}): string {
  const base = opts.baseUrl ?? SPACEDUST_BASE;
  const sources = opts.sources ?? [SPACEDUST_PLAY_SOURCE];
  const parts: string[] = [];
  for (const s of sources) parts.push(`wantedSources=${encodeURIComponent(s)}`);
  for (const d of opts.subjectDids ?? []) parts.push(`wantedSubjectDids=${encodeURIComponent(d)}`);
  if (opts.instant) parts.push('instant=true');
  return `${base}/subscribe?${parts.join('&')}`;
}

export interface LiveLink {
  did?: string;
  collection?: string;
  rkey?: string;
  uri?: string;
}

/**
 * Defensively pull a play record's identity out of a Spacedust event. Handles the
 * shapes the v0 stream is likely to use (a `source`/`linking_record` object with
 * did/collection/rkey, or a bare at-uri), returning null for anything else.
 */
export function parseLiveEvent(raw: string): LiveLink | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!data || typeof data !== 'object') return null;
  const obj = data as Record<string, unknown>;
  const source = (obj.source ?? obj.linking_record ?? obj.link ?? obj) as Record<string, unknown>;
  if (typeof source.uri === 'string') return { uri: source.uri };
  if (typeof source.did === 'string' && typeof source.rkey === 'string') {
    return {
      did: source.did,
      collection: typeof source.collection === 'string' ? source.collection : undefined,
      rkey: source.rkey,
    };
  }
  return null;
}

/** Resolve a LiveLink to an at-uri, if it carries enough to build one. */
export function liveLinkUri(link: LiveLink, collection: string): string | null {
  if (link.uri) return link.uri;
  if (link.did && link.rkey) return `at://${link.did}/${link.collection ?? collection}/${link.rkey}`;
  return null;
}

/**
 * Open a Spacedust subscription for new plays by the given DIDs, calling `onPlay`
 * with each new play's at-uri. Returns an unsubscribe function. Fails silently (the
 * feed already works without it).
 */
export function subscribeToPlays(
  subjectDids: string[],
  onPlay: (uri: string) => void,
  opts: SubscribeOptions = {},
): () => void {
  let socket: WebSocket | null = null;
  try {
    socket = new WebSocket(buildSubscribeUrl({ ...opts, subjectDids }));
    socket.addEventListener('message', (event) => {
      const link = parseLiveEvent(typeof event.data === 'string' ? event.data : '');
      const uri = link && liveLinkUri(link, SPACEDUST_PLAY_SOURCE.split(':')[0]!);
      if (uri) onPlay(uri);
    });
  } catch {
    socket = null;
  }
  return () => socket?.close();
}
