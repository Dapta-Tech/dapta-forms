/**
 * The API key format (public API v1) and the few pure helpers every key path
 * shares: minting a key, hashing it, reading it off a request, and naming how a
 * principal got in for the created-via column and the product metric.
 *
 * A key is `dforms_` plus 32 random bytes in base64url. Only its SHA-256 (hex)
 * is stored, with the first 12 characters (`prefix`) and the last 4 (`last4`);
 * the key in clear exists once, in the response that created it.
 */
import { createHash, randomBytes } from 'node:crypto';
import { header, isAgentPrincipal, isApiKeyPrincipal, type HostPrincipal, type ReqLike } from './auth.provider';

/** Every key starts with this, which is also how a request is told apart from a session bearer. */
export const API_KEY_PREFIX = 'dforms_';

/** The SHA-256 of a key, in hex: the only form of it the database ever holds. */
export function hashApiKey(key: string): string {
  return createHash('sha256').update(key, 'utf8').digest('hex');
}

/** A freshly minted key and what gets stored for it. */
export interface MintedApiKey {
  key: string;
  keyHash: string;
  prefix: string;
  last4: string;
}

export function generateApiKey(): MintedApiKey {
  const key = `${API_KEY_PREFIX}${randomBytes(32).toString('base64url')}`;
  return { key, keyHash: hashApiKey(key), prefix: key.slice(0, 12), last4: key.slice(-4) };
}

/**
 * The API key a request carries as `Authorization: Bearer dforms_...`, or null
 * when it carries none. A bearer without the prefix is a session token and is
 * left to the AuthProvider exactly as before.
 */
export function apiKeyFromRequest(req: ReqLike): string | null {
  const value = header(req, 'authorization')?.trim();
  if (!value) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(value);
  const token = match?.[1];
  return token && token.startsWith(API_KEY_PREFIX) ? token : null;
}

/**
 * How a principal creates things, for `form.created_via` and the `via`
 * property of the product events: `api` with an API key over REST, `mcp`
 * through the MCP endpoint (an API key or an MCP connection), `web` with a
 * session (the dashboard and the onboarding).
 */
export function createdVia(p: Pick<HostPrincipal, 'via' | 'channel'>): 'api' | 'mcp' | 'web' {
  if (!isAgentPrincipal(p)) return 'web';
  if (!isApiKeyPrincipal(p)) return 'mcp';
  return p.channel === 'mcp' ? 'mcp' : 'api';
}
