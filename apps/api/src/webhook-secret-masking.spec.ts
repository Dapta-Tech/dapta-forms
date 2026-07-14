/**
 * The admin READ surface must never echo a stored webhook signing secret in
 * plaintext. Drives the real AdminCrudController.getForm over in-memory SQLite
 * and asserts the returned config carries the mask sentinel, not the ciphertext.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  createDb,
  migrate,
  updateFormDestinations,
  sql,
  type Db,
} from '@quill/db';
import { WEBHOOK_SECRET_MASK } from '@quill/types';
import { AdminCrudController } from './admin-crud.controller';
import type { AuthService } from './auth.service';
import type { AdminService } from './admin.service';
import type { SubmissionService } from './submission.service';
import type { AnalyticsService } from './analytics.service';

let db: Db;
let accountId: string;
let formId: string;

beforeEach(async () => {
  db = await createDb('file::memory:');
  await migrate(db);
  accountId = randomUUID();
  formId = randomUUID();
  const now = Date.now();
  await db.run(
    sql`INSERT INTO account (id, code, name, created_at) VALUES (${accountId}, ${'t' + accountId.slice(0, 5)}, ${'Test'}, ${now})`,
  );
  await db.run(
    sql`INSERT INTO form (id, account_id, name, slug, config, created_at, updated_at)
        VALUES (${formId}, ${accountId}, ${'F'}, ${'f'}, ${'{"version":1,"steps":[]}'}, ${now}, ${now})`,
  );
  await updateFormDestinations(db, accountId, formId, [
    { type: 'webhook', enabled: true, settings: { url: 'https://acme.io/hook', secret: 's3cr3t' } },
  ]);
});

afterEach(async () => {
  await db.close();
});

function controller() {
  const auth = {
    resolveHost: async () => ({ accountId, memberId: 'm', role: 'owner' as const }),
  } as unknown as AuthService;
  return new AdminCrudController(
    db,
    auth,
    {} as AdminService,
    {} as SubmissionService,
    {} as AnalyticsService,
  );
}

describe('GET /v1/forms/:id — webhook secret masking', () => {
  it('returns the mask sentinel, never the stored ciphertext', async () => {
    const form = (await controller().getForm({} as never, formId)) as {
      config: { destinations: Array<{ settings: { secret: unknown } }> };
    };
    const secret = form.config.destinations[0]!.settings.secret;
    expect(secret).toBe(WEBHOOK_SECRET_MASK);
    expect(secret).not.toBe('s3cr3t');
  });
});
