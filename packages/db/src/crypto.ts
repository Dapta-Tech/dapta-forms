/**
 * Symmetric encryption for account-level integration tokens (paste-token model).
 *
 * AES-256-GCM with a random 12-byte IV per message. The stored string is
 * `v1.<iv>.<authTag>.<ciphertext>` (each part base64) so the format is
 * self-describing and versioned for future key rotation. The key is a
 * base64-encoded 32-byte secret supplied by the caller (FORMS_ENCRYPTION_KEY);
 * it never lives in this module. Plaintext tokens never touch disk or the
 * browser — only the ciphertext string returned by `encryptToken` is persisted.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const SCHEME = 'v1';
const IV_BYTES = 12;
const KEY_BYTES = 32;

/** Decode + validate the base64 key. Throws if it is not exactly 32 bytes. */
export function decodeEncryptionKey(base64Key: string): Buffer {
  const key = Buffer.from(base64Key, 'base64');
  if (key.length !== KEY_BYTES) {
    throw new Error(`encryption key must be ${KEY_BYTES} bytes (got ${key.length})`);
  }
  return key;
}

/** True when a usable key is configured (non-empty, correct length). */
export function hasEncryptionKey(base64Key: string | undefined): boolean {
  if (!base64Key) return false;
  try {
    decodeEncryptionKey(base64Key);
    return true;
  } catch {
    return false;
  }
}

/** Encrypt `plaintext` → `v1.<iv>.<tag>.<ciphertext>` (all base64). */
export function encryptToken(plaintext: string, base64Key: string): string {
  const key = decodeEncryptionKey(base64Key);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [SCHEME, iv.toString('base64'), tag.toString('base64'), ciphertext.toString('base64')].join('.');
}

/** Decrypt a `v1.<iv>.<tag>.<ciphertext>` string back to the plaintext token. */
export function decryptToken(encoded: string, base64Key: string): string {
  const key = decodeEncryptionKey(base64Key);
  const parts = encoded.split('.');
  const [scheme, ivB64, tagB64, ctB64] = parts;
  if (parts.length !== 4 || scheme !== SCHEME || !ivB64 || !tagB64 || !ctB64) {
    throw new Error('malformed encrypted token');
  }
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()]);
  return plaintext.toString('utf8');
}

/** Last 4 chars of a token, for a non-secret display hint. */
export function tokenLast4(token: string): string {
  return token.slice(-4);
}
