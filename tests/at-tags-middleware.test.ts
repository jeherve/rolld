import { describe, expect, it, vi } from 'vitest';
import { resolveDid } from '../functions/identity.js';

/**
 * The Pages middleware (D-61) resolves `/@handle/…` to a DID before it can emit an
 * `at:` tag. It can't import `src/read/identity.ts` — that pulls `src/config.ts`,
 * whose `import.meta.env` doesn't exist in the Workers runtime — so it carries its
 * own small resolver, the same way the Worker's feed does. Its failure modes are
 * what matter: an unresolvable handle must yield no tag rather than a guess.
 */

const miniDoc = (body: unknown, ok = true): typeof fetch =>
  vi.fn(async () => new Response(JSON.stringify(body), { status: ok ? 200 : 400 })) as typeof fetch;

describe('resolveDid — handle → DID for the Pages middleware', () => {
  it('returns the DID from a Slingshot MiniDoc', async () => {
    const did = await resolveDid('alice.test', {
      fetchImpl: miniDoc({ did: 'did:plc:abc', handle: 'alice.test', pds: 'https://pds.test' }),
    });
    expect(did).toBe('did:plc:abc');
  });

  it('asks Slingshot for the identifier it was given, url-encoded', async () => {
    const fetchImpl = miniDoc({ did: 'did:plc:abc' });
    await resolveDid('alice.test', { fetchImpl });
    expect(fetchImpl).toHaveBeenCalledWith(
      expect.stringContaining('resolveMiniDoc?identifier=alice.test'),
      expect.anything(),
    );
  });

  it('returns null when Slingshot answers with an error', async () => {
    expect(await resolveDid('ghost.test', { fetchImpl: miniDoc({}, false) })).toBeNull();
  });

  it('returns null when the response carries no DID', async () => {
    expect(await resolveDid('ghost.test', { fetchImpl: miniDoc({ handle: 'ghost.test' }) })).toBeNull();
  });

  it('returns null when the answer is not a syntactically valid DID', async () => {
    expect(await resolveDid('evil.test', { fetchImpl: miniDoc({ did: 'not-a-did' }) })).toBeNull();
  });

  it('returns null when the network fails, instead of throwing into the page render', async () => {
    const boom = vi.fn(async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    expect(await resolveDid('alice.test', { fetchImpl: boom })).toBeNull();
  });
});
