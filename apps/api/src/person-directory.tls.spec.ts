/**
 * TLS to the identity database. With `IAM_DB_SSL_CA` set the adapter verifies
 * the server's certificate against that CA AND that it was issued for the
 * host it dialled (verify-full); unset, it keeps encrypting without checking
 * and says so once at boot.
 *
 * The handshake runs against a stand-in for the database: it answers
 * Postgres' SSLRequest with `S`, completes TLS with a certificate generated
 * here (`openssl`, skipped where it is missing), and counts the handshakes
 * that succeed. Nothing leaves the machine and no key is committed.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type AddressInfo, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TLSSocket } from 'node:tls';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadServerEnv } from '@quill/config/env';
import { createPersonDirectory } from './person-directory';
import { createIamPersonDirectory, iamDirectoryConfig, type IamDirectoryConfig } from './person-directory.iam';

const hasOpenssl = (() => {
  try {
    execFileSync('openssl', ['version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

const OAUTH = {
  MCP_OAUTH_PROVIDER: 'workos',
  WORKOS_AUTHKIT_DOMAIN: 'https://auth.example.test',
  MCP_PUBLIC_URL: 'https://mcp.example.test/mcp',
  IAM_DB_HOST: 'iam-db.example.test',
  IAM_DB_NAME: 'identity',
  IAM_DB_SCHEMA: 'identity_ms',
  IAM_DB_USER: 'reader',
  IAM_DB_PASS: 'spec-password',
};
const env = (over: Record<string, string | undefined> = {}) => loadServerEnv({ ...OAUTH, ...over } as NodeJS.ProcessEnv);

describe.skipIf(!hasOpenssl)('TLS to the identity database', { timeout: 15_000 }, () => {
  let dir: string;
  const pem: Record<string, string> = {};
  const servers: Server[] = [];

  /** A CA, and a server certificate it signs for `host`. */
  function issue(ca: string, name: string, host: string) {
    const o = (file: string) => join(dir, file);
    if (!pem[`${ca}.crt`]) {
      execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', `/CN=${ca}`, '-keyout', o(`${ca}.key`), '-out', o(`${ca}.crt`)], { stdio: 'ignore' });
      pem[`${ca}.crt`] = readFileSync(o(`${ca}.crt`), 'utf8');
    }
    writeFileSync(o(`${name}.ext`), `subjectAltName=DNS:${host}\n`);
    execFileSync('openssl', ['req', '-newkey', 'rsa:2048', '-nodes', '-subj', `/CN=${host}`, '-keyout', o(`${name}.key`), '-out', o(`${name}.csr`)], { stdio: 'ignore' });
    execFileSync(
      'openssl',
      ['x509', '-req', '-in', o(`${name}.csr`), '-CA', o(`${ca}.crt`), '-CAkey', o(`${ca}.key`), '-CAcreateserial', '-days', '1', '-extfile', o(`${name}.ext`), '-out', o(`${name}.crt`)],
      { stdio: 'ignore' },
    );
    pem[`${name}.key`] = readFileSync(o(`${name}.key`), 'utf8');
    pem[`${name}.crt`] = readFileSync(o(`${name}.crt`), 'utf8');
  }

  /** A stand-in database serving `name`'s certificate; `handshakes()` counts the TLS sessions that completed. */
  async function database(name: string) {
    let handshakes = 0;
    const server = createServer((socket) => {
      socket.on('error', () => {});
      // The client's first 8 bytes are the SSLRequest; 'S' accepts it.
      socket.once('data', () => {
        socket.write('S');
        const tls = new TLSSocket(socket, { isServer: true, key: pem[`${name}.key`], cert: pem[`${name}.crt`] });
        tls.on('error', () => {});
        tls.on('secure', () => {
          handshakes += 1;
          tls.destroy();
        });
      });
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    servers.push(server);
    return { port: (server.address() as AddressInfo).port, handshakes: () => handshakes };
  }

  const config = (port: number, ca: string | null): IamDirectoryConfig => ({
    host: 'localhost',
    port,
    database: 'identity',
    schema: 'identity_ms',
    user: 'reader',
    password: 'spec-password',
    tls: true,
    ca,
  });

  /** The error a lookup ends in (every one does: the stand-in hangs up after the handshake). */
  async function lookUp(c: IamDirectoryConfig): Promise<{ code?: string; message: string }> {
    const d = createIamPersonDirectory(c, { queryTimeoutMs: 1_000 });
    try {
      await d.personOf('user_x');
      return { message: 'answered' };
    } catch (error) {
      return error as { code?: string; message: string };
    } finally {
      await d.close().catch(() => undefined);
    }
  }

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'iam-tls-spec-'));
    issue('trusted-ca', 'right-host', 'localhost');
    issue('trusted-ca', 'wrong-host', 'iam-db.other.test');
    issue('stranger-ca', 'stranger', 'localhost');
  });
  afterAll(async () => {
    await Promise.all(servers.map((s) => new Promise<void>((resolve) => s.close(() => resolve()))));
    rmSync(dir, { recursive: true, force: true });
  });

  it('completes the handshake with a certificate the CA signed for the host it dialled', async () => {
    const db = await database('right-host');
    await lookUp(config(db.port, pem['trusted-ca.crt']!));
    // At least one: the client may dial again after the stand-in hangs up.
    expect(db.handshakes()).toBeGreaterThan(0);
  });

  it('refuses a certificate another CA signed', async () => {
    const db = await database('stranger');
    const error = await lookUp(config(db.port, pem['trusted-ca.crt']!));
    expect(db.handshakes()).toBe(0);
    expect(`${error.code} ${error.message}`).toMatch(/SELF_SIGNED|UNABLE_TO_VERIFY|self.signed|unable to verify/i);
  });

  it('refuses a certificate the CA signed for another host', async () => {
    const db = await database('wrong-host');
    const error = await lookUp(config(db.port, pem['trusted-ca.crt']!));
    expect(db.handshakes()).toBe(0);
    expect(`${error.code} ${error.message}`).toMatch(/ALTNAME|altnames|does not match/i);
  });

  it('reads IAM_DB_SSL_CA as the PEM itself or as a path to it, and turns TLS on even on a loopback host', () => {
    const path = join(dir, 'trusted-ca.crt');
    expect(iamDirectoryConfig(env({ IAM_DB_SSL_CA: path }))).toMatchObject({ tls: true, ca: pem['trusted-ca.crt'] });
    expect(iamDirectoryConfig(env({ IAM_DB_SSL_CA: pem['trusted-ca.crt'] }))).toMatchObject({ ca: pem['trusted-ca.crt']!.trim() });
    // A PEM pasted into a one-line variable, with its newlines escaped.
    const oneLine = pem['trusted-ca.crt']!.trim().replace(/\n/g, '\\n');
    expect(iamDirectoryConfig(env({ IAM_DB_SSL_CA: oneLine }))!.ca).toBe(pem['trusted-ca.crt']!.trim());
    expect(iamDirectoryConfig(env({ IAM_DB_SSL_CA: path, IAM_DB_HOST: '127.0.0.1' }))).toMatchObject({ tls: true });
    // Verified: nothing to warn about at boot.
    const lines: string[] = [];
    createPersonDirectory(env({ IAM_DB_SSL_CA: path }), (line) => lines.push(line));
    expect(lines).toEqual([]);
  });

  it.each([
    ['a path that does not exist', '/nonexistent/iam-ca.pem'],
    ['a file that holds no certificate', 'NOT_A_CERT_FILE'],
    ['a value that is neither', 'just some text'],
  ])('refuses to boot with %s', (_name, value) => {
    const v = value === 'NOT_A_CERT_FILE' ? (writeFileSync(join(dir, 'empty.pem'), 'nothing here\n'), join(dir, 'empty.pem')) : value;
    expect(() => createPersonDirectory(env({ IAM_DB_SSL_CA: v }))).toThrow(/Refusing to boot: IAM_DB_SSL_CA/);
  });
});

describe('without IAM_DB_SSL_CA', () => {
  it('keeps encrypting, and says once at boot that the certificate is not verified', () => {
    const lines: string[] = [];
    expect(iamDirectoryConfig(env())).toMatchObject({ tls: true, ca: null });
    createPersonDirectory(env(), (line) => lines.push(line));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/IAM_DB_SSL_CA/);
    expect(lines[0]).toMatch(/not verified/);
  });

  it('says nothing on a loopback host, where there is no TLS', () => {
    const lines: string[] = [];
    createPersonDirectory(env({ IAM_DB_HOST: '127.0.0.1' }), (line) => lines.push(line));
    expect(lines).toEqual([]);
  });
});
