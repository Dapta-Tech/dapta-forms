import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomId } from './random-id';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('randomId', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('is a v4 UUID', () => {
    expect(randomId()).toMatch(UUID_V4);
  });

  it('works without crypto.randomUUID (a non-secure http:// embed)', () => {
    const real = globalThis.crypto;
    vi.stubGlobal('crypto', { getRandomValues: real.getRandomValues.bind(real) });
    const a = randomId();
    const b = randomId();
    expect(a).toMatch(UUID_V4);
    expect(a).not.toBe(b);
  });

  it('works with no crypto at all', () => {
    vi.stubGlobal('crypto', undefined);
    expect(randomId()).toMatch(UUID_V4);
  });
});
