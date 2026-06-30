import { describe, expect, it } from 'vitest';
import { buildSubscribeUrl, liveLinkUri, parseLiveEvent } from '../src/read/spacedust.js';

describe('buildSubscribeUrl (D-26)', () => {
  it('subscribes to the play source filtered by followed DIDs, instant off', () => {
    const url = buildSubscribeUrl({ subjectDids: ['did:plc:a', 'did:plc:b'] });
    expect(url).toContain('wss://spacedust.microcosm.blue/subscribe?');
    expect(url).toContain('wantedSources=at.rolld.play%3Atarget');
    expect(url).toContain('wantedSubjectDids=did%3Aplc%3Aa');
    expect(url).toContain('wantedSubjectDids=did%3Aplc%3Ab');
    expect(url).not.toContain('instant');
  });

  it('adds instant=true only when asked', () => {
    expect(buildSubscribeUrl({ instant: true })).toContain('instant=true');
  });
});

describe('parseLiveEvent + liveLinkUri', () => {
  it('reads a did/collection/rkey source', () => {
    const link = parseLiveEvent(
      JSON.stringify({ source: { did: 'did:plc:x', collection: 'at.rolld.play', rkey: '3k' } }),
    );
    expect(link).toEqual({ did: 'did:plc:x', collection: 'at.rolld.play', rkey: '3k' });
    expect(liveLinkUri(link!, 'at.rolld.play')).toBe('at://did:plc:x/at.rolld.play/3k');
  });

  it('reads a bare at-uri', () => {
    const link = parseLiveEvent(JSON.stringify({ uri: 'at://did:plc:x/at.rolld.play/3k' }));
    expect(liveLinkUri(link!, 'at.rolld.play')).toBe('at://did:plc:x/at.rolld.play/3k');
  });

  it('falls back to the default collection when the event omits it', () => {
    const link = parseLiveEvent(JSON.stringify({ did: 'did:plc:x', rkey: '3k' }));
    expect(liveLinkUri(link!, 'at.rolld.play')).toBe('at://did:plc:x/at.rolld.play/3k');
  });

  it('returns null for malformed JSON or unusable events', () => {
    expect(parseLiveEvent('not json')).toBeNull();
    expect(parseLiveEvent(JSON.stringify({ nothing: true }))).toBeNull();
  });
});
