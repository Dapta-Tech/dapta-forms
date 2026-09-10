/**
 * The `file` question type, server side: mint an upload URL, then prove on
 * submit that the thing the client points at is what it said it was.
 *
 * The split matters. `presign` runs before any bytes exist and can only check
 * CLAIMS: a name, a size, a mime the browser typed. `verify` runs after the
 * upload and checks the object itself. Neither is sufficient alone: signing
 * without checking hands an anonymous client a write token for arbitrary
 * content, and checking without signing means the file had to travel through
 * this process to get here, which is the thing the presigned flow exists to
 * avoid.
 *
 * Everything here fails closed. With no bucket configured the deployment has no
 * file question at all, and both entry points say so rather than half-working.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { fileTypeFromBuffer } from 'file-type';
import type { Db } from '@quill/db';
import { getPublishedForm, getSubmissionAnswersForAccount } from '@quill/db';
import { parseFileAnswer, type FormConfig, type FormStep } from '@quill/engine';
import type { SubmissionAnswers, UploadPresignInput, UploadPresignResult } from '@quill/types';
import { type ServerEnv } from '@quill/config/env';
import {
  extensionOf,
  incomingKey,
  storedBasename,
  uploadsPrefixFor,
  type ObjectStorage,
} from './storage';
import { DB, ENV, STORAGE } from './tokens';

export type UploadError = { error: string; message: string; status: number };

/**
 * Extensions no form may accept, whatever its owner configured.
 *
 * Two families. Executables and scripts, because a bucket of them is a malware
 * host with our name on it. And active documents (html, svg, xhtml), because
 * they run script in whatever origin serves them. We always serve as an
 * attachment, which defuses that, but a deployment that ever changes its mind
 * about `Content-Disposition` should not silently become an XSS surface.
 */
const DENIED_EXTENSIONS = new Set([
  'exe',
  'dll',
  'msi',
  'bat',
  'cmd',
  'com',
  'scr',
  'cpl',
  'jar',
  'app',
  'dmg',
  'pkg',
  'deb',
  'rpm',
  'sh',
  'bash',
  'ps1',
  'vbs',
  'js',
  'mjs',
  'jse',
  'wsf',
  'hta',
  'html',
  'htm',
  'xhtml',
  'svg',
]);

/**
 * Extensions whose bytes carry no signature to check.
 *
 * `file-type` is explicit that it detects binary formats only, so a .txt or a
 * .csv will never be identified no matter how legitimate it is. Rejecting on
 * "not detected" would therefore reject every plain-text upload; accepting on
 * "not detected" would let any bytes through under a .txt name. So the rule is:
 * undetectable is fine ONLY for extensions that are genuinely undetectable, and
 * everything else must produce a signature that agrees with its name.
 */
const SIGNATURELESS_EXTENSIONS = new Set(['txt', 'csv', 'tsv', 'md', 'log', 'json', 'xml', 'yml', 'yaml']);

/** Extensions that are really one format wearing several names. */
const EXTENSION_ALIASES: Record<string, string> = {
  jpeg: 'jpg',
  tif: 'tiff',
  htm: 'html',
  yaml: 'yml',
};

function canonicalExt(ext: string): string {
  return EXTENSION_ALIASES[ext] ?? ext;
}

const MAGIC_BYTES_SAMPLE = 4100;

