import { describe, expect, it } from 'vitest';
import { createRouter, matchRoute } from '../src/router/router.js';

const ROUTES = [
  '/',
  '/dashboard',
  '/g/:bggId',
  '/g/:bggId/plays',
  '/@:handle',
  '/@:handle/play/:rkey',
  '/did/:did/play/:rkey',
  '/search',
];

describe('matchRoute', () => {
  it('matches a static route with no params', () => {
    expect(matchRoute(ROUTES, '/dashboard')).toEqual({ pattern: '/dashboard', params: {} });
  });

  it('matches the root route', () => {
    expect(matchRoute(ROUTES, '/')).toEqual({ pattern: '/', params: {} });
  });

  it('captures a single param', () => {
    expect(matchRoute(ROUTES, '/g/224517')).toEqual({
      pattern: '/g/:bggId',
      params: { bggId: '224517' },
    });
  });

  it('captures a param mid-path and the trailing segment', () => {
    expect(matchRoute(ROUTES, '/g/224517/plays')).toEqual({
      pattern: '/g/:bggId/plays',
      params: { bggId: '224517' },
    });
  });

  it('captures a handle from the @-prefixed segment', () => {
    expect(matchRoute(ROUTES, '/@jeremy.herve.bzh')).toEqual({
      pattern: '/@:handle',
      params: { handle: 'jeremy.herve.bzh' },
    });
  });

  it('captures multiple params (the durable did fallback)', () => {
    expect(matchRoute(ROUTES, '/did/did:plc:abc123/play/3kxyz')).toEqual({
      pattern: '/did/:did/play/:rkey',
      params: { did: 'did:plc:abc123', rkey: '3kxyz' },
    });
  });

  it('prefers a static segment over a param at the same position', () => {
    // Order in the table puts /g/:bggId before /g/:bggId/plays; matching must
    // still pick the full-length pattern, not stop at the shorter one.
    expect(matchRoute(ROUTES, '/g/13/plays')?.pattern).toBe('/g/:bggId/plays');
  });

  it('decodes percent-encoded param values', () => {
    expect(matchRoute(ROUTES, '/@a%20b')?.params.handle).toBe('a b');
  });

  it('ignores a query string when matching', () => {
    expect(matchRoute(ROUTES, '/search?q=catan')?.pattern).toBe('/search');
  });

  it('returns null when nothing matches', () => {
    expect(matchRoute(ROUTES, '/nope/nowhere')).toBeNull();
  });

  it('does not match a partial path', () => {
    expect(matchRoute(['/g/:bggId'], '/g/1/extra')).toBeNull();
  });
});

describe('createRouter — the onRender hook', () => {
  const routes = {
    '/dashboard': () => {},
    '/@:handle/play/:rkey': () => {},
  };

  it('reports every rendered path, so page-level chrome can follow (D-61)', () => {
    const seen: string[] = [];
    history.pushState(null, '', '/dashboard');
    const router = createRouter({ routes, notFound: () => {}, onRender: (p) => seen.push(p) });

    router.start();
    router.navigate('/@alice.test/play/3lab');

    expect(seen).toEqual(['/dashboard', '/@alice.test/play/3lab']);
  });

  it('reports unmatched paths too — a 404 renders no record either', () => {
    const seen: string[] = [];
    const router = createRouter({ routes, notFound: () => {}, onRender: (p) => seen.push(p) });
    router.navigate('/nowhere');
    expect(seen).toEqual(['/nowhere']);
  });
});
