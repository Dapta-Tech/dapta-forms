/**
 * The permanent file link token: what it accepts, and everything it refuses.
 *
 * The token is the only authorization the public file route has, so the
 * refusals matter more than the round trip: a tampered byte anywhere, a token
 * signed under another key, framing junk and oversize input must all come back
 * as the same null.
 */
import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import {
  FILE_LINK_MAX_TOKEN_LENGTH,
  fileLinkKey,
  fileLinkUrl,
  fileLinksFor,
  signFileToken,
  tokenPrefix,
  verifyFileToken,
} from './file-link';

const ENCRYPTION_KEY = randomBytes(32).toString('base64');
const KEY = fileLinkKey({ FORMS_ENCRYPTION_KEY: ENCRYPTION_KEY })!;
const SUB = '6f1c2a54-8a0e-4f43-9c1d-2b7f0f3e9a11';

/** Flip one character of a base64url segment to another valid one. */
function flip(segment: string, at = 0): string {
  const c = segment[at]!;
  return segment.slice(0, at) + (c === 'A' ? 'B' : 'A') + segment.slice(at + 1);
}

describe('fileLinkKey', () => {
  it('derives a 32-byte key from FORMS_ENCRYPTION_KEY, never the raw key itself', () => {
    expect(KEY).toHaveLength(32);
    expect(KEY.equals(Buffer.from(ENCRYPTION_KEY, 'base64'))).toBe(false);
    // Deterministic: the same env signs the same links across restarts.
    expect(fileLinkKey({ FORMS_ENCRYPTION_KEY: ENCRYPTION_KEY })!.equals(KEY)).toBe(true);
  });

  it('prefers FILE_LINK_SECRET when it is set', () => {
    const secret = 'a-dedicated-secret-of-at-least-32-chars!';
    const k = fileLinkKey({ FILE_LINK_SECRET: secret, FORMS_ENCRYPTION_KEY: ENCRYPTION_KEY })!;
    expect(k.equals(KEY)).toBe(false);
    expect(k.equals(fileLinkKey({ FILE_LINK_SECRET: secret })!)).toBe(true);
  });

  it('is null with nothing to derive from, so the feature degrades instead of failing', () => {
    expect(fileLinkKey(undefined)).toBeNull();
    expect(fileLinkKey({})).toBeNull();
    expect(fileLinkKey({ FILE_LINK_SECRET: '', FORMS_ENCRYPTION_KEY: '' })).toBeNull();
    expect(fileLinkKey({ FILE_LINK_SECRET: '   ' })).toBeNull();
    // A malformed encryption key is not silently used as something else.
    expect(fileLinkKey({ FORMS_ENCRYPTION_KEY: 'not-32-bytes' })).toBeNull();
  });
});

