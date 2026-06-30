/**
 * The app context passed to every view (Phase 4). Views are render-from-state
 * functions: given the context (the signed-in session, a way to navigate, the live
 * `<main>` mount) and their route params, they paint into `main` — synchronously
 * for the chrome, then asynchronously as data arrives (CC-5).
 */
import type { RolldAgent } from '../atproto/client.js';

export interface SessionInfo {
  agent: RolldAgent;
  did: string;
  handle: string;
  pds: string;
}

export interface AppState {
  session: SessionInfo | null;
}

export interface PageCtx {
  /** The live `<main>` element to render into. */
  readonly main: HTMLElement;
  /** Client-side navigate (pushState + render). */
  navigate(path: string): void;
  /** Replace the current URL without a history entry (used for handle redirects, D-14). */
  replace(path: string): void;
  state: AppState;
  /** Repaint the persistent chrome (header/footer) — e.g. after sign-in/out. */
  refreshChrome(): void;
}
