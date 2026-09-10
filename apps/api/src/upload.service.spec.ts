/**
 * The `file` question type, server side.
 *
 * Two boundaries are under test and they are not the same boundary. `presign`
 * decides whether to hand an ANONYMOUS client a write token, using only what
 * that client claims. `verifyAnswers` decides whether the object it later
 * points at is real, small enough, its own, and actually the kind of file its
 * name says. The claims are worth nothing by then.
 *
 * The storage adapter is a fake, so these tests pin OUR rules rather than the
 * SDK's behaviour. `storage.spec.ts` covers the key and header helpers.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createDb, migrate, seed, sql, type Db } from '@quill/db';
import { UploadService } from './upload.service';
import { PREVIEW_MAX_BYTES } from './file-preview';
import type { InlineDisposition, ObjectStorage, StoredObject } from './storage';
import type { ServerEnv } from '@quill/config/env';

const PDF_MAGIC = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]); // "%PDF-1.7"
const PNG_MAGIC = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PLAIN_TEXT = new TextEncoder().encode('name,email\nada,ada@example.com\n');

/** Records what it was asked to do and answers from a map of planted objects. */
class FakeStorage implements ObjectStorage {
  objects = new Map<string, { size: number; head: Uint8Array; contentType?: string }>();
  copies: Array<{ from: string; to: string }> = [];
  signed: Array<{ key: string; contentType: string }> = [];
  /** Every presignGet, so a test can see the disposition each URL was asked for. */
  reads: Array<{ key: string; filename: string; inline: InlineDisposition | undefined }> = [];

  constructor(readonly enabled = true) {}

  async presignPut(key: string, contentType: string): Promise<string> {
    this.signed.push({ key, contentType });
    return `https://bucket.example/${key}?sig=test`;
  }
  async presignGet(key: string, filename: string, inline?: InlineDisposition): Promise<string> {
    this.reads.push({ key, filename, inline });
    // The disposition rides in the fake URL so a test can assert on the value
    // the caller gets back, not only on what the adapter was asked for.
    const how = inline ? `inline&type=${encodeURIComponent(inline.contentType)}` : 'attachment';
    return `https://bucket.example/${key}?sig=get&as=${how}`;
  }
  async head(key: string): Promise<StoredObject | null> {
    const o = this.objects.get(key);
    return o ? { size: o.size, contentType: o.contentType ?? null } : null;
  }
  async readHead(key: string, bytes: number): Promise<Uint8Array | null> {
    const o = this.objects.get(key);
    return o ? o.head.slice(0, bytes) : null;
  }
  async copy(from: string, to: string): Promise<void> {
    this.copies.push({ from, to });
    const o = this.objects.get(from);
    if (o) this.objects.set(to, o);
  }
  async deletePrefix(): Promise<number> {
    return 0;
  }
}

/** Signing reaches AWS, so it can fail for reasons the visitor did not cause. */
class UnsignableStorage extends FakeStorage {
  override async presignPut(): Promise<string> {
    throw new Error('Could not load credentials from any providers');
  }
  override async presignGet(): Promise<string> {
    throw new Error('Could not load credentials from any providers');
  }
}

const ENV = {
  UPLOAD_MAX_FILE_MB: 10,
  UPLOAD_PRESIGN_TTL_SEC: 600,
  UPLOAD_DOWNLOAD_TTL_SEC: 300,
} as unknown as ServerEnv;

const FILE_STEP = {
  key: 'cv',
  type: 'file',
  question: 'Upload your CV',
  required: true,
  allowedTypes: ['pdf', 'png'],
};

const CONFIG = {
  version: 1,
  steps: [{ key: 'work_email', type: 'email', question: 'Work email?' }, FILE_STEP],
};

let db: Db;
let storage: FakeStorage;
let svc: UploadService;
let form: { id: string; accountId: string; config: unknown };

