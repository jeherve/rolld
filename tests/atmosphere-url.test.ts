import { describe, expect, it } from 'vitest';
import { atmosphereProfileUrl, atmospherePostUrl } from '../src/share/atmosphere-url.js';
import { APPVIEW_WEB } from '../src/config.js';

describe('atmosphere-url (D-51)', () => {
  it('builds a profile URL from a handle or DID', () => {
    expect(atmosphereProfileUrl('alice.test')).toBe(`${APPVIEW_WEB}/profile/alice.test`);
    expect(atmosphereProfileUrl('did:plc:abc')).toBe(`${APPVIEW_WEB}/profile/did:plc:abc`);
  });

  it('builds a post URL from an at:// URI', () => {
    const uri = 'at://did:plc:abc/app.bsky.feed.post/3kxyz';
    expect(atmospherePostUrl(uri)).toBe(`${APPVIEW_WEB}/profile/did:plc:abc/post/3kxyz`);
  });

  it('falls back to the AppView root for a malformed URI', () => {
    expect(atmospherePostUrl('not-a-uri')).toBe(APPVIEW_WEB);
    expect(atmospherePostUrl('at://did:plc:abc')).toBe(APPVIEW_WEB);
  });

  it('points at a single configured host, not a hard-coded bsky.app string', () => {
    // The destination is swappable via APPVIEW_WEB; the helper must honor it.
    expect(atmosphereProfileUrl('x').startsWith(APPVIEW_WEB)).toBe(true);
  });
});
