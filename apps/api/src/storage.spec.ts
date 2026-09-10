/**
 * The pure half of object storage: how a key is built, and what is safe to put
 * in a Content-Disposition header. Both are security boundaries: the key is
 * what proves an upload belongs to a session, and the header is a place an
 * attacker-supplied filename gets interpolated.
 */
import { describe, it, expect } from 'vitest';
import {
  createObjectStorage,
  extensionOf,
  headerSafeFilename,
  incomingKey,
  storedBasename,
  uploadsPrefixFor,
} from './storage';
import type { ServerEnv } from '@quill/config/env';

describe('incomingKey', () => {
  const args = { accountId: 'acct1', formId: 'form1', sessionId: 'sess1', originalName: 'My CV.pdf' };

  it('scopes the key to account, form and session', () => {
    expect(incomingKey(args).startsWith('incoming/acct1/form1/sess1/')).toBe(true);
  });

  it('keeps the extension but NOT the original filename', () => {
    const key = incomingKey(args);
    expect(key.endsWith('.pdf')).toBe(true);
    // A filename routinely carries a person's name; it belongs in the answer.
    expect(key.toLowerCase()).not.toContain('my cv');
    expect(key.toLowerCase()).not.toContain('my%20cv');
  });

  it('never repeats a key for the same file uploaded twice', () => {
    expect(incomingKey(args)).not.toBe(incomingKey(args));
  });

  it('cannot be walked out of its prefix by a hostile id or filename', () => {
    const key = incomingKey({
      accountId: '../../etc',
      formId: 'a/b',
      sessionId: '../../..',
      originalName: '../../../evil.pdf',
    });
    expect(key.startsWith('incoming/')).toBe(true);
    expect(key).not.toContain('..');
    expect(key.split('/')).toHaveLength(5);
  });
});

describe('uploadsPrefixFor', () => {
  it('is the prefix a deletion sweeps', () => {
    expect(uploadsPrefixFor({ accountId: 'a', formId: 'f', submissionId: 's' })).toBe('uploads/a/f/s');
  });
});

describe('storedBasename', () => {
  it('lowercases the extension so .PDF and .pdf land the same', () => {
    expect(storedBasename('Report.PDF').endsWith('.pdf')).toBe(true);
  });
  it('drops an extension that is not one', () => {
    expect(storedBasename('archive.tar.thisisnotanextension')).not.toContain('.');
  });
  it('survives a file with no extension', () => {
    expect(storedBasename('README')).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('extensionOf', () => {
  it('reads the last extension, lowercased, without the dot', () => {
    expect(extensionOf('a.tar.GZ')).toBe('gz');
    expect(extensionOf('resume.pdf')).toBe('pdf');
  });
  it('is empty when there is none', () => {
    expect(extensionOf('resume')).toBe('');
    expect(extensionOf('.gitignore')).toBe('gitignore');
  });
});

describe('headerSafeFilename', () => {
  it('strips CR/LF so a filename cannot inject a header', () => {
    expect(headerSafeFilename('a.pdf\r\nX-Evil: 1')).toBe('a.pdfX-Evil: 1');
  });
  it('strips quotes and backslashes that would break out of the quoted string', () => {
    expect(headerSafeFilename('a".pdf')).toBe('a.pdf');
    expect(headerSafeFilename('a\\".pdf')).toBe('a.pdf');
  });
  it('flattens path separators', () => {
    expect(headerSafeFilename('../../etc/passwd')).toBe('.._.._etc_passwd');
  });
  it('never returns empty', () => {
    expect(headerSafeFilename('""')).toBe('download');
  });
  it('bounds the length', () => {
    expect(headerSafeFilename('x'.repeat(500))).toHaveLength(120);
  });
});

describe('createObjectStorage', () => {
  const env = (over: Partial<ServerEnv>) =>
    ({
      STORAGE_REGION: 'us-east-2',
      STORAGE_FORCE_PATH_STYLE: false,
      UPLOAD_PRESIGN_TTL_SEC: 600,
      UPLOAD_DOWNLOAD_TTL_SEC: 300,
      ...over,
    }) as ServerEnv;

  it('is disabled with no bucket, which is every bare fork', () => {
    expect(createObjectStorage(env({})).enabled).toBe(false);
  });

  it('turns on from the bucket alone, with no provider set', () => {
    expect(createObjectStorage(env({ STORAGE_BUCKET: 'b' })).enabled).toBe(true);
  });

  it('honors the explicit kill switch even with a bucket configured', () => {
    expect(createObjectStorage(env({ STORAGE_BUCKET: 'b', STORAGE_PROVIDER: 'none' })).enabled).toBe(
      false,
    );
  });

  it('refuses to mint a URL when disabled rather than returning a broken one', async () => {
    await expect(createObjectStorage(env({})).presignPut('k', 'text/plain')).rejects.toThrow(
      /not configured/i,
    );
  });
});