beforeEach(async () => {
  db = await createDb('file::memory:');
  await migrate(db);
  await seed(db); // account "acme" + form "lead-qualifier"
  await db.run(sql`UPDATE form SET config = ${JSON.stringify(CONFIG)} WHERE slug = 'lead-qualifier'`);
  const row = await db.get<{ id: string; account_id: string }>(
    sql`SELECT id, account_id FROM form WHERE slug = 'lead-qualifier' LIMIT 1`,
  );
  form = { id: row!.id, accountId: row!.account_id, config: CONFIG };
  storage = new FakeStorage();
  svc = new UploadService(db, ENV, storage);
});

describe('presign', () => {
  const ask = (over: Partial<Record<string, unknown>> = {}) =>
    svc.presign('acme', 'lead-qualifier', {
      sessionId: 'sess-1',
      stepKey: 'cv',
      name: 'resume.pdf',
      size: 1_000_000,
      mime: 'application/pdf',
      ...over,
    } as never);

  it('signs a key scoped to the account, form and SESSION', async () => {
    const r = await ask();
    expect('error' in r).toBe(false);
    const ok = r as { key: string; url: string; contentType: string; expiresInSec: number };
    expect(ok.key.startsWith(`incoming/${form.accountId}/${form.id}/sess-1/`)).toBe(true);
    expect(ok.contentType).toBe('application/pdf');
    expect(ok.expiresInSec).toBe(600);
    // The original filename is user data and must not be in the key.
    expect(ok.key).not.toContain('resume');
    expect(ok.key.endsWith('.pdf')).toBe(true);
  });

  it('pins the content type into the signature', async () => {
    await ask();
    expect(storage.signed[0]?.contentType).toBe('application/pdf');
  });

  it('404s on a deployment with no bucket', async () => {
    const off = new UploadService(db, ENV, new FakeStorage(false));
    expect(await off.presign('acme', 'lead-qualifier', { sessionId: 's', stepKey: 'cv', name: 'a.pdf', size: 1, mime: 'application/pdf' } as never)).toMatchObject({ status: 404 });
  });

  it('refuses a step that does not take a file', async () => {
    expect(await ask({ stepKey: 'work_email' })).toMatchObject({ status: 400 });
  });

  it('refuses a step that does not exist', async () => {
    expect(await ask({ stepKey: 'nope' })).toMatchObject({ status: 400 });
  });

  it('refuses an extension the owner did not allow', async () => {
    expect(await ask({ name: 'sheet.xlsx' })).toMatchObject({ error: 'FILE_TYPE_NOT_ALLOWED' });
  });

  it('refuses executables and active content even when the owner allowed them', async () => {
    const wide = { ...form, config: { version: 1, steps: [{ ...FILE_STEP, allowedTypes: ['exe', 'svg', 'html'] }] } };
    await db.run(sql`UPDATE form SET config = ${JSON.stringify(wide.config)} WHERE slug = 'lead-qualifier'`);
    for (const name of ['payload.exe', 'logo.svg', 'page.html']) {
      expect(await ask({ name })).toMatchObject({ error: 'FILE_TYPE_NOT_ALLOWED' });
    }
  });

  it('refuses a file with no extension at all', async () => {
    expect(await ask({ name: 'resume' })).toMatchObject({ error: 'FILE_TYPE_NOT_ALLOWED' });
  });

  it('refuses a claimed size over the deployment ceiling', async () => {
    expect(await ask({ size: 11_000_000 })).toMatchObject({ error: 'FILE_TOO_LARGE' });
  });

  it("clamps to the owner's own lower limit, and never above the ceiling", async () => {
    const tight = { version: 1, steps: [{ ...FILE_STEP, maxSizeMb: 2 }] };
    await db.run(sql`UPDATE form SET config = ${JSON.stringify(tight)} WHERE slug = 'lead-qualifier'`);
    expect(await ask({ size: 3_000_000 })).toMatchObject({ error: 'FILE_TOO_LARGE' });

    const greedy = { version: 1, steps: [{ ...FILE_STEP, maxSizeMb: 500 }] };
    await db.run(sql`UPDATE form SET config = ${JSON.stringify(greedy)} WHERE slug = 'lead-qualifier'`);
    expect(await ask({ size: 11_000_000 })).toMatchObject({ error: 'FILE_TOO_LARGE' });
  });

  it('reports a signing failure as a typed 503, not a bare 500', async () => {
    // The shape of a pod with no role attached, or a role whose session died.
    // Left unguarded this surfaced as an Internal Server Error with a stack in
    // the log, which names neither the cause nor who can fix it.
    const broken = new UploadService(db, ENV, new UnsignableStorage());
    const r = await broken.presign('acme', 'lead-qualifier', {
      sessionId: 'sess-1',
      stepKey: 'cv',
      name: 'resume.pdf',
      size: 1000,
      mime: 'application/pdf',
    } as never);
    expect(r).toMatchObject({ error: 'UPLOAD_UNAVAILABLE', status: 503 });
  });

  it('normalizes a junk mime instead of signing it', async () => {
    const r = (await ask({ mime: 'text/html\r\nX-Evil: 1' })) as { contentType: string };
    expect(r.contentType).toBe('application/octet-stream');
  });
});

