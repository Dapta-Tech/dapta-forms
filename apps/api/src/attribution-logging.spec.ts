/**
 * What the attribution failure path is allowed to write to the log.
 *
 * A login that could not record where it came from must not become a 500, so
 * the claim is caught and swallowed. The line it leaves behind used to carry the
 * account id and the raw driver error — a customer identifier plus whatever the
 * dependency felt like saying, which for a database driver can be a row, a
 * connection string, or a vendor message.
 *
 * The line stays (operators need to know claims are failing), but it says only
 * that: a stable event name and the error's class.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { createDb, migrate, sql, type Db } from '@quill/db';
import { AdminCrudController } from './admin-crud.controller';
import type { AuthService, ReqLike } from './auth.service';

const SECRET_MESSAGE =
  'connect ECONNREFUSED postgres://quill:hunter2@db.internal:5432 — row {"email":"alex@example.com"}';

describe('attribution claim logging', () => {
  let db: Db;
  let accountId: string;
  let warnings: string[];

  beforeEach(async () => {
    warnings = [];
    vi.spyOn(Logger.prototype, 'warn').mockImplementation((message: unknown) => {
      warnings.push(String(message));
    });
    db = await createDb('file::memory:');
    await migrate(db);
    accountId = randomUUID();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await db.close();
  });

  /** A controller whose attribution claim always fails with a chatty error. */
  function controller(): AdminCrudController {
    const failing = {
      dialect: db.dialect,
      all: async () => {
        throw new TypeError(SECRET_MESSAGE);
      },
      get: async () => {
        throw new TypeError(SECRET_MESSAGE);
      },
      run: async () => {
        throw new TypeError(SECRET_MESSAGE);
      },
      execRaw: async () => undefined,
      close: async () => undefined,
    } as unknown as Db;
    const auth = {
      resolveHost: async () => ({ accountId, memberId: randomUUID(), role: 'owner' }),
    } as unknown as AuthService;
    return new AdminCrudController(failing, auth, {} as never, {} as never, {} as never);
  }

  it('does not put the account identifier in the log', async () => {
    await controller().recordAttribution({} as ReqLike, { utmSource: 'newsletter' });

    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings.join('\n')).not.toContain(accountId);
  });

  it('does not repeat what the dependency said', async () => {
    await controller().recordAttribution({} as ReqLike, { utmSource: 'newsletter' });

    const line = warnings.join('\n');
    expect(line).not.toContain('hunter2');
    expect(line).not.toContain('postgres://');
    expect(line).not.toContain('alex@example.com');
    expect(line).not.toContain(SECRET_MESSAGE);
  });

  it('still says a claim failed, with a stable name and the error class', async () => {
    await controller().recordAttribution({} as ReqLike, { utmSource: 'newsletter' });

    const line = warnings.join('\n');
    expect(line).toContain('attribution_claim_failed');
    expect(line).toContain('TypeError');
  });

  it('keeps the login working — a failed claim is not a failed request', async () => {
    const res = await controller().recordAttribution({} as ReqLike, { utmSource: 'newsletter' });

    expect(res).toMatchObject({ recorded: false });
  });
});
