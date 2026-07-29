import { describe, it, expect } from 'vitest';
import { signValue, unsignValue } from './signed-value';

const SECRET = 'a-test-secret';

describe('signed cookie values', () => {
  it('round-trips a value', () => {
    expect(unsignValue(signValue('account-123', SECRET), SECRET)).toBe('account-123');
  });

  it('rejects a tampered payload', () => {
    const signed = signValue('account-123', SECRET);
    const [, sig] = signed.split('.');
    const forged = `${Buffer.from('account-999').toString('base64url')}.${sig}`;
    expect(unsignValue(forged, SECRET)).toBeNull();
  });

  it('rejects a value with the signature stripped off', () => {
    const [payload] = signValue('account-123', SECRET).split('.');
    expect(unsignValue(payload, SECRET)).toBeNull();
  });

  it('rejects a value signed with a different secret (rotation)', () => {
    expect(unsignValue(signValue('account-123', 'old-secret'), SECRET)).toBeNull();
  });

  it('does not throw on a signature of the wrong LENGTH', () => {
    // timingSafeEqual throws rather than returning false on a length mismatch —
    // a forged cookie must read as absent, never crash the request.
    const [payload] = signValue('account-123', SECRET).split('.');
    expect(() => unsignValue(`${payload}.short`, SECRET)).not.toThrow();
    expect(unsignValue(`${payload}.short`, SECRET)).toBeNull();
  });

  it('reads absent and empty as null', () => {
    expect(unsignValue(undefined, SECRET)).toBeNull();
    expect(unsignValue('', SECRET)).toBeNull();
    expect(unsignValue('.', SECRET)).toBeNull();
  });

  it('round-trips unsigned when no secret is configured (bare OSS fork)', () => {
    // Sound ONLY because the value authorizes nothing: the API re-checks
    // membership against the database before honouring the workspace.
    const v = signValue('account-123', '');
    expect(v).not.toContain('.');
    expect(unsignValue(v, '')).toBe('account-123');
  });
});
