/**
 * Human-facing AppView links — "view / reply on the Atmosphere" (D-51).
 *
 * Centralized so the click-through destination is one swap (Bluesky today,
 * mu/eurosky tomorrow) and no `bsky.app` string is hand-written across the UI.
 * Dependency-free on purpose, so any layer can import it.
 */
import { APPVIEW_WEB } from '../config.js';

/** Profile page for a handle or DID on the configured AppView. */
export function atmosphereProfileUrl(identifier: string): string {
  return `${APPVIEW_WEB}/profile/${identifier}`;
}

/**
 * Web URL for a post, from its `at://<did>/app.bsky.feed.post/<rkey>` URI. Falls
 * back to the AppView root if the URI isn't shaped as expected.
 */
export function atmospherePostUrl(atUri: string): string {
  const [did, , rkey] = atUri.replace('at://', '').split('/');
  if (!did || !rkey) return APPVIEW_WEB;
  return `${APPVIEW_WEB}/profile/${did}/post/${rkey}`;
}
