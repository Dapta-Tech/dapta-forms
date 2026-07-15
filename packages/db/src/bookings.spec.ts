/**
 * Draft/publish workflow + booking events (pilot port, phase 1). Draft saves
 * never touch the live config; publish copies draft→config atomically, stamps
 * published_at, and clears the draft (idempotent when no draft is pending).
 * Booking events are recorded per (form, session) and listed back in order.
 * Honors DATABASE_URL like the submission-integrity spec, so the Postgres
 * parity job exercises the same flow; locally it runs on in-memory SQLite.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { createDb, type Db } from './client';
import { migrate } from './migrate';
import { getFormById, publishForm, saveDraftConfig } from './forms';
import { insertBookingEvent, listBookingEvents } from './bookings';

let db: Db;
let accountId: string;
let formId: string;

const LIVE_CONFIG = { version: 1, steps: [] };
const DRAFT_CONFIG = { version: 1, steps: [{ key: 'q1', type: 'text' }] };

beforeEach(async () => {
  db = await createDb(process.env.DATABASE_URL ?? 'file::memory:');
  await migrate(db);
  accountId = randomUUID();
  formId = randomUUID();
  const now = Date.now();
  await db.run(
    sql`INSERT INTO account (id, code, name, created_at) VALUES (${accountId}, ${'t' + accountId.slice(0, 5)}, ${'Test'}, ${now})`,
  );
  await db.run(
    sql`INSERT INTO form (id, account_id, name, slug, config, created_at, updated_at)
        VALUES (${formId}, ${accountId}, ${'F'}, ${'f'}, ${JSON.stringify(LIVE_CONFIG)}, ${now}, ${now})`,
  );
});

afterEach(async () => {
  // Leave a shared Postgres database clean (memory SQLite just evaporates).
  await db.run(sql`DELETE FROM booking_event WHERE form_id = ${formId}`);
  await db.run(sql`DELETE FROM form WHERE id = ${formId}`);
  await db.run(sql`DELETE FROM account WHERE id = ${accountId}`);
  await db.close();
});

describe('draft + publish', () => {
  it('saveDraftConfig stores the draft WITHOUT touching the live config', async () => {
    const out = await saveDraftConfig(db, accountId, formId, DRAFT_CONFIG);
    expect(out.ok).toBe(true);
    const form = await getFormById(db, accountId, formId);
    expect(form!.draftConfig).toEqual(DRAFT_CONFIG);
    expect(form!.config).toEqual(LIVE_CONFIG); // live config untouched
    expect(form!.publishedAt).toBeNull();
  });

  it('publishForm copies draft→config, stamps published_at, clears the draft', async () => {
    await saveDraftConfig(db, accountId, formId, DRAFT_CONFIG);
    const out = await publishForm(db, accountId, formId);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.value.config).toEqual(DRAFT_CONFIG); // draft went live
    expect(out.value.draftConfig).toBeNull(); // draft cleared
    expect(out.value.publishedAt).not.toBeNull();
  });

  it('publishForm with NO pending draft is a no-op', async () => {
    const out = await publishForm(db, accountId, formId);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.value.config).toEqual(LIVE_CONFIG); // unchanged
    expect(out.value.draftConfig).toBeNull();
    expect(out.value.publishedAt).toBeNull(); // never published
  });

  it('draft + publish are account-scoped (a foreign account gets NOT_FOUND)', async () => {
    const stranger = randomUUID();
    expect((await saveDraftConfig(db, stranger, formId, DRAFT_CONFIG)).ok).toBe(false);
    expect((await publishForm(db, stranger, formId)).ok).toBe(false);
    const form = await getFormById(db, accountId, formId);
    expect(form!.draftConfig).toBeNull(); // nothing leaked through
  });
});

describe('booking events', () => {
  it('inserts and lists booking events per (form, session)', async () => {
    const start = Date.parse('2026-08-01T15:00:00Z');
    const row = await insertBookingEvent(db, {
      formId,
      sessionId: 'sess-1',
      provider: 'calendly',
      eventUri: 'https://api.calendly.com/scheduled_events/abc',
      inviteeUri: 'https://api.calendly.com/scheduled_events/abc/invitees/def',
      startTime: start,
      payload: { sessionId: 'sess-1', provider: 'calendly' },
    });
    expect(row.id).toBeTruthy();
    expect(row.provider).toBe('calendly');
    expect(row.startTime).toBe(start);
    expect(row.payload).toEqual({ sessionId: 'sess-1', provider: 'calendly' });

    // A second event for ANOTHER session must not show up in this session's list.
    await insertBookingEvent(db, { formId, sessionId: 'sess-2', provider: 'hubspot_meetings' });

    const listed = await listBookingEvents(db, formId, 'sess-1');
    expect(listed).toHaveLength(1);
    expect(listed[0]!.id).toBe(row.id);
    expect(listed[0]!.eventUri).toBe('https://api.calendly.com/scheduled_events/abc');
  });

  it('optional fields default to null', async () => {
    const row = await insertBookingEvent(db, {
      formId,
      sessionId: 'sess-min',
      provider: 'hubspot_meetings',
    });
    expect(row.eventUri).toBeNull();
    expect(row.inviteeUri).toBeNull();
    expect(row.startTime).toBeNull();
    expect(row.payload).toBeNull();
  });
});
