/**
 * Permanent file links end to end on in-memory SQLite: a webhook delivery gives
 * every file answer a `url`, in both phases, without touching the stored answers
 * or what HubSpot sees; and the link in that payload resolves, through the
 * public endpoint, to a short-lived signed GET.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomBytes } from 'node:crypto';
import { HttpException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { createDb, migrate, seed, listOutbox, sql, type Db } from '@quill/db';
import { SubmissionNotifier, LogOnlyEmailProvider } from '@quill/notifications';
import type { ServerEnv } from '@quill/config/env';
import { DestinationEffects, type SubmissionDeliveryInput } from './destination-effects';
import { EmailEffects } from './email-effects';
import { OutboxWorker } from './outbox.worker';
import { PublicController } from './public.controller';
import { RateLimitGuard } from './rate-limit';
import { UploadService } from './upload.service';
import type { InlineDisposition, ObjectStorage } from './storage';

const ENCRYPTION_KEY = randomBytes(32).toString('base64');
const APP = 'https://forms.example.com';
const ENV = {
  NODE_ENV: 'test',
  PUBLIC_APP_URL: APP,
  FORMS_ENCRYPTION_KEY: ENCRYPTION_KEY,
  UPLOAD_MAX_FILE_MB: 10,
  UPLOAD_PRESIGN_TTL_SEC: 600,
  UPLOAD_DOWNLOAD_TTL_SEC: 300,
} as unknown as ServerEnv;

const CV = { key: 'uploads/acct/form/sess/9f3c.pdf', name: 'cv.pdf', size: '40211', mime: 'application/pdf' };
const DOC = { key: 'uploads/acct/form/sess/1a2b.docx', name: 'Cover letter.docx', size: '9000', mime: 'application/msword' };
const ANSWERS = { email: 'ada@example.com', role: 'founder', cv: CV, letter: DOC, utm: { utm_source: 'news' } };

/** Answers from what the adapter asked for, so a test can read the disposition off the URL. */
class FakeStorage implements ObjectStorage {
  readonly enabled = true;
  async presignPut(): Promise<string> {
    return 'https://bucket.example/put';
  }
  async presignGet(key: string, filename: string, inline?: InlineDisposition): Promise<string> {
    const how = inline ? `inline&type=${encodeURIComponent(inline.contentType)}` : 'attachment';
    return `https://bucket.example/${key}?name=${encodeURIComponent(filename)}&as=${how}`;
  }
  async head() {
    return null;
  }
  async readHead() {
    return null;
  }
  async copy(): Promise<void> {}
  async deletePrefix(): Promise<number> {
    return 0;
  }
}

let db: Db;
let formId: string;

beforeEach(async () => {
  db = await createDb('file::memory:');
  await migrate(db);
  await seed(db);
  formId = (await db.get<{ id: string }>(sql`SELECT id FROM form WHERE slug = 'lead-qualifier' LIMIT 1`))!.id;
});

afterEach(async () => {
  await db.close();
});

/** A stored submission carrying `data`, as the submit path would have left it. */
async function plant(id: string, data: Record<string, unknown>): Promise<void> {
  await db.run(
    sql`INSERT INTO submission (id, form_id, session_id, data, score, started_at, completed_at)
        VALUES (${id}, ${formId}, ${`sess-${id}`}, ${JSON.stringify(data)}, 0, 1, 1)`,
  );
}

async function storedData(id: string): Promise<Record<string, unknown>> {
  const row = await db.get<{ data: string }>(sql`SELECT data FROM submission WHERE id = ${id}`);
  return JSON.parse(row!.data) as Record<string, unknown>;
}

function input(
  submissionId: string,
  phase: 'partial' | 'complete',
  destinations: unknown[],
  data: Record<string, unknown>,
): SubmissionDeliveryInput {
  return {
    formId,
    formName: 'Lead qualifier',
    accountId: 'acc-1',
    submissionId,
    sessionId: `sess-${submissionId}`,
    score: 0,
    outcomeLabel: null,
    phase,
    submittedAt: Date.now(),
    data,
    config: { version: 1, steps: [], destinations },
  };
}

const WEBHOOK = { type: 'webhook', enabled: true, settings: { url: 'https://receiver.example/hook' } };
const HUBSPOT = { type: 'hubspot', enabled: true };

/** A delivered body, read loosely: answers are objects or plain values. */
type Answer = { url?: string } & Record<string, unknown>;
interface Delivered {
  phase: string;
  data: Record<string, Answer>;
}

