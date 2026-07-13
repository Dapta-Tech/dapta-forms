import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { verifyJwtHs256, signJwtHs256, JwtError, b64url } from './jwt';

const SECRET = 'test-shared-secret-minimum-length-ok';
const ISS = 'example-identity-service';
const AUD = 'calendar-platform';
const NOW = 1_800_000_000_000; // fixed epoch ms
const nowSec = Math.floor(NOW / 1000);

function token(claims: Record<string, unknown>, secret = SECRET): string {
  return signJwtHs256(claims, secret);
}

const base = { sub: 'user_1', account_id: 'acct_1', iss: ISS, aud: AUD, exp: nowSec + 3600 };

describe('verifyJwtHs256', () => {
  it('accepts a valid token and returns its claims', () => {
    const claims = verifyJwtHs256(token(base), { secret: SECRET, issuer: ISS, audience: AUD, now: NOW });
    expect(claims.sub).toBe('user_1');
    expect(claims.account_id).toBe('acct_1');
  });

  it('rejects a wrong signature (secret mismatch)', () => {
    expect(() => verifyJwtHs256(token(base, 'other-secret'), { secret: SECRET, now: NOW })).toThrow(JwtError);
  });

  it('rejects a tampered payload', () => {
    const t = token(base);
    const [h, , s] = t.split('.');
    const forged = `${h}.${b64url(JSON.stringify({ ...base, account_id: 'acct_HACK' }))}.${s}`;
    expect(() => verifyJwtHs256(forged, { secret: SECRET, now: NOW })).toThrow(/signature/i);
  });

  it('rejects alg=none (alg-confusion / unsigned)', () => {
    const header = b64url(JSON.stringify({ alg: 'none', typ: 'JWT' }));
    const payload = b64url(JSON.stringify(base));
    expect(() => verifyJwtHs256(`${header}.${payload}.`, { secret: SECRET, now: NOW })).toThrow(/alg/i);
  });

  it('rejects a non-HS256 alg even with a valid-looking signature', () => {
    const header = b64url(JSON.stringify({ alg: 'HS512', typ: 'JWT' }));
    const payload = b64url(JSON.stringify(base));
    const sig = b64url(createHmac('sha512', SECRET).update(`${header}.${payload}`).digest());
    expect(() => verifyJwtHs256(`${header}.${payload}.${sig}`, { secret: SECRET, now: NOW })).toThrow(/alg/i);
  });

  it('rejects an expired token', () => {
    expect(() =>
      verifyJwtHs256(token({ ...base, exp: nowSec - 1 }), { secret: SECRET, now: NOW }),
    ).toThrow(/expired/i);
  });

  it('honors clock tolerance for a just-expired token', () => {
    const claims = verifyJwtHs256(token({ ...base, exp: nowSec - 5 }), {
      secret: SECRET,
      now: NOW,
      clockToleranceSec: 30,
    });
    expect(claims.sub).toBe('user_1');
  });

  it('rejects a token with no exp', () => {
    const { exp, ...noExp } = base;
    void exp;
    expect(() => verifyJwtHs256(token(noExp), { secret: SECRET, now: NOW })).toThrow(/exp/i);
  });

  it('rejects a not-yet-valid token (nbf)', () => {
    expect(() =>
      verifyJwtHs256(token({ ...base, nbf: nowSec + 60 }), { secret: SECRET, now: NOW }),
    ).toThrow(/not yet/i);
  });

  it('enforces issuer only when configured', () => {
    const bad = token({ ...base, iss: 'someone-else' });
    expect(() => verifyJwtHs256(bad, { secret: SECRET, issuer: ISS, now: NOW })).toThrow(/issuer/i);
    // Not configured → issuer not checked.
    expect(verifyJwtHs256(bad, { secret: SECRET, now: NOW }).sub).toBe('user_1');
  });

  it('enforces audience (string or array) only when configured', () => {
    const bad = token({ ...base, aud: 'wrong' });
    expect(() => verifyJwtHs256(bad, { secret: SECRET, audience: AUD, now: NOW })).toThrow(/audience/i);
    const arr = token({ ...base, aud: ['x', AUD, 'y'] });
    expect(verifyJwtHs256(arr, { secret: SECRET, audience: AUD, now: NOW }).sub).toBe('user_1');
  });

  it('rejects malformed tokens', () => {
    expect(() => verifyJwtHs256('not.a', { secret: SECRET, now: NOW })).toThrow(JwtError);
    expect(() => verifyJwtHs256('a.b.c', { secret: SECRET, now: NOW })).toThrow(JwtError);
  });

  it('requires a secret', () => {
    expect(() => verifyJwtHs256(token(base), { secret: '', now: NOW })).toThrow(/secret/i);
  });
});
