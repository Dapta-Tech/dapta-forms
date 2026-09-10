/**
 * Object storage for the `file` question type.
 *
 * The file never passes through this process. The browser PUTs straight to the
 * bucket with a short-lived presigned URL minted here, and on submit the API
 * verifies the object it was told about (it exists, it is small enough, its key
 * belongs to that session) before copying it out of the staging prefix. That
 * shape is what keeps a 10 MB upload from having to fit through the 1 MB server
 * action and the 100 kb body parser in front of this service.
 *
 * Two prefixes, and the difference matters:
 *
 * - `incoming/` is where the browser is allowed to write. Anything here is
 *   unverified and may be abandoned; a bucket lifecycle rule expires it after
 *   two days, which is what keeps the visitor who uploads and walks away from
 *   costing us storage forever.
 * - `uploads/` is written by this service only, after verification, and is the
 *   only prefix a submission ever points at.
 *
 * Nothing in the bucket is public. Reads happen through `presignGet`, which the
 * caller mints per click after checking the submission belongs to the account.
 */
import { Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  CopyObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectVersionsCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { isStorageEnabled, type ServerEnv } from '@quill/config/env';

/** Staging prefix the browser may write to; expired by bucket lifecycle. */
export const INCOMING_PREFIX = 'incoming';
/** Verified files. Written by this service only. */
export const UPLOADS_PREFIX = 'uploads';

export interface StoredObject {
  size: number;
  contentType: string | null;
}

export interface ObjectStorage {
  /** False on a deployment with no bucket: the whole question type is off. */
  readonly enabled: boolean;
  /** Upload URL, valid for the configured TTL. `contentType` is SIGNED: the client must send it back exactly. */
  presignPut(key: string, contentType: string): Promise<string>;
  /** Download URL, always as an attachment so an HTML or SVG upload cannot execute on our origin. */
  presignGet(key: string, filename: string): Promise<string>;
  /** Object metadata, or null when the key does not exist. */
  head(key: string): Promise<StoredObject | null>;
  /** The first `bytes` of the object, for magic-byte sniffing. Null when absent. */
  readHead(key: string, bytes: number): Promise<Uint8Array | null>;
  copy(fromKey: string, toKey: string): Promise<void>;
  /** Delete everything under a prefix, ALL VERSIONS. Returns how many objects went. */
  deletePrefix(prefix: string): Promise<number>;
}

function disabled(): never {
  throw new Error('Object storage is not configured on this deployment (STORAGE_BUCKET is unset).');
}

/**
 * What every deployment without a bucket gets. Reads answer "nothing there"
 * rather than throwing, because asking about a file that cannot exist is a fair
 * question; minting a URL is not, and stays loud.
 */
export class NoopStorage implements ObjectStorage {
  readonly enabled = false;
  async presignPut(): Promise<string> {
    return disabled();
  }
  async presignGet(): Promise<string> {
    return disabled();
  }
  async head(): Promise<StoredObject | null> {
    return null;
  }
  async readHead(): Promise<Uint8Array | null> {
    return null;
  }
  async copy(): Promise<void> {
    return disabled();
  }
  async deletePrefix(): Promise<number> {
    return 0;
  }
}

/** S3 and anything that speaks its API (R2, MinIO) behind one adapter. */
export class S3Storage implements ObjectStorage {
  readonly enabled = true;
  private readonly log = new Logger('S3Storage');
  private readonly client: S3Client;

  constructor(
    private readonly bucket: string,
    private readonly opts: {
      region: string;
      endpoint?: string;
      forcePathStyle?: boolean;
      accessKeyId?: string;
      secretAccessKey?: string;
      putTtlSec: number;
      getTtlSec: number;
    },
  ) {
    this.client = new S3Client({
      region: opts.region,
      ...(opts.endpoint ? { endpoint: opts.endpoint } : {}),
      ...(opts.forcePathStyle ? { forcePathStyle: true } : {}),
      // Both or neither. With neither, which is the deployed shape, the SDK
      // walks its own credential chain and finds the pod's role. That is why a
      // normal deployment configures no key at all.
      ...(opts.accessKeyId && opts.secretAccessKey
        ? { credentials: { accessKeyId: opts.accessKeyId, secretAccessKey: opts.secretAccessKey } }
        : {}),
    });
  }

  presignPut(key: string, contentType: string): Promise<string> {
    return getSignedUrl(
      this.client,
      new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: contentType }),
      {
        expiresIn: this.opts.putTtlSec,
        // Pin the content type into the signature. Without this the client can
        // sign for a PDF and upload anything; with it, a mismatched header is
        // rejected by S3 before a byte lands.
        signableHeaders: new Set(['content-type']),
      },
    );
  }

  presignGet(key: string, filename: string): Promise<string> {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        // Never inline. An uploaded .html or .svg served inline from a domain
        // we control would execute in that origin; as an attachment it cannot.
        ResponseContentDisposition: `attachment; filename="${headerSafeFilename(filename)}"`,
      }),
      { expiresIn: this.opts.getTtlSec },
    );
  }

  async head(key: string): Promise<StoredObject | null> {
    try {
      const r = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return { size: r.ContentLength ?? 0, contentType: r.ContentType ?? null };
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }

  async readHead(key: string, bytes: number): Promise<Uint8Array | null> {
    try {
      const r = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key, Range: `bytes=0-${bytes - 1}` }),
      );
      const body = r.Body as { transformToByteArray?: () => Promise<Uint8Array> } | undefined;
      if (!body?.transformToByteArray) return null;
      return await body.transformToByteArray();
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }

  async copy(fromKey: string, toKey: string): Promise<void> {
    await this.client.send(
      new CopyObjectCommand({
        Bucket: this.bucket,
        Key: toKey,
        // CopySource is a path, so the key has to be encoded even though the
        // key itself is already URL-safe by construction.
        CopySource: `${this.bucket}/${encodeURIComponent(fromKey).replace(/%2F/g, '/')}`,
      }),
    );
  }

  /**
   * Delete every object under `prefix`, every version of each.
   *
   * The plain DeleteObject that looks right here is wrong on a versioned
   * bucket, and our buckets are versioned because cross-region replication
   * requires it: a delete without a version id writes a delete marker and
   * leaves the bytes recoverable. An erasure request has to actually erase, so
   * this enumerates versions and delete markers and removes them by id.
   */
  async deletePrefix(prefix: string): Promise<number> {
    let keyMarker: string | undefined;
    let versionIdMarker: string | undefined;
    let removed = 0;

    do {
      const page = await this.client.send(
        new ListObjectVersionsCommand({
          Bucket: this.bucket,
          Prefix: prefix,
          KeyMarker: keyMarker,
          VersionIdMarker: versionIdMarker,
        }),
      );
      const targets = [...(page.Versions ?? []), ...(page.DeleteMarkers ?? [])]
        .filter((v): v is { Key: string; VersionId: string } => Boolean(v.Key && v.VersionId))
        .map((v) => ({ Key: v.Key, VersionId: v.VersionId }));

      // DeleteObjects takes 1000 keys per call, and a long-lived object with
      // many versions can exceed that on a single page.
      for (let i = 0; i < targets.length; i += 1000) {
        const batch = targets.slice(i, i + 1000);
        const r = await this.client.send(
          new DeleteObjectsCommand({ Bucket: this.bucket, Delete: { Objects: batch, Quiet: true } }),
        );
        removed += batch.length - (r.Errors?.length ?? 0);
        for (const e of r.Errors ?? []) {
          this.log.error(`failed to delete ${e.Key}@${e.VersionId}: ${e.Code} ${e.Message}`);
        }
      }

      keyMarker = page.IsTruncated ? page.NextKeyMarker : undefined;
      versionIdMarker = page.IsTruncated ? page.NextVersionIdMarker : undefined;
    } while (keyMarker || versionIdMarker);

    return removed;
  }
}

