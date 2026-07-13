/**
 * Dev-only token minter — mint a host session JWT so a contributor can exercise
 * `AUTH_PROVIDER=workos` locally with NO identity server. It signs with the SAME
 * env the provider validates against (JWT_SECRET / JWT_ISSUER / JWT_AUDIENCE), so
 * a minted token always verifies. This is a convenience for offline dev; against
 * a real deployment you use the token the upstream login issues instead.
 *
 *   pnpm --filter @quill/api auth:mint -- --account acct_123 --sub user_456 \
 *     --email you@example.com --name "You" --ttl 86400
 *
 * Prints the token to stdout. Refuses to run under NODE_ENV=production.
 */
import { loadServerEnv } from '@quill/config/env';
import { signJwtHs256 } from '../jwt';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined;
}

function main(): void {
  // Guard BEFORE loadServerEnv so the message is unambiguous regardless of how
  // AUTH_PROVIDER is set — this is a dev-only convenience, never a prod tool.
  if (process.env.NODE_ENV === 'production') {
    console.error('[auth:mint] refusing to mint tokens under NODE_ENV=production.');
    process.exit(1);
  }
  const env = loadServerEnv();
  if (!env.JWT_SECRET) {
    console.error('[auth:mint] JWT_SECRET is not set. Set it (and optionally JWT_ISSUER/JWT_AUDIENCE) first.');
    process.exit(1);
  }

  const accountId = arg('account') ?? 'acct_dev';
  const sub = arg('sub') ?? 'user_dev';
  const email = arg('email');
  const name = arg('name');
  const ttlSec = Number(arg('ttl') ?? 86400);
  const nowSec = Math.floor(Date.now() / 1000);

  const claims: Record<string, unknown> = {
    sub,
    account_id: accountId,
    iat: nowSec,
    exp: nowSec + (Number.isFinite(ttlSec) ? ttlSec : 86400),
  };
  if (env.JWT_ISSUER) claims.iss = env.JWT_ISSUER;
  if (env.JWT_AUDIENCE) claims.aud = env.JWT_AUDIENCE;
  if (email) claims.email = email;
  if (name) claims.name = name;

  const token = signJwtHs256(claims, env.JWT_SECRET);
  // Token to stdout (pipe-friendly); human notes to stderr.
  console.error(
    `[auth:mint] account_id=${accountId} sub=${sub} exp=+${ttlSec}s` +
      `${env.JWT_ISSUER ? ` iss=${env.JWT_ISSUER}` : ''}${env.JWT_AUDIENCE ? ` aud=${env.JWT_AUDIENCE}` : ''}`,
  );
  console.log(token);
}

main();