describe('verifyAnswers', () => {
  const stagingKey = (name = 'abc.pdf', session = 'sess-1') =>
    `incoming/${form.accountId}/${form.id}/${session}/${name}`;

  const answer = (key: string, name = 'resume.pdf') => ({
    cv: { key, name, size: '1000', mime: 'application/pdf' },
  });

  it('promotes a verified file out of staging and rewrites the key', async () => {
    const key = stagingKey();
    storage.objects.set(key, { size: 1000, head: PDF_MAGIC });

    const r = await svc.verifyAnswers(form, 'sess-1', answer(key));
    expect('error' in r).toBe(false);
    const cv = (r as { answers: Record<string, { key: string; name: string }> }).answers.cv!;
    expect(cv.key.startsWith(`uploads/${form.accountId}/${form.id}/sess-1/`)).toBe(true);
    expect(cv.name).toBe('resume.pdf');
    expect(storage.copies).toHaveLength(1);
  });

  it('refuses a key belonging to a DIFFERENT session', async () => {
    const key = stagingKey('abc.pdf', 'someone-else');
    storage.objects.set(key, { size: 1000, head: PDF_MAGIC });
    expect(await svc.verifyAnswers(form, 'sess-1', answer(key))).toMatchObject({ status: 400 });
    expect(storage.copies).toHaveLength(0);
  });

  it('refuses a key that points outside the staging prefix entirely', async () => {
    const key = `uploads/${form.accountId}/${form.id}/other-session/abc.pdf`;
    storage.objects.set(key, { size: 1000, head: PDF_MAGIC });
    expect(await svc.verifyAnswers(form, 'sess-1', answer(key))).toMatchObject({ status: 400 });
  });

  it('refuses an object that was never uploaded (or already expired)', async () => {
    expect(await svc.verifyAnswers(form, 'sess-1', answer(stagingKey()))).toMatchObject({ status: 400 });
  });

  it('uses the REAL size, not the claimed one', async () => {
    const key = stagingKey();
    // The answer says 1000 bytes; the object is 40 MB.
    storage.objects.set(key, { size: 40_000_000, head: PDF_MAGIC });
    expect(await svc.verifyAnswers(form, 'sess-1', answer(key))).toMatchObject({ error: 'FILE_TOO_LARGE' });
  });

  it('refuses bytes that disagree with the extension', async () => {
    const key = stagingKey();
    // A PNG wearing a .pdf name.
    storage.objects.set(key, { size: 1000, head: PNG_MAGIC });
    expect(await svc.verifyAnswers(form, 'sess-1', answer(key))).toMatchObject({
      error: 'FILE_TYPE_MISMATCH',
    });
  });

  it('accepts a format that HAS no signature, but only under a text extension', async () => {
    const textish = { version: 1, steps: [{ ...FILE_STEP, allowedTypes: ['csv', 'pdf'] }] };
    const csvForm = { ...form, config: textish };
    const key = stagingKey('abc.csv');
    storage.objects.set(key, { size: 30, head: PLAIN_TEXT });

    const ok = await svc.verifyAnswers(csvForm, 'sess-1', {
      cv: { key, name: 'leads.csv', size: '30', mime: 'text/csv' },
    });
    expect('error' in ok).toBe(false);

    // The same undetectable bytes under a binary extension are refused.
    const lying = stagingKey('def.pdf');
    storage.objects.set(lying, { size: 30, head: PLAIN_TEXT });
    expect(await svc.verifyAnswers(csvForm, 'sess-1', answer(lying))).toMatchObject({
      error: 'FILE_TYPE_MISMATCH',
    });
  });

  it('is idempotent: a second save of an already promoted key copies nothing', async () => {
    const key = stagingKey();
    storage.objects.set(key, { size: 1000, head: PDF_MAGIC });
    const first = (await svc.verifyAnswers(form, 'sess-1', answer(key))) as {
      answers: Record<string, { key: string }>;
    };

    const second = await svc.verifyAnswers(form, 'sess-1', first.answers);
    expect('error' in second).toBe(false);
    // One copy total: the partial save's. The complete submit left it alone.
    expect(storage.copies).toHaveLength(1);
    expect((second as { answers: Record<string, { key: string }> }).answers.cv!.key).toBe(
      first.answers.cv!.key,
    );
  });

  it('passes through a form with no file question, touching storage not at all', async () => {
    const plain = { id: form.id, accountId: form.accountId, config: { version: 1, steps: [{ key: 'e', type: 'email' }] } };
    const r = await svc.verifyAnswers(plain, 'sess-1', { e: 'ada@example.com' });
    expect(r).toEqual({ answers: { e: 'ada@example.com' } });
    expect(storage.copies).toHaveLength(0);
  });

  it('leaves an unanswered optional file question alone', async () => {
    const r = await svc.verifyAnswers(form, 'sess-1', { work_email: 'ada@example.com' });
    expect(r).toEqual({ answers: { work_email: 'ada@example.com' } });
  });

  it('refuses a malformed file answer rather than storing it', async () => {
    expect(await svc.verifyAnswers(form, 'sess-1', { cv: 'just-a-string' })).toMatchObject({
      status: 400,
    });
    expect(await svc.verifyAnswers(form, 'sess-1', { cv: { name: 'x.pdf' } })).toMatchObject({
      status: 400,
    });
  });
});

