/**
 * The wizard's question bank, per cohort.
 *
 * What is actually worth pinning here is not that the lists are right — a diff
 * shows that — but that everything downstream DERIVES from them. The counter,
 * `lastStep`, and the drop-off buckets all read the selected list, so a cohort
 * whose length disagrees with what is rendered silently counts one group against
 * the other's denominator.
 */
import { describe, it, expect } from 'vitest';
import { getMessages } from '@quill/shared';
import { ONBOARDING_CRMS, ONBOARDING_INDUSTRIES, ONBOARDING_STEPS } from '@quill/types';
import { skippedQuestions, wizardQuestions } from './onboarding';

const m = getMessages('en').admin.onboarding;
const keys = (cohort: 'cold' | 'dapta') => wizardQuestions(m, cohort).map((q) => q.key);

describe('wizardQuestions — who is asked what', () => {
  it('asks a cold signup everything, phone first', () => {
    expect(keys('cold')).toEqual([
      'phone',
      'industry',
      'crm',
      'lead_volume',
      'lead_source',
      'use_case',
    ]);
  });

  it('asks someone from Dapta only what Dapta CANNOT answer for them', () => {
    // Industry, CRM, lead volume and a phone number are all in Dapta's own
    // signup. Re-asking is the plainest way to tell a customer the two products
    // do not talk to each other.
    //
    // The two that survive do so for opposite reasons: `lead_source` has no
    // equivalent anywhere in the IAM, and `use_case` is what preselects a
    // template on the next screen.
    expect(keys('dapta')).toEqual(['lead_source', 'use_case']);
  });

  it('never asks for a role — the field lives on only so old blobs still parse', () => {
    expect(keys('cold')).not.toContain('role');
    expect(keys('dapta')).not.toContain('role');
    // Still a legal step value: accounts onboarded before this release carry
    // `lastStep: 'role'`, and the blob is validated in one pass — dropping it
    // from the union would make those rows unreadable and take `industry` and
    // `useCase` down with it.
    expect(ONBOARDING_STEPS).toContain('role');
  });

  it('keeps both cohorts in canonical step order', () => {
    // `lastStep` is only ever allowed to ADVANCE along ONBOARDING_STEPS, so a
    // cohort that asked out of order would produce a bucket that can never be
    // reached — the wizard would appear to stall on one screen forever.
    for (const cohort of ['cold', 'dapta'] as const) {
      const positions = keys(cohort).map((k) => ONBOARDING_STEPS.indexOf(k));
      expect([...positions].sort((a, b) => a - b), cohort).toEqual(positions);
    }
  });

  it('lets ONLY the phone screen be skipped', () => {
    const skippable = wizardQuestions(m, 'cold')
      .filter((q) => q.skippable)
      .map((q) => q.key);
    expect(skippable).toEqual(['phone']);
  });

  it('names the steps a cohort never sees, so the blob can say why they are empty', () => {
    expect(skippedQuestions('dapta').sort()).toEqual([
      'crm',
      'industry',
      'lead_volume',
      'phone',
    ]);
    // A cold signup is shown every question there is.
    expect(skippedQuestions('cold')).toEqual([]);
    // `role` is not "skipped" for anyone — it is no longer a question at all, so
    // it never gets a reason recorded beside it.
    expect(skippedQuestions('dapta')).not.toContain('role');
  });

  it('labels every option from the catalog — no value renders as its own key', () => {
    const industry = wizardQuestions(m, 'cold').find((q) => q.key === 'industry');
    const crm = wizardQuestions(m, 'cold').find((q) => q.key === 'crm');
    expect(industry?.step.options).toHaveLength(ONBOARDING_INDUSTRIES.length);
    expect(crm?.step.options).toHaveLength(ONBOARDING_CRMS.length);
    for (const opt of [...(industry?.step.options ?? []), ...(crm?.step.options ?? [])]) {
      expect(opt.label, opt.value).toBeTruthy();
      expect(opt.label, opt.value).not.toBe(opt.value);
    }
  });

  it('carries the IAM bank verbatim, so the two products join', () => {
    // Spot-checks rather than the whole list: these are the values that used to
    // be Forms-only inventions (`software`, `agency`, `realestate`).
    for (const v of ['computer_software', 'marketing_advertising', 'real_estate', 'hubspot']) {
      expect([...ONBOARDING_INDUSTRIES, ...ONBOARDING_CRMS]).toContain(v);
    }
    // The bank ships `none` AND `no_crm` for the same answer. Offering both would
    // split the one segment that matters most across two values.
    expect(ONBOARDING_CRMS).not.toContain('no_crm');
  });
});
