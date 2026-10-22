/**
 * MCP connections over OAuth with the person directory the API configures
 * itself (the identity-service adapter, not the specs' table): it is checked
 * at boot, and a sign-in it cannot check is a 503 to retry, never a way in and
 * never a silent 500.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type AddressInfo } from 'node:net';
import { bootHarness, initialize, type Harness } from './mcp-harness';
import { startFakeIdentityProvider, type FakeIdentityProvider } from './fake-identity-provider';

let idp: FakeIdentityProvider;
const open: Harness[] = [];
beforeAll(async () => {
  idp = await startFakeIdentityProvider();
});
afterAll(async () => {
  await Promise.all(open.map((h) => h.close()));
  await idp.close();
});

const RESOURCE = 'http://127.0.0.1:4999/mcp';

/** MCP OAuth on, with an identity database at `port` on the loopback host. */
const signedInEnv = (port: number) => ({
  MCP_OAUTH_PROVIDER: 'workos',
  WORKOS_AUTHKIT_DOMAIN: idp.issuer,
  MCP_PUBLIC_URL: RESOURCE,
  IAM_DB_HOST: '127.0.0.1',
  IAM_DB_PORT: String(port),
  IAM_DB_NAME: 'identity',
  IAM_DB_SCHEMA: 'identity_ms',
  IAM_DB_USER: 'reader',
  IAM_DB_PASS: 'spec-password',
});

/** A loopback port nothing listens on: an identity database that is down. */
async function closedPort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const { port } = probe.address() as AddressInfo;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return port;
}

describe('the configured person directory', () => {
  it('boots while the identity database is down, keeps API keys working, and answers a sign-in 503 with a retry', async () => {
    const h = await bootHarness(signedInEnv(await closedPort()));
    open.push(h);

    const res = await h.post(initialize('2025-06-18'), { authorization: `Bearer ${idp.token('user_spec', RESOURCE)}` });
    expect(res.status).toBe(503);
    expect(res.headers.get('retry-after')).toBe('30');
    expect(res.headers.get('www-authenticate')).toBeNull();
    const message = ((await res.json()) as { error: { message: string } }).error.message;
    expect(message).toMatch(/try again/i);
    expect(message).not.toMatch(/127\.0\.0\.1|ECONNREFUSED/);

    const { key } = await h.key();
    expect((await h.post(initialize('2025-06-18'), { authorization: `Bearer ${key}` })).status).toBe(200);
  });

  it('refuses to boot when MCP OAuth is on and the identity database settings are incomplete', async () => {
    await expect(bootHarness({ ...signedInEnv(5432), IAM_DB_PASS: '' })).rejects.toThrow(/Refusing to boot.*IAM_DB_PASS/);
  });
});