/** Drain the outbox through a fake receiver; returns every webhook body it got. */
async function drain(effects: DestinationEffects): Promise<Delivered[]> {
  const bodies: Delivered[] = [];
  effects.fetchImpl = (async (_url: string, init: RequestInit) => {
    bodies.push(JSON.parse(init.body as string));
    return new Response('{}', { status: 200 });
  }) as unknown as typeof fetch;
  const env = { OUTBOX_WORKER_ENABLED: false, OUTBOX_POLL_MS: 5000, NODE_ENV: 'test' } as never;
  const email = new EmailEffects(new SubmissionNotifier(new LogOnlyEmailProvider()), db);
  await new OutboxWorker(db, env, email, effects).drainOnce();
  return bodies;
}

function effectsWith(env: Partial<ServerEnv>): DestinationEffects {
  const effects = new DestinationEffects(db, env as ServerEnv);
  effects.resolveDns = async () => ['93.184.216.34'];
  return effects;
}

describe('webhook payload', () => {
  it('adds a url to every file answer, in the partial AND the complete delivery', async () => {
    await plant('sub-1', ANSWERS);
    const effects = effectsWith(ENV);
    await effects.enqueueSubmissionDeliveries(input('sub-1', 'partial', [WEBHOOK], await storedData('sub-1')));
    await effects.enqueueSubmissionDeliveries(input('sub-1', 'complete', [WEBHOOK], await storedData('sub-1')));

    const bodies = await drain(effects);
    expect(bodies.map((b) => b.phase).sort()).toEqual(['complete', 'partial']);
    for (const body of bodies) {
      // Additive: the four fields a receiver already reads are exactly as stored.
      expect(body.data.cv).toEqual({ ...CV, url: expect.stringMatching(/^https:\/\/forms\.example\.com\/file\/v1\./) });
      expect(body.data.letter).toEqual({ ...DOC, url: expect.stringMatching(/^https:\/\/forms\.example\.com\/file\/v1\./) });
      expect(body.data.cv!.url).not.toBe(body.data.letter!.url);
      // Everything that is not a file answer is untouched.
      expect(body.data.email).toBe('ada@example.com');
      expect(body.data.role).toBe('founder');
      expect(body.data.utm).toEqual({ utm_source: 'news' });
    }
    // The same link in both phases: it names the submission, not the delivery.
    expect(bodies[0]!.data.cv!.url).toBe(bodies[1]!.data.cv!.url);
  });

  it('never writes the link into the stored answers, nor into the snapshot data', async () => {
    await plant('sub-2', ANSWERS);
    const data = await storedData('sub-2');
    const effects = effectsWith(ENV);
    await effects.enqueueSubmissionDeliveries(input('sub-2', 'complete', [WEBHOOK], data));
    await drain(effects);

    expect(await storedData('sub-2')).toEqual(ANSWERS);
    expect(data).toEqual(ANSWERS);
    const [row] = await listOutbox(db, { kind: 'webhook', subjectUid: 'sub-2' });
    const ctx = (JSON.parse(row!.payload!) as { ctx: { data: Record<string, unknown>; fileLinks: Record<string, string> } }).ctx;
    expect(ctx.data.cv).toEqual(CV);
    expect(Object.keys(ctx.fileLinks).sort()).toEqual(['cv', 'letter']);
  });

  it('gives HubSpot nothing new: no links in its snapshot, the answers as stored', async () => {
    await plant('sub-3', ANSWERS);
    const effects = effectsWith(ENV);
    await effects.enqueueSubmissionDeliveries(input('sub-3', 'complete', [WEBHOOK, HUBSPOT], await storedData('sub-3')));

    const [hubspot] = await listOutbox(db, { kind: 'hubspot', subjectUid: 'sub-3' });
    const ctx = (JSON.parse(hubspot!.payload!) as { ctx: Record<string, unknown> }).ctx;
    expect(ctx.fileLinks).toBeUndefined();
    expect(ctx.data).toEqual(ANSWERS);
  });

  it('sends no url when the deployment has no key to sign with', async () => {
    await plant('sub-4', ANSWERS);
    const effects = effectsWith({ ...ENV, FORMS_ENCRYPTION_KEY: undefined, FILE_LINK_SECRET: undefined });
    await effects.enqueueSubmissionDeliveries(input('sub-4', 'complete', [WEBHOOK], await storedData('sub-4')));
    const [body] = await drain(effects);
    expect(body!.data.cv).toEqual(CV);
  });

  it('sends no url when there is no public web host to link to', async () => {
    await plant('sub-5', ANSWERS);
    const effects = effectsWith({ ...ENV, PUBLIC_APP_URL: '' });
    await effects.enqueueSubmissionDeliveries(input('sub-5', 'complete', [WEBHOOK], await storedData('sub-5')));
    const [body] = await drain(effects);
    expect(body!.data.cv).toEqual(CV);
  });

  it('leaves a submission with no file exactly as before', async () => {
    const data = { email: 'ada@example.com' };
    await plant('sub-6', data);
    const effects = effectsWith(ENV);
    await effects.enqueueSubmissionDeliveries(input('sub-6', 'complete', [WEBHOOK], data));
    const [row] = await listOutbox(db, { kind: 'webhook', subjectUid: 'sub-6' });
    expect('fileLinks' in (JSON.parse(row!.payload!) as { ctx: object }).ctx).toBe(false);
    const [body] = await drain(effects);
    expect(body!.data).toEqual(data);
  });
});

