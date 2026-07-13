import { generateManageToken, hashManageToken, verifyManageToken } from './manage-token';

describe('manage-token', () => {
  it('mints a 256-bit URL-safe token with its SHA-256 hash', () => {
    const { token, tokenHash } = generateManageToken();
    // base64url of 32 bytes → 43 chars, no padding, URL-safe alphabet.
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    // SHA-256 hex is 64 chars.
    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(tokenHash).toBe(hashManageToken(token));
  });

  it('mints distinct tokens each call (high entropy)', () => {
    const a = generateManageToken();
    const b = generateManageToken();
    expect(a.token).not.toBe(b.token);
    expect(a.tokenHash).not.toBe(b.tokenHash);
  });

  it('verifies a correct token and rejects a wrong one', () => {
    const { token, tokenHash } = generateManageToken();
    expect(verifyManageToken(token, tokenHash)).toBe(true);
    expect(verifyManageToken(token + 'x', tokenHash)).toBe(false);
    expect(verifyManageToken(generateManageToken().token, tokenHash)).toBe(false);
  });

  it('rejects empty/nullish inputs and malformed hashes safely', () => {
    const { token } = generateManageToken();
    expect(verifyManageToken('', 'ab'.repeat(32))).toBe(false);
    expect(verifyManageToken(token, null)).toBe(false);
    expect(verifyManageToken(token, undefined)).toBe(false);
    expect(verifyManageToken(token, '')).toBe(false);
    expect(verifyManageToken(token, 'not-hex-zz')).toBe(false);
  });

  it('rotation invalidates the previous token (single active)', () => {
    const first = generateManageToken();
    const second = generateManageToken(); // stored hash overwritten on reschedule
    expect(verifyManageToken(first.token, second.tokenHash)).toBe(false);
    expect(verifyManageToken(second.token, second.tokenHash)).toBe(true);
  });
});
