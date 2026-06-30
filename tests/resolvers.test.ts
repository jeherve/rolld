import { describe, expect, it, vi } from 'vitest';
import type { DidDocumentResolver, HandleResolver } from '@atcute/identity-resolver';
import {
  FallbackDidDocumentResolver,
  FallbackHandleResolver,
  createHandleResolver,
  createPlcResolver,
} from '../src/auth/resolvers.js';

/** A handle resolver that always returns `did`, recording the args it saw. */
const handleOk = (did: string): HandleResolver => ({
  resolve: vi.fn(async () => did as never),
});
const handleFail = (err: Error): HandleResolver => ({
  resolve: vi.fn(async () => {
    throw err;
  }),
});

describe('FallbackHandleResolver (D-51)', () => {
  it('returns the first resolver that succeeds and skips the rest', async () => {
    const second = handleOk('did:plc:second');
    const resolver = new FallbackHandleResolver([handleOk('did:plc:first'), second]);
    expect(await resolver.resolve('a.test' as never)).toBe('did:plc:first');
    expect(second.resolve).not.toHaveBeenCalled();
  });

  it('falls back to the next resolver when an earlier one throws', async () => {
    const resolver = new FallbackHandleResolver([
      handleFail(new Error('slingshot down')),
      handleOk('did:plc:fallback'),
    ]);
    expect(await resolver.resolve('a.test' as never)).toBe('did:plc:fallback');
  });

  it('rethrows the last error when every resolver fails', async () => {
    const resolver = new FallbackHandleResolver([
      handleFail(new Error('first')),
      handleFail(new Error('last')),
    ]);
    await expect(resolver.resolve('a.test' as never)).rejects.toThrow('last');
  });

  it('forwards the handle and options to each resolver', async () => {
    const ok = handleOk('did:plc:x');
    const resolver = new FallbackHandleResolver([handleFail(new Error('x')), ok]);
    const options = { noCache: true };
    await resolver.resolve('a.test' as never, options);
    expect(ok.resolve).toHaveBeenCalledWith('a.test', options);
  });

  it('rejects an empty resolver list', () => {
    expect(() => new FallbackHandleResolver([])).toThrow();
  });
});

const docOk = (id: string): DidDocumentResolver<'plc'> => ({
  resolve: vi.fn(async () => ({ id }) as never),
});
const docFail = (err: Error): DidDocumentResolver<'plc'> => ({
  resolve: vi.fn(async () => {
    throw err;
  }),
});

describe('FallbackDidDocumentResolver (D-51)', () => {
  it('returns the first resolver that succeeds', async () => {
    const resolver = new FallbackDidDocumentResolver([docOk('eurosky'), docOk('canonical')]);
    expect(await resolver.resolve('did:plc:a' as never)).toEqual({ id: 'eurosky' });
  });

  it('falls back to the canonical directory when the mirror fails', async () => {
    const resolver = new FallbackDidDocumentResolver([
      docFail(new Error('mirror lag')),
      docOk('canonical'),
    ]);
    expect(await resolver.resolve('did:plc:a' as never)).toEqual({ id: 'canonical' });
  });

  it('rethrows the last error when every host fails', async () => {
    const resolver = new FallbackDidDocumentResolver([
      docFail(new Error('mirror')),
      docFail(new Error('directory')),
    ]);
    await expect(resolver.resolve('did:plc:a' as never)).rejects.toThrow('directory');
  });

  it('rejects an empty resolver list', () => {
    expect(() => new FallbackDidDocumentResolver([])).toThrow();
  });
});

describe('resolver factories', () => {
  it('build resolvers exposing a resolve() method', () => {
    expect(typeof createHandleResolver().resolve).toBe('function');
    expect(typeof createPlcResolver().resolve).toBe('function');
  });
});