describe('signFileToken / verifyFileToken', () => {
  it('round-trips the submission id and step key', () => {
    const token = signFileToken(KEY, SUB, 'cv')!;
    expect(token.startsWith('v1.')).toBe(true);
    expect(token).toMatch(/^[A-Za-z0-9._-]+$/);
    expect(verifyFileToken(KEY, token)).toEqual({ submissionId: SUB, stepKey: 'cv' });
  });

  it('stays compact for the longest step key a form allows', () => {
    const token = signFileToken(KEY, SUB, 'k'.repeat(64))!;
    expect(token.length).toBeLessThan(200);
    expect(verifyFileToken(KEY, token)).toEqual({ submissionId: SUB, stepKey: 'k'.repeat(64) });
  });

  it('rejects a tampered signature', () => {
    const [v, p, s] = signFileToken(KEY, SUB, 'cv')!.split('.') as [string, string, string];
    expect(verifyFileToken(KEY, `${v}.${p}.${flip(s)}`)).toBeNull();
    expect(verifyFileToken(KEY, `${v}.${p}.${s.slice(0, -2)}`)).toBeNull();
    expect(verifyFileToken(KEY, `${v}.${p}.`)).toBeNull();
  });

  it('rejects a tampered payload, including one that points at another submission', () => {
    const token = signFileToken(KEY, SUB, 'cv')!;
    const [v, p, s] = token.split('.') as [string, string, string];
    expect(verifyFileToken(KEY, `${v}.${flip(p, 3)}.${s}`)).toBeNull();
    const other = Buffer.from(`other-submission\ncv`).toString('base64url');
    expect(verifyFileToken(KEY, `${v}.${other}.${s}`)).toBeNull();
  });

  it('rejects a token signed with another key (a rotated key revokes every link)', () => {
    const otherKey = fileLinkKey({ FORMS_ENCRYPTION_KEY: randomBytes(32).toString('base64') })!;
    expect(verifyFileToken(otherKey, signFileToken(KEY, SUB, 'cv')!)).toBeNull();
  });

  it('rejects another version label, even with a valid signature over it', () => {
    const [, p, s] = signFileToken(KEY, SUB, 'cv')!.split('.') as [string, string, string];
    expect(verifyFileToken(KEY, `v2.${p}.${s}`)).toBeNull();
  });

  it('rejects garbage without throwing', () => {
    for (const junk of [
      '',
      'v1',
      'v1..',
      'v1.abc',
      'v1.a.b.c',
      '...',
      'not a token',
      'v1.%%%.%%%',
      'v1.YQ.YQ==',
      null,
      undefined,
      42,
      {},
    ]) {
      expect(verifyFileToken(KEY, junk), String(junk)).toBeNull();
    }
  });

  it('rejects a non-canonical encoding of a valid signature', () => {
    // Node decodes base64url leniently; a token must be the one exact string.
    // A 32-byte MAC is 43 characters carrying 258 bits, so the last character
    // has two padding bits: flipping one decodes to the very same bytes.
    const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    const token = signFileToken(KEY, SUB, 'cv')!;
    const last = token[token.length - 1]!;
    const twin = token.slice(0, -1) + ALPHABET[ALPHABET.indexOf(last) ^ 1];
    const sig = (t: string) => Buffer.from(t.split('.')[2]!, 'base64url');
    expect(sig(twin).equals(sig(token))).toBe(true);
    expect(verifyFileToken(KEY, twin)).toBeNull();
    expect(verifyFileToken(KEY, `${token}=`)).toBeNull();
  });

  it('rejects oversize input before decoding it', () => {
    const big = `v1.${'A'.repeat(FILE_LINK_MAX_TOKEN_LENGTH)}.${'A'.repeat(43)}`;
    expect(verifyFileToken(KEY, big)).toBeNull();
    // And never mints a token it would itself refuse.
    expect(signFileToken(KEY, SUB, 'k'.repeat(FILE_LINK_MAX_TOKEN_LENGTH))).toBeNull();
  });

  it('refuses to sign a field that would break the framing', () => {
    expect(signFileToken(KEY, '', 'cv')).toBeNull();
    expect(signFileToken(KEY, SUB, '')).toBeNull();
    expect(signFileToken(KEY, `${SUB}\nx`, 'cv')).toBeNull();
    expect(signFileToken(KEY, SUB, 'cv\nx')).toBeNull();
  });
});

describe('fileLinkUrl / tokenPrefix', () => {
  it('builds the link on the web host, with or without a trailing slash', () => {
    expect(fileLinkUrl('https://forms.example.com', 'v1.a.b')).toBe('https://forms.example.com/file/v1.a.b');
    expect(fileLinkUrl('https://forms.example.com/', 'v1.a.b')).toBe('https://forms.example.com/file/v1.a.b');
  });

  it('never yields the whole token for a log line', () => {
    const token = signFileToken(KEY, SUB, 'cv')!;
    expect(tokenPrefix(token).length).toBeLessThan(token.length);
    expect(tokenPrefix(token)).not.toContain(token.split('.')[2]);
  });
});

describe('fileLinksFor', () => {
  const ENV = { PUBLIC_APP_URL: 'https://forms.example.com', FORMS_ENCRYPTION_KEY: ENCRYPTION_KEY };
  const FILE = { key: 'uploads/a/f/s/1.pdf', name: 'cv.pdf', size: '10', mime: 'application/pdf' };

  it('links every file answer and nothing else', () => {
    const links = fileLinksFor(ENV, SUB, {
      cv: FILE,
      portfolio: { ...FILE, name: 'work.zip' },
      email: 'ada@example.com',
      utm: { utm_source: 'news' },
      choices: ['a', 'b'],
    })!;
    expect(Object.keys(links).sort()).toEqual(['cv', 'portfolio']);
    const token = links.cv!.replace('https://forms.example.com/file/', '');
    expect(verifyFileToken(KEY, token)).toEqual({ submissionId: SUB, stepKey: 'cv' });
  });

  it('is undefined without a public web host, rather than a broken link', () => {
    expect(fileLinksFor({ ...ENV, PUBLIC_APP_URL: '' }, SUB, { cv: FILE })).toBeUndefined();
  });

  it('is undefined without a key to sign with', () => {
    expect(fileLinksFor({ PUBLIC_APP_URL: ENV.PUBLIC_APP_URL }, SUB, { cv: FILE })).toBeUndefined();
    expect(fileLinksFor(undefined, SUB, { cv: FILE })).toBeUndefined();
  });

  it('is undefined when there is no file answer at all', () => {
    expect(fileLinksFor(ENV, SUB, { email: 'ada@example.com' })).toBeUndefined();
  });
});
