import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomId, randomUuidV7 } from './random-id';

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

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('randomUuidV7', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('is a v7 UUID whose first 48 bits are the epoch milliseconds', () => {
    const now = 1_763_000_000_123;
    const id = randomUuidV7(now);
    expect(id).toMatch(UUID_V7);
    expect(parseInt(id.replace(/-/g, '').slice(0, 12), 16)).toBe(now);
  });

  it('is unique and still works with no crypto at all', () => {
    vi.stubGlobal('crypto', undefined);
    const a = randomUuidV7();
    const b = randomUuidV7();
    expect(a).toMatch(UUID_V7);
    expect(a).not.toBe(b);
  });
});
