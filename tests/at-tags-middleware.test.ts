import { describe, expect, it, vi } from 'vitest';
import { resolveIdentity } from '../functions/identity.js';

/**
 * The Pages middleware (D-61, D-62) resolves `/@handle/…` to a DID before it can emit
 * an `at:` tag, and needs the author's PDS before it can read the record behind a
 * title. It can't import `src/read/identity.ts` — that pulls `src/config.ts`, whose
 * `import.meta.env` doesn't exist in the Workers runtime — so it carries its own small
 * resolver, the same way the Worker's feed does. Its failure modes are what matter: an
 * unresolvable handle must yield no tag rather than a guess, and the PDS endpoint is
 * user-chosen, so it must never point the edge at something it shouldn't fetch (Sec#1).
 */

const answer = (body: unknown, ok = true): typeof fetch =>
  vi.fn(async () => new Response(JSON.stringify(body), { status: ok ? 200 : 400 })) as typeof fetch;

const good = { did: 'did:plc:abc', handle: 'alice.test', pds: 'https://pds.example.com' };

describe('resolveIdentity — handle → DID + verified handle + PDS', () => {
  it('returns the whole MiniDoc when Slingshot answers', async () => {
    expect(await resolveIdentity('alice.test', { fetchImpl: answer(good) })).toEqual({
      did: 'did:plc:abc',
      handle: 'alice.test',
      pds: 'https://pds.example.com',
    });
  });

  it('asks Slingshot for the identifier it was given, url-encoded', async () => {
    const fetchImpl = answer(good);
    await resolveIdentity('alice.test', { fetchImpl });
    expect(fetchImpl).toHaveBeenCalledWith(
      expect.stringContaining('resolveMiniDoc?identifier=alice.test'),
      expect.anything(),
    );
  });

  it('returns null when Slingshot answers with an error', async () => {
    expect(await resolveIdentity('ghost.test', { fetchImpl: answer({}, false) })).toBeNull();
  });

  it('returns null when the response carries no DID', async () => {
    expect(await resolveIdentity('ghost.test', { fetchImpl: answer({ handle: 'ghost.test' }) })).toBeNull();
  });

  it('returns null when the answer is not a syntactically valid DID', async () => {
    expect(await resolveIdentity('evil.test', { fetchImpl: answer({ ...good, did: 'nope' }) })).toBeNull();
  });

  it('returns null when the network fails, instead of throwing into the page render', async () => {
    const boom = vi.fn(async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    expect(await resolveIdentity('alice.test', { fetchImpl: boom })).toBeNull();
  });

  it('keeps the DID even when the PDS endpoint is unusable — the tags still work', async () => {
    const doc = await resolveIdentity('alice.test', {
      fetchImpl: answer({ ...good, pds: 'http://pds.example.com' }),
    });
    expect(doc?.did).toBe('did:plc:abc');
    expect(doc?.pds).toBeUndefined();
  });

  it('refuses a PDS the edge has no business fetching (Sec#1)', async () => {
    const unsafe = [
      'http://pds.example.com', // not https
      'https://127.0.0.1', // IP literal
      'https://localhost', // single-label host
      'https://pds.example.com:8080', // explicit non-443 port
      'not a url',
    ];
    for (const pds of unsafe) {
      const doc = await resolveIdentity('alice.test', { fetchImpl: answer({ ...good, pds }) });
      expect(doc?.pds, pds).toBeUndefined();
    }
  });

  it('strips any path or query the endpoint tucked into itself', async () => {
    const doc = await resolveIdentity('alice.test', {
      fetchImpl: answer({ ...good, pds: 'https://pds.example.com/sneaky?x=1' }),
    });
    expect(doc?.pds).toBe('https://pds.example.com');
  });
});
