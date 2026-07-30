/**
 * Whether a form can hand the CRM an address to key its contact on — the config
 * half AND the connection half, which is the pair the admin screens got wrong:
 * they promised the sync purely because a scheduler step existed.
 */
import { describe, it, expect } from 'vitest';
import {
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
