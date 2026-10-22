/**
 * The issuer's key set as the MCP OAuth adapter caches it, on a fake clock and
 * a fake fetch: one fetch on a cold start however many requests arrive at
 * once, no second fetch for a key id the set just did not have, a flood of
 * unknown key ids that cannot hold back a key the issuer rotated in, and an
 * issuer that cannot be reached with nothing cached reported as such (a 503
 * at the door), never as a bad token.
 */
import { createSign, generateKeyPairSync, type KeyObject } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { IssuerUnavailable, RemoteJwks, verifyRs256 } from './jwt-rs256';

interface TestKey {
  kid: string;
  privateKey: KeyObject;
  jwk: Record<string, unknown>;
}

function testKey(kid: string): TestKey {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return { kid, privateKey, jwk: { ...publicKey.export({ format: 'jwk' }), kid, alg: 'RS256', use: 'sig' } };
}

const KEY_A = testKey('kid-a');
const KEY_B = testKey('kid-b');

/** A JWKS endpoint over `published`, counting fetches; `down` makes it unreachable; `gate` holds answers until released. */
function issuer(published: TestKey[]) {
  const state = { fetches: 0, down: false, keys: published, gate: null as Promise<void> | null };
  const fetchImpl = (async () => {
    state.fetches += 1;
    if (state.gate) await state.gate;
    if (state.down) throw new TypeError('fetch failed');
    return new Response(JSON.stringify({ keys: state.keys.map((k) => k.jwk) }), { headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { state, fetchImpl };
}

function clock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

const COOLDOWN = 30_000;

describe('RemoteJwks', () => {
  it('fetches once on a cold start, and every request that arrives meanwhile waits for that fetch', async () => {
    const { state, fetchImpl } = issuer([KEY_A]);
    let release!: () => void;
    state.gate = new Promise<void>((r) => (release = r));
    const jwks = new RemoteJwks('https://issuer.example.test/jwks', { fetch: fetchImpl, now: clock().now, refetchCooldownMs: COOLDOWN });
    const pending = Array.from({ length: 5 }, () => jwks.keyFor('kid-a'));
    release();
    const keys = await Promise.all(pending);
    expect(keys.every((k) => k !== null)).toBe(true);
    expect(state.fetches).toBe(1);
  });

  it('does not fetch again for a key id the set it just fetched does not have', async () => {
    const { state, fetchImpl } = issuer([KEY_A]);
    const jwks = new RemoteJwks('https://issuer.example.test/jwks', { fetch: fetchImpl, now: clock().now, refetchCooldownMs: COOLDOWN });
    expect(await jwks.keyFor('kid-unknown')).toBeNull();
    expect(state.fetches).toBe(1);
  });

  it('picks up a rotated key within one cooldown, however many unknown key ids arrive', async () => {
    const { state, fetchImpl } = issuer([KEY_A]);
    const c = clock();
    const jwks = new RemoteJwks('https://issuer.example.test/jwks', { fetch: fetchImpl, now: c.now, refetchCooldownMs: COOLDOWN });
    expect(await jwks.keyFor('kid-a')).not.toBeNull();
    // A flood of junk key ids, one a second, before and after the rotation.
    let rotatedAt = -1;
    let acceptedAt = -1;
    for (let second = 1; second <= 120 && acceptedAt < 0; second += 1) {
      c.advance(1_000);
      await jwks.keyFor(`junk-${second}`);
      if (second === 31) {
        state.keys = [KEY_A, KEY_B];
        rotatedAt = c.now();
      }
      if (rotatedAt > 0 && (await jwks.keyFor('kid-b'))) acceptedAt = c.now();
    }
    expect(acceptedAt).toBeGreaterThan(0);
    expect(acceptedAt - rotatedAt).toBeLessThanOrEqual(COOLDOWN);
    // And the flood itself fetched at most once a cooldown.
    expect(state.fetches).toBeLessThanOrEqual(2 + Math.ceil((acceptedAt - rotatedAt + 31_000) / COOLDOWN));
  });

  it('reports the issuer unreachable while nothing is cached, and keeps serving cached keys through an outage', async () => {
    const { state, fetchImpl } = issuer([KEY_A]);
    state.down = true;
    const c = clock();
    const cold = new RemoteJwks('https://issuer.example.test/jwks', { fetch: fetchImpl, now: c.now, refetchCooldownMs: COOLDOWN });
    await expect(cold.keyFor('kid-a')).rejects.toBeInstanceOf(IssuerUnavailable);

    state.down = false;
    const warm = new RemoteJwks('https://issuer.example.test/jwks', { fetch: fetchImpl, now: c.now, refetchCooldownMs: COOLDOWN, maxAgeMs: 60_000 });
    expect(await warm.keyFor('kid-a')).not.toBeNull();
    state.down = true;
    c.advance(120_000);
    expect(await warm.keyFor('kid-a')).not.toBeNull();
    expect(await warm.keyFor('kid-unknown')).toBeNull();
  });

  it('retries an issuer that is down at most once a short while, not once per request', async () => {
    const { state, fetchImpl } = issuer([KEY_A]);
    state.down = true;
    const c = clock();
    const cold = new RemoteJwks('https://issuer.example.test/jwks', { fetch: fetchImpl, now: c.now, refetchCooldownMs: COOLDOWN });
    for (let i = 0; i < 10; i++) await expect(cold.keyFor('kid-a')).rejects.toBeInstanceOf(IssuerUnavailable);
    expect(state.fetches).toBe(1);

    state.down = false;
    const warm = new RemoteJwks('https://issuer.example.test/jwks', { fetch: fetchImpl, now: c.now, refetchCooldownMs: COOLDOWN, maxAgeMs: 60_000 });
    expect(await warm.keyFor('kid-a')).not.toBeNull();
    state.down = true;
    c.advance(120_000);
    const before = state.fetches;
    for (let i = 0; i < 10; i++) expect(await warm.keyFor(`kid-junk-${i}`)).toBeNull();
    expect(state.fetches - before).toBe(1);
  });
});

describe('verifyRs256', () => {
  const ISSUER = 'https://issuer.example.test';
  const AUDIENCE = 'https://mcp.example.test/mcp';
  const b64 = (v: string | Buffer) => Buffer.from(v).toString('base64url');
  const sign = (header: Record<string, unknown>, claims: Record<string, unknown>) => {
    const input = `${b64(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: KEY_A.kid, ...header }))}.${b64(JSON.stringify(claims))}`;
    return `${input}.${b64(createSign('RSA-SHA256').update(input).sign(KEY_A.privateKey))}`;
  };
  const claims = () => ({ iss: ISSUER, aud: AUDIENCE, sub: 'user_A', exp: Math.floor(Date.now() / 1000) + 600 });
  const options = (keyFor: (kid: string) => Promise<KeyObject | null>) => ({ issuer: ISSUER, audience: AUDIENCE, keyFor });
  const publicA = async () => {
    const { createPublicKey } = await import('node:crypto');
    return createPublicKey({ key: KEY_A.jwk as never, format: 'jwk' });
  };

  it('refuses a token that names critical header extensions it does not understand', async () => {
    const key = await publicA();
    expect(await verifyRs256(sign({}, claims()), options(async () => key))).toMatchObject({ sub: 'user_A' });
    expect(await verifyRs256(sign({ crit: ['exp'] }, claims()), options(async () => key))).toBeNull();
    expect(await verifyRs256(sign({ crit: ['b64'], b64: false }, claims()), options(async () => key))).toBeNull();
  });

  it('lets an unreachable issuer through as such, and is null for anything else that goes wrong', async () => {
    await expect(
      verifyRs256(sign({}, claims()), options(async () => {
        throw new IssuerUnavailable();
      })),
    ).rejects.toBeInstanceOf(IssuerUnavailable);
    expect(
      await verifyRs256(sign({}, claims()), options(async () => {
        throw new Error('boom');
      })),
    ).toBeNull();
  });
});