describe('GET /v1/public/files/:token', () => {
  function controller(env: Partial<ServerEnv> = ENV): PublicController {
    return new PublicController({} as never, new UploadService(db, env as ServerEnv, new FakeStorage()), env as ServerEnv);
  }

  /** The token the webhook actually sent for one file answer. */
  async function deliveredToken(submissionId: string, stepKey: string): Promise<string> {
    const effects = effectsWith(ENV);
    await effects.enqueueSubmissionDeliveries(input(submissionId, 'complete', [WEBHOOK], await storedData(submissionId)));
    const [body] = await drain(effects);
    return (body!.data[stepKey]!.url as string).slice(`${APP}/file/`.length);
  }

  /** The 404 a call threw, as the client would read it. */
  async function notFound(p: Promise<unknown>): Promise<unknown> {
    const err = await p.then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(HttpException);
    expect((err as HttpException).getStatus()).toBe(404);
    return (err as HttpException).getResponse();
  }

  const MISS = { error: 'NOT_FOUND', message: 'File not found.' };

  it('resolves the delivered link of a PDF to an inline signed GET', async () => {
    await plant('sub-r1', ANSWERS);
    const res = await controller().file(await deliveredToken('sub-r1', 'cv'));
    expect(res.disposition).toBe('inline');
    expect(res.url).toContain(`as=inline&type=${encodeURIComponent('application/pdf')}`);
  });

  it('resolves the delivered link of a .docx to a download under its own name', async () => {
    await plant('sub-r2', ANSWERS);
    const res = await controller().file(await deliveredToken('sub-r2', 'letter'));
    expect(res.disposition).toBe('attachment');
    expect(res.url).toContain('as=attachment');
    expect(res.url).toContain(encodeURIComponent('Cover letter.docx'));
  });

  it('answers one identical 404 for a forged token and for a deleted submission', async () => {
    await plant('sub-r3', ANSWERS);
    const token = await deliveredToken('sub-r3', 'cv');
    const forged = `${token.slice(0, -1)}${token.endsWith('A') ? 'B' : 'A'}`;
    expect(await notFound(controller().file(forged))).toEqual(MISS);
    expect(await notFound(controller().file('not-a-token'))).toEqual(MISS);

    await db.run(sql`DELETE FROM submission WHERE id = 'sub-r3'`);
    expect(await notFound(controller().file(token))).toEqual(MISS);
  });

  it('stops honouring every link when the key changes', async () => {
    await plant('sub-r4', ANSWERS);
    const token = await deliveredToken('sub-r4', 'cv');
    const rotated = { ...ENV, FORMS_ENCRYPTION_KEY: randomBytes(32).toString('base64') };
    expect(await notFound(controller(rotated).file(token))).toEqual(MISS);
  });

  it('404s every link on a deployment with no key, without failing anything else', async () => {
    await plant('sub-r5', ANSWERS);
    const token = await deliveredToken('sub-r5', 'cv');
    const keyless = { ...ENV, FORMS_ENCRYPTION_KEY: undefined };
    expect(await notFound(controller(keyless).file(token))).toEqual(MISS);
  });

  it('is behind the public rate limit', () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, PublicController) as unknown[];
    expect(guards).toContain(RateLimitGuard);
  });
});
