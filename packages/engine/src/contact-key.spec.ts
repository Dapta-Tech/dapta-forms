/**
 * Whether a form can hand the CRM an address to key its contact on — the config
 * half AND the connection half, which is the pair the admin screens got wrong:
 * they promised the sync purely because a scheduler step existed.
 */
import { describe, it, expect } from 'vitest';
import {
  INVITEE_FIELDS,
  bookingFieldsFor,
  contactKeyReadiness,
  emailMappingsConflictingWithScheduler,
  emailSourceFor,
  type FormConfig,
} from './form-logic';

function config(steps: Array<Record<string, unknown>>): FormConfig {
  return { version: 1, steps } as unknown as FormConfig;
}

const EMAIL_STEP = { key: 'email', type: 'email', question: 'Your email' };
const SCHEDULER_STEP = { key: 'book', type: 'scheduler', question: 'Pick a time' };
const PLAIN_STEP = { key: 'company', type: 'text', question: 'Company' };

describe('contactKeyReadiness', () => {
  it('is blocked when the form asks for no address and books nothing', () => {
    const r = contactKeyReadiness(config([PLAIN_STEP]), { scheduler: true });
    expect(r).toEqual({ ok: false, blocker: 'no_source', source: null });
  });

  it('is ready on an email question regardless of the scheduling provider', () => {
    for (const scheduler of [true, false]) {
      const r = contactKeyReadiness(config([EMAIL_STEP, PLAIN_STEP]), { scheduler });
      expect(r).toEqual({ ok: true, source: { kind: 'question', key: 'email' } });
    }
  });

  it('is ready on a scheduler only while its provider is connected', () => {
    const c = config([PLAIN_STEP, SCHEDULER_STEP]);
    expect(contactKeyReadiness(c, { scheduler: true })).toEqual({
      ok: true,
      source: { kind: 'scheduler', key: 'book' },
    });
    // The config is unchanged and still valid — what is missing is the token
    // that reads the invitee back. Without it the booking succeeds and the lead
    // never reaches the CRM, so this must NOT read as ready.
    expect(contactKeyReadiness(c, { scheduler: false })).toEqual({
      ok: false,
      blocker: 'scheduler_disconnected',
      source: { kind: 'scheduler', key: 'book' },
    });
  });

  it('an email question outranks a scheduler, so a disconnected provider is irrelevant', () => {
    const c = config([EMAIL_STEP, SCHEDULER_STEP]);
    expect(emailSourceFor(c)).toEqual({ kind: 'question', key: 'email' });
    expect(contactKeyReadiness(c, { scheduler: false }).ok).toBe(true);
  });
});

describe('emailMappingsConflictingWithScheduler', () => {
  const schedulerSource = { kind: 'scheduler', key: 'book' } as const;

  it('names every question pointed at the email property', () => {
    expect(
      emailMappingsConflictingWithScheduler(schedulerSource, {
        company: 'company',
        work: 'email',
        alt: '  EMAIL  ',
      }),
    ).toEqual(['work', 'alt']);
  });

  it('is silent when nothing is mapped to email', () => {
    expect(
      emailMappingsConflictingWithScheduler(schedulerSource, { company: 'company' }),
    ).toEqual([]);
    expect(emailMappingsConflictingWithScheduler(schedulerSource, undefined)).toEqual([]);
  });

  // With an email QUESTION the adapter is supposed to resolve the address
  // itself — mapping a question to `email` is the correct setup, not a conflict.
  it('is silent when the address comes from a question', () => {
    expect(
      emailMappingsConflictingWithScheduler({ kind: 'question', key: 'email' }, { email: 'email' }),
    ).toEqual([]);
    expect(emailMappingsConflictingWithScheduler(null, { work: 'email' })).toEqual([]);
  });
});

describe('bookingFieldsFor', () => {
  it('leads with the scheduler own key — that is where the meeting time lands', () => {
    const fields = bookingFieldsFor('book');
    expect(fields[0]).toEqual({ key: 'book', kind: 'start_time' });
  });

  it('carries the invitee identity under the @-prefixed keys the sync writes', () => {
    expect(bookingFieldsFor('book')).toEqual([
      { key: 'book', kind: 'start_time' },
      { key: INVITEE_FIELDS.name, kind: 'name' },
      { key: INVITEE_FIELDS.first_name, kind: 'first_name' },
      { key: INVITEE_FIELDS.last_name, kind: 'last_name' },
      { key: INVITEE_FIELDS.phone, kind: 'phone' },
    ]);
  });

  // The address is the contact KEY the booking supplies. Offering it as a
  // mappable field is what `emailMappingsConflictingWithScheduler` exists to
  // catch after the fact — the list must not put it there in the first place.
  it('never offers the invitee email as a mappable field', () => {
    const keys = bookingFieldsFor('book').map((f) => f.key);
    expect(keys).not.toContain('email');
    expect(keys.some((k) => k.toLowerCase().includes('email'))).toBe(false);
  });

  // Only the first entry is the step's; the rest are fixed system keys, so two
  // schedulers in one form share the invitee rows and differ on the time row.
  it('rekeys only the meeting time when the scheduler step is renamed', () => {
    const before = bookingFieldsFor('book');
    const after = bookingFieldsFor('demo_slot');
    expect(after[0]!.key).toBe('demo_slot');
    expect(after.slice(1)).toEqual(before.slice(1));
  });

  // `@` is outside the step-key grammar, so a question can never collide with
  // one of these — the guarantee INVITEE_FIELDS documents, asserted here.
  it('keeps the system keys outside the step-key grammar', () => {
    for (const f of bookingFieldsFor('book').slice(1)) {
      expect(f.key.startsWith('@')).toBe(true);
    }
  });
});