function isNotFound(err: unknown): boolean {
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
  return e?.name === 'NotFound' || e?.name === 'NoSuchKey' || e?.$metadata?.httpStatusCode === 404;
}

/**
 * A filename safe to interpolate into a Content-Disposition header: no quotes,
 * no CR/LF (header injection), no path separators, and short enough that the
 * header stays sane.
 */
export function headerSafeFilename(name: string): string {
  const cleaned = name
    .replace(/[\r\n"\\]/g, '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[/\\]/g, '_')
    .trim();
  return (cleaned || 'download').slice(0, 120);
}

/**
 * The stored basename. The original name goes in the answer, not the key: a
 * filename is user data and routinely carries a person's name, so the key gets
 * a uuid and keeps only the extension, which is what the download needs to
 * behave. Extensions are bounded and lowercased so `.PDF` and `.pdf` land the
 * same, and anything strange collapses to no extension rather than travelling.
 */
export function storedBasename(originalName: string): string {
  const ext = /\.([A-Za-z0-9]{1,12})$/.exec(originalName.trim())?.[1]?.toLowerCase();
  return ext ? `${randomUUID()}.${ext}` : randomUUID();
}

/** The extension a filename claims, lowercased and without the dot; '' when it claims none. */
export function extensionOf(name: string): string {
  return /\.([A-Za-z0-9]{1,12})$/.exec(name.trim())?.[1]?.toLowerCase() ?? '';
}

/**
 * Staging key for one upload. `sessionId` is in the path on purpose: it is what
 * lets the submit handler prove the key it was handed belongs to the session
 * that is submitting, rather than to somebody else's form.
 */
export function incomingKey(a: {
  accountId: string;
  formId: string;
  sessionId: string;
  originalName: string;
}): string {
  return [
    INCOMING_PREFIX,
    safeSegment(a.accountId),
    safeSegment(a.formId),
    safeSegment(a.sessionId),
    storedBasename(a.originalName),
  ].join('/');
}

/** Where a verified file lives. Deleting a submission deletes this prefix. */
export function uploadsPrefixFor(a: { accountId: string; formId: string; submissionId: string }): string {
  return [UPLOADS_PREFIX, safeSegment(a.accountId), safeSegment(a.formId), safeSegment(a.submissionId)].join(
    '/',
  );
}

/** Ids are ours and already tame, but a key is a security boundary, so pin it anyway. */
function safeSegment(v: string): string {
  return v.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64) || '_';
}

export function createObjectStorage(env: ServerEnv): ObjectStorage {
  if (!isStorageEnabled(env) || !env.STORAGE_BUCKET) return new NoopStorage();
  return new S3Storage(env.STORAGE_BUCKET, {
    region: env.STORAGE_REGION,
    endpoint: env.STORAGE_ENDPOINT,
    forcePathStyle: env.STORAGE_FORCE_PATH_STYLE,
    accessKeyId: env.STORAGE_ACCESS_KEY_ID,
    secretAccessKey: env.STORAGE_SECRET_ACCESS_KEY,
    putTtlSec: env.UPLOAD_PRESIGN_TTL_SEC,
    getTtlSec: env.UPLOAD_DOWNLOAD_TTL_SEC,
  });
}