@Injectable()
export class UploadService {
  private readonly log = new Logger('UploadService');

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: ServerEnv,
    @Inject(STORAGE) private readonly storage: ObjectStorage,
  ) {}

  /** False on a deployment with no bucket: the question type does not exist here. */
  get enabled(): boolean {
    return this.storage.enabled;
  }

  /** The deployment's hard per-file ceiling, in MB. An owner may only go lower. */
  get maxFileMb(): number {
    return this.env.UPLOAD_MAX_FILE_MB;
  }

  /**
   * Authorize one upload: check the claim against the published form, then hand
   * back a URL that can only write one key, for a few minutes, with one exact
   * content type.
   */
  async presign(
    accountCode: string,
    slug: string,
    input: UploadPresignInput,
  ): Promise<UploadPresignResult | UploadError> {
    if (!this.storage.enabled) {
      return { error: 'NOT_FOUND', message: 'File uploads are not enabled.', status: 404 };
    }

    const form = await getPublishedForm(this.db, accountCode, slug);
    if (!form) return { error: 'NOT_FOUND', message: 'Form not found.', status: 404 };

    const step = (form.config as FormConfig).steps.find((s) => s.key === input.stepKey);
    if (!step || step.type !== 'file') {
      return { error: 'BAD_REQUEST', message: 'That question does not take a file.', status: 400 };
    }

    const ext = extensionOf(input.name);
    const denied = this.checkExtension(step, ext);
    if (denied) return denied;

    const maxBytes = this.maxBytesFor(step);
    if (input.size > maxBytes) {
      return {
        error: 'FILE_TOO_LARGE',
        message: `That file is larger than the ${Math.floor(maxBytes / 1_000_000)} MB limit.`,
        status: 400,
      };
    }

    const key = incomingKey({
      accountId: form.accountId,
      formId: form.id,
      sessionId: input.sessionId,
      originalName: input.name,
    });
    const contentType = sanitizeMime(input.mime);
    const url = await this.storage.presignPut(key, contentType);
    return { url, key, contentType, expiresInSec: this.env.UPLOAD_PRESIGN_TTL_SEC };
  }

  /**
   * Check every file answer against the bucket and move the good ones out of
   * staging. Returns the answers with their keys rewritten, or an error that
   * fails the whole submission.
   *
   * Rewriting rather than mutating is deliberate: the caller persists what
   * comes back, so a submission can never be stored pointing at a staging key
   * that lifecycle is about to delete.
   *
   * Idempotent by key shape. A partial save verifies and promotes the file; the
   * complete submit that follows sees a key already under `uploads/` for this
   * same session and leaves it alone, instead of copying a second time or
   * failing because the staging object is gone.
   */
  async verifyAnswers(
    form: { id: string; accountId: string; config: unknown },
    sessionId: string,
    answers: SubmissionAnswers,
  ): Promise<{ answers: SubmissionAnswers } | UploadError> {
    const steps = (form.config as FormConfig).steps.filter((s) => s.type === 'file');
    if (steps.length === 0) return { answers };

    const out: SubmissionAnswers = { ...answers };
    const stagingRoot = incomingRootFor(form, sessionId);
    const promotedRoot = uploadsPrefixFor({
      accountId: form.accountId,
      formId: form.id,
      // The session, not the submission id: the row does not exist yet on the
      // first save, and one session is one submission anyway. Deleting a
      // submission deletes this prefix.
      submissionId: sessionId,
    });

    for (const step of steps) {
      const raw = out[step.key];
      if (raw == null || raw === '') continue;

      const file = parseFileAnswer(raw as never);
      if (!file) {
        return { error: 'BAD_REQUEST', message: 'That file answer is malformed.', status: 400 };
      }

      // Already promoted by an earlier save from this same session.
      if (file.key.startsWith(`${promotedRoot}/`)) continue;

      // The session is in the key, so this is what stops one visitor from
      // claiming another visitor's upload by pasting their key.
      if (!file.key.startsWith(`${stagingRoot}/`)) {
        return { error: 'BAD_REQUEST', message: 'That file does not belong to this session.', status: 400 };
      }

      const failed = await this.verifyObject(step, file.key, file.name);
      if (failed) return failed;

      const target = `${promotedRoot}/${storedBasename(file.name)}`;
      await this.storage.copy(file.key, target);
      out[step.key] = { key: target, name: file.name, size: file.size, mime: file.mime };
    }

    return { answers: out };
  }

  /**
   * A short-lived download URL for one file answer, or an error.
   *
   * Account-scoped at the database (invariant 3): the submission is read
   * through a JOIN on the caller's own account, so a guessed submission id from
   * another workspace resolves to nothing rather than to a signed URL. The URL
   * itself is minted per call, lives minutes, and is never stored or mailed.
   */
  async downloadUrl(
    accountId: string,
    submissionId: string,
    stepKey: string,
  ): Promise<{ url: string; name: string } | UploadError> {
    if (!this.storage.enabled) {
      return { error: 'NOT_FOUND', message: 'File uploads are not enabled.', status: 404 };
    }
    const row = await getSubmissionAnswersForAccount(this.db, accountId, submissionId);
    if (!row) return { error: 'NOT_FOUND', message: 'Submission not found.', status: 404 };

    const answers = (row.data ?? {}) as Record<string, unknown>;
    const file = parseFileAnswer(answers[stepKey] as never);
    if (!file) return { error: 'NOT_FOUND', message: 'No file on that question.', status: 404 };

    const url = await this.storage.presignGet(file.key, file.name);
    return { url, name: file.name };
  }

  /** The object exists, is within the limit, and its bytes match the name it arrived under. */
  private async verifyObject(step: FormStep, key: string, name: string): Promise<UploadError | null> {
    const head = await this.storage.head(key);
    if (!head) {
      return { error: 'BAD_REQUEST', message: 'That file was not uploaded, or has expired.', status: 400 };
    }
    if (head.size > this.maxBytesFor(step)) {
      // The presign call believed a claimed size; this is the real one.
      return { error: 'FILE_TOO_LARGE', message: 'That file is over the size limit.', status: 400 };
    }

    const ext = canonicalExt(extensionOf(name));
    const denied = this.checkExtension(step, ext);
    if (denied) return denied;

    const sample = await this.storage.readHead(key, MAGIC_BYTES_SAMPLE);
    const sniffed = sample ? await fileTypeFromBuffer(sample) : undefined;

    if (!sniffed) {
      if (SIGNATURELESS_EXTENSIONS.has(ext)) return null;
      return {
        error: 'FILE_TYPE_MISMATCH',
        message: 'That file does not look like its file type.',
        status: 400,
      };
    }
    if (canonicalExt(sniffed.ext) !== ext) {
      this.log.warn(`upload rejected: ${key} claims .${ext}, bytes say .${sniffed.ext}`);
      return {
        error: 'FILE_TYPE_MISMATCH',
        message: 'That file does not look like its file type.',
        status: 400,
      };
    }
    return null;
  }

  /** The owner's list narrows the deployment's; the denylist overrides both. */
  private checkExtension(step: FormStep, ext: string): UploadError | null {
    if (!ext) {
      return { error: 'FILE_TYPE_NOT_ALLOWED', message: 'That file has no extension.', status: 400 };
    }
    if (DENIED_EXTENSIONS.has(ext)) {
      return { error: 'FILE_TYPE_NOT_ALLOWED', message: 'That file type is not accepted.', status: 400 };
    }
    const allowed = step.allowedTypes?.map((t) => canonicalExt(t.trim().toLowerCase().replace(/^\./, '')));
    if (allowed && allowed.length > 0 && !allowed.includes(canonicalExt(ext))) {
      return { error: 'FILE_TYPE_NOT_ALLOWED', message: 'That file type is not accepted.', status: 400 };
    }
    return null;
  }

  /** The owner may ask for less than the deployment allows, never for more. */
  private maxBytesFor(step: FormStep): number {
    const ceiling = this.env.UPLOAD_MAX_FILE_MB;
    const asked = step.maxSizeMb && step.maxSizeMb > 0 ? step.maxSizeMb : ceiling;
    return Math.min(asked, ceiling) * 1_000_000;
  }
}

function incomingRootFor(form: { id: string; accountId: string }, sessionId: string): string {
  // Built through the same helper the presign uses, minus the basename, so the
  // two can never drift into disagreeing about what a valid key looks like.
  const sample = incomingKey({
    accountId: form.accountId,
    formId: form.id,
    sessionId,
    originalName: 'x.bin',
  });
  return sample.slice(0, sample.lastIndexOf('/'));
}

/** A content type safe to sign and to store: one token, no header injection. */
function sanitizeMime(mime: string): string {
  const m = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,80}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,80}$/i.exec(mime.trim());
  return m ? m[0].toLowerCase() : 'application/octet-stream';
}
