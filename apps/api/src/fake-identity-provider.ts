import { createSign, generateKeyPairSync, randomUUID, type KeyObject } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * A stand-in for the hosted identity provider, for the MCP OAuth specs: an
 * RSA key pair generated in the test, served as the issuer's JWKS at the path
 * the hosted provider uses, plus the authorization-server metadata and a token
 * endpoint (client credentials) so the official MCP client can discover and
 * complete a login over HTTP. Loopback only; nothing leaves the machine.
 */
export interface FakeIdentityProvider {
  /** The issuer: `http://127.0.0.1:<port>`. */
  issuer: string;
  /** How many times the JWKS was fetched. */
  jwksFetches(): number;
  /** Sign `claims` as the issuer (RS256, current key), exactly as given. */
  sign(claims: Record<string, unknown>, header?: Record<string, unknown>): string;
  /** A token for `subject` with the usual claims (`iss`, `aud`, `sub`, `iat`, `exp` in an hour), `over` applied last. */
  token(subject: string, audience: string, over?: Record<string, unknown>): string;
  /** Sign with a key the JWKS does not publish, under the published key id. */
  forge(claims: Record<string, unknown>): string;
  /** Register a client the token endpoint accepts; its tokens name `subject`. */
  client(subject: string): { clientId: string; clientSecret: string };
  /** Publish a new key (and keep the old one) and sign with it from now on. */
  rotate(): void;
  close(): Promise<void>;
}

interface Key {
  kid: string;
  privateKey: KeyObject;
  jwk: Record<string, unknown>;
}

function newKey(): Key {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const kid = `kid-${randomUUID().slice(0, 8)}`;
  return { kid, privateKey, jwk: { ...publicKey.export({ format: 'jwk' }), kid, alg: 'RS256', use: 'sig' } };
}

const b64url = (value: Buffer | string): string => Buffer.from(value).toString('base64url');

function signWith(key: KeyObject, header: Record<string, unknown>, claims: Record<string, unknown>): string {
  const input = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claims))}`;
  const signature = createSign('RSA-SHA256').update(input).sign(key);
  return `${input}.${b64url(signature)}`;
}

export async function startFakeIdentityProvider(): Promise<FakeIdentityProvider> {
  const keys: Key[] = [newKey()];
  const stranger = newKey();
  const clients = new Map<string, { secret: string; subject: string }>();
  let fetches = 0;
  let issuer = '';

  const current = () => keys[keys.length - 1]!;
  const sign = (claims: Record<string, unknown>, header: Record<string, unknown> = {}) =>
    signWith(current().privateKey, { alg: 'RS256', typ: 'JWT', kid: current().kid, ...header }, claims);
  const token = (subject: string, audience: string, over: Record<string, unknown> = {}) => {
    const now = Math.floor(Date.now() / 1000);
    return sign({ iss: issuer, aud: audience, sub: subject, iat: now, exp: now + 3600, ...over });
  };

  const http: Server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://idp.invalid');
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (req.method === 'GET' && url.pathname === '/oauth2/jwks') {
      fetches += 1;
      return json(200, { keys: keys.map((k) => k.jwk) });
    }
    if (req.method === 'GET' && url.pathname === '/.well-known/oauth-authorization-server') {
      return json(200, {
        issuer,
        token_endpoint: `${issuer}/oauth2/token`,
        authorization_endpoint: `${issuer}/oauth2/authorize`,
        jwks_uri: `${issuer}/oauth2/jwks`,
        grant_types_supported: ['authorization_code', 'refresh_token', 'client_credentials'],
        token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'],
        response_types_supported: ['code'],
        code_challenge_methods_supported: ['S256'],
      });
    }
    if (req.method === 'POST' && url.pathname === '/oauth2/token') {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        const form = new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
        const header = req.headers.authorization ?? '';
        const basic = header.slice(0, 6).toLowerCase() === 'basic ' ? header.slice(6).trim() || undefined : undefined;
        const [id, secret] = basic
          ? Buffer.from(basic, 'base64').toString('utf8').split(':').map((p) => decodeURIComponent(p))
          : [form.get('client_id') ?? '', form.get('client_secret') ?? ''];
        const client = clients.get(id ?? '');
        if (!client || client.secret !== secret) return json(401, { error: 'invalid_client' });
        if (form.get('grant_type') !== 'client_credentials') return json(400, { error: 'unsupported_grant_type' });
        // RFC 8707: the token is for the resource the client names, as the hosted provider issues them.
        const resource = form.get('resource');
        if (!resource) return json(400, { error: 'invalid_target' });
        return json(200, { access_token: token(client.subject, resource), token_type: 'Bearer', expires_in: 3600 });
      });
      return;
    }
    json(404, { error: 'not_found' });
  });
  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
  issuer = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;

  return {
    issuer,
    jwksFetches: () => fetches,
    sign,
    token,
    forge: (claims) => signWith(stranger.privateKey, { alg: 'RS256', typ: 'JWT', kid: current().kid }, claims),
    client(subject) {
      const clientId = `client_${randomUUID().slice(0, 8)}`;
      const clientSecret = randomUUID();
      clients.set(clientId, { secret: clientSecret, subject });
      return { clientId, clientSecret };
    },
    rotate() {
      keys.push(newKey());
    },
    close: () => new Promise<void>((resolve) => http.close(() => resolve())),
  };
}