/**
 * Reading one file back, which had no coverage at all before this block.
 *
 * The interesting decision is not "does it sign a URL" but "which URL": an
 * upload is only ever rendered in place when the API itself decided the type is
 * safe, and it decides from the EXTENSION rather than from the `mime` on the
 * answer, because the mime is a string the browser typed and nothing checked.
 * So a mime that lies has to change nothing about what comes back.
 */
describe('submissionFile', () => {
  /** Plant one stored submission carrying one file answer. */
  async function plant(
    file: Record<string, string>,
    over: { accountId?: string } = {},
  ): Promise<string> {
    const id = `sub-${Math.random().toString(36).slice(2)}`;
    let formId = form.id;
    if (over.accountId) {
      // A form belonging to somebody else, so the join has something to refuse.
      formId = `form-${id}`;
      await db.run(
        sql`INSERT INTO form (id, account_id, slug, name, config, created_at, updated_at)
            VALUES (${formId}, ${over.accountId}, ${`slug-${id}`}, 'Theirs', ${JSON.stringify(CONFIG)}, 1, 1)`,
      );
    }
    await db.run(
      sql`INSERT INTO submission (id, form_id, session_id, data, score, started_at, completed_at)
          VALUES (${id}, ${formId}, ${`sess-${id}`}, ${JSON.stringify({ cv: file })}, 0, 1, 1)`,
    );
    return id;
  }

  const CV_PDF = {
    key: 'uploads/acct/form/sess/9f3c.pdf',
    name: 'Ada Lovelace CV.pdf',
    size: '40211',
    mime: 'application/pdf',
  };

  it('mints a download URL and a separate one to render a PDF in place', async () => {
    const id = await plant(CV_PDF);
    const r = await svc.submissionFile(form.accountId, id, 'cv');

    expect(r).toMatchObject({ name: 'Ada Lovelace CV.pdf', size: '40211', kind: 'pdf' });
    const ok = r as { url: string; previewUrl: string };
    expect(ok.url).toContain('as=attachment');
    expect(ok.previewUrl).toContain('as=inline');
    expect(ok.previewUrl).toContain(encodeURIComponent('application/pdf'));
  });

  it('forces the image type on the inline URL instead of trusting the stored one', async () => {
    // A real PNG whose answer claims text/html. The magic-byte check passed it
    // because the bytes agree with .png; only the mime lies. Served inline
    // under that mime it would render as a page, so the type is overridden.
    const id = await plant({ ...CV_PDF, key: 'uploads/a/f/s/1.png', name: 'logo.png', mime: 'text/html' });
    const r = (await svc.submissionFile(form.accountId, id, 'cv')) as { kind: string; previewUrl: string };

    expect(r.kind).toBe('image');
    expect(r.previewUrl).toContain(encodeURIComponent('image/png'));
    expect(r.previewUrl).not.toContain('text%2Fhtml');
    expect(storage.reads.some((x) => x.inline?.contentType === 'text/html')).toBe(false);
  });

  it('gives a .docx one URL for both jobs, since the dashboard reads its bytes', async () => {
    const id = await plant({ ...CV_PDF, key: 'uploads/a/f/s/2.docx', name: 'CV.docx' });
    const r = (await svc.submissionFile(form.accountId, id, 'cv')) as {
      kind: string;
      url: string;
      previewUrl: string;
    };

    expect(r.kind).toBe('docx');
    expect(r.previewUrl).toBe(r.url);
    // A fetch ignores the disposition, so asking for a second signature would
    // have been a round trip that bought nothing.
    expect(storage.reads).toHaveLength(1);
  });

  it('offers no preview for a type no browser draws, and still downloads it', async () => {
    const id = await plant({ ...CV_PDF, key: 'uploads/a/f/s/3.zip', name: 'portfolio.zip' });
    const r = (await svc.submissionFile(form.accountId, id, 'cv')) as {
      kind: string;
      url: string;
      previewUrl: null;
    };

    expect(r.kind).toBe('none');
    expect(r.previewUrl).toBeNull();
    expect(r.url).toContain('as=attachment');
  });

  it('refuses to preview something too big to open in a dialog', async () => {
    const id = await plant({ ...CV_PDF, size: String(PREVIEW_MAX_BYTES + 1) });
    const r = (await svc.submissionFile(form.accountId, id, 'cv')) as { kind: string; previewUrl: null };
    expect(r.kind).toBe('none');
    expect(r.previewUrl).toBeNull();
  });

  it("answers 404 for another workspace's submission, never a working link", async () => {
    await db.run(sql`INSERT INTO account (id, code, name, created_at) VALUES ('other', 'other', 'Other', 1)`);
    const id = await plant(CV_PDF, { accountId: 'other' });

    expect(await svc.submissionFile(form.accountId, id, 'cv')).toMatchObject({ status: 404 });
    // And the real owner does get it, so the 404 above is the scoping working
    // rather than the fixture being broken.
    expect(await svc.submissionFile('other', id, 'cv')).toMatchObject({ kind: 'pdf' });
  });

  it('answers 404 for a question with no file on it', async () => {
    const id = await plant(CV_PDF);
    expect(await svc.submissionFile(form.accountId, id, 'work_email')).toMatchObject({ status: 404 });
  });

  it('reports a signing failure as 503, not as a missing file', async () => {
    svc = new UploadService(db, ENV, new UnsignableStorage());
    const id = await plant(CV_PDF);
    expect(await svc.submissionFile(form.accountId, id, 'cv')).toMatchObject({
      error: 'UPLOAD_UNAVAILABLE',
      status: 503,
    });
  });

  it('says the feature does not exist on a deployment with no bucket', async () => {
    svc = new UploadService(db, ENV, new FakeStorage(false));
    const id = await plant(CV_PDF);
    expect(await svc.submissionFile(form.accountId, id, 'cv')).toMatchObject({ status: 404 });
  });
});
