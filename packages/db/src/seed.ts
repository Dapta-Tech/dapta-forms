/**
 * Demo seed — a fresh clone shows a working public form immediately.
 * Idempotent: it wipes the demo account and re-inserts, so `pnpm db:seed` can
 * run repeatedly. Everything here is generic sample data (no real people).
 *
 * Seeds: one account ("acme"), one owner member ("alex-rivera"), and one sample
 * form ("Lead Qualifier") with a couple of scored steps and a lead-capture email
 * — enough to exercise the public renderer + submission flow end to end.
 */
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { Db } from './client';
import { jsonParam } from './forms';

export interface SeedResult {
  accountCode: string;
  slug: string;
  formPath: string;
}

const SAMPLE_CONFIG = {
  version: 1 as const,
  cover: {
    enabled: true,
    eyebrow: 'Quick check',
    headline: 'See if we are a fit',
    subheadline: 'Answer a few questions: takes under a minute.',
    ctaText: 'Start',
  },
  steps: [
    {
      key: 'role',
      type: 'dropdown',
      question: 'What best describes you?',
      required: true,
      flowGroup: 'qualification',
      options: [
        { label: 'Founder / Owner', value: 'founder', points: 10 },
        { label: 'Team lead', value: 'lead', points: 6 },
        { label: 'Individual', value: 'individual', points: 2 },
      ],
    },
    {
      key: 'team_size',
      type: 'slider',
      question: 'How big is your team?',
      flowGroup: 'qualification',
      min: 1,
      max: 100,
      default: 5,
      sliderScoring: [
        { min: 1, max: 9, points: 2 },
        { min: 10, max: 100, points: 8 },
      ],
    },
    {
      key: 'company',
      type: 'text',
      question: 'What company do you work at?',
      flowGroup: 'qualification',
      showWhen: { field: 'role', values: ['founder', 'lead'] },
    },
    {
      key: 'email',
      type: 'email',
      question: 'Where should we send the results?',
      required: true,
      flowGroup: 'lead_capture',
    },
  ],
  outcomes: [
    { id: 'nurture', label: 'Nurture', minScore: 0 },
    { id: 'qualified', label: 'Qualified', minScore: 12 },
  ],
};

export async function seed(db: Db): Promise<SeedResult> {
  const accountCode = 'acme';
  const slug = 'lead-qualifier';
  const now = Date.now();

  // Clean prior demo rows (idempotent reseed).
  const prior = await db.get<{ id: string }>(
    sql`SELECT id FROM account WHERE code = ${accountCode} LIMIT 1`,
  );
  if (prior) {
    await db.run(
      sql`DELETE FROM submission WHERE form_id IN (SELECT id FROM form WHERE account_id = ${prior.id})`,
    );
    await db.run(
      sql`DELETE FROM form_event WHERE form_id IN (SELECT id FROM form WHERE account_id = ${prior.id})`,
    );
    await db.run(sql`DELETE FROM form WHERE account_id = ${prior.id}`);
    await db.run(sql`DELETE FROM member WHERE account_id = ${prior.id}`);
    await db.run(sql`DELETE FROM account WHERE id = ${prior.id}`);
  }

  const accountId = randomUUID();
  // `onboarding_completed_at` is stamped, not left NULL, and that is what keeps
  // the zero-infra path in CLAUDE.md true. Migration 0011 backfills every
  // pre-existing account, but `db:setup` runs migrate BEFORE seed, so this row
  // does not exist yet when the backfill sweeps — it would be the one account in
  // the database still owed a wizard. With `ONBOARDING_WIZARD` on by default
  // that means `pnpm dev` lands on `/onboarding` instead of the dashboard, the
  // demo form the seed just wrote is invisible behind the gate, and finishing
  // the wizard adds a SECOND "first" form. Every Playwright spec that navigates
  // to `/admin/...` redirects into the wizard too.
  //
  // The demo account has already been onboarded by definition: it ships with a
  // form.
  await db.run(
    sql`INSERT INTO account (id, code, name, created_at, onboarding_completed_at)
        VALUES (${accountId}, ${accountCode}, ${'Acme Inc.'}, ${now}, ${now})`,
  );
  await db.run(
    sql`INSERT INTO member (id, account_id, handle, display_name, email, role, status, created_at)
        VALUES (${randomUUID()}, ${accountId}, ${'alex-rivera'}, ${'Alex Rivera'},
          ${'alex@example.com'}, ${'owner'}, ${'active'}, ${now})`,
  );
  await db.run(
    sql`INSERT INTO form (id, account_id, name, slug, config, created_at, updated_at)
        VALUES (${randomUUID()}, ${accountId}, ${'Lead Qualifier'}, ${slug},
          ${jsonParam(SAMPLE_CONFIG)}, ${now}, ${now})`,
  );

  return { accountCode, slug, formPath: `/${accountCode}/alex-rivera/${slug}` };
}
