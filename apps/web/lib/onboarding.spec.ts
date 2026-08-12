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
import {
  LEAD_VOLUME_SLIDER,
  leadVolumeBucket,
  skippedQuestions,
  stepIndexFromSearch,
  stepParam,
  wizardQuestions,
} from './onboarding';

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

  it('lets NOTHING be skipped — the phone included', () => {
    // Decided 11-ago: the phone number is what the Dapta pipeline creates the
    // HubSpot contact from, so a skippable phone is a contact that never
    // exists. The flag is gone from the type; this pins that it stays gone.
    for (const q of wizardQuestions(m, 'cold')) {
      expect(q, q.key).not.toHaveProperty('skippable');
    }
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

  it('reorders the CRM cards for display without gaining or losing a value', () => {
    // Display puts the products first and the escape hatches last; the API and
    // the IAM sync still speak the enum. A value dropped here would be silently
    // unpickable; one invented here would be unsyncable.
    const crm = wizardQuestions(m, 'cold').find((q) => q.key === 'crm');
    const values = (crm?.step.options ?? []).map((o) => o.value);
    expect([...values].sort()).toEqual([...ONBOARDING_CRMS].sort());
    expect(values[values.length - 1]).toBe('none');
  });

  it('gives every card an icon — cards without one degrade to bare initials', () => {
    for (const key of ['crm', 'lead_source', 'use_case'] as const) {
      const q = wizardQuestions(m, 'cold').find((x) => x.key === key);
      expect(q?.step.optionLayout, key).toBe('cards');
      for (const opt of q?.step.options ?? []) {
        expect(opt.icon, `${key}:${opt.value}`).toBeTruthy();
      }
    }
  });
});

describe('leadVolumeBucket — the slider folds into the IAM histogram', () => {
  it('maps every boundary to the bucket the IAM means by it', () => {
    expect(leadVolumeBucket(0)).toBe('0_50');
    expect(leadVolumeBucket(50)).toBe('0_50');
    expect(leadVolumeBucket(75)).toBe('51_200');
    expect(leadVolumeBucket(200)).toBe('51_200');
    expect(leadVolumeBucket(500)).toBe('201_500');
    expect(leadVolumeBucket(1000)).toBe('501_1000');
    expect(leadVolumeBucket(4975)).toBe('1001_5000');
  });

  it('reads the top of the rail as "this many or more"', () => {
    // A capped slider could otherwise never produce `5000_plus` — and the
    // person with 20,000 leads can only express it by dragging to the end.
    expect(leadVolumeBucket(LEAD_VOLUME_SLIDER.max)).toBe('5000_plus');
  });

  it('mirrors the rail of the Dapta sales quiz', () => {
    expect(LEAD_VOLUME_SLIDER).toEqual({ min: 0, max: 5000, step: 25, default: 0 });
  });
});

describe('stepParam / stepIndexFromSearch — the URL mirror of the wizard', () => {
  it('counts exactly like the on-screen "Pregunta 1 de N"', () => {
    // 1-based: "?step=0" would put every funnel chart off by one from the copy.
    expect(stepParam(0)).toBe('?step=1');
    expect(stepParam(1)).toBe('?step=2');
  });

  it('gives the template picker the step after the cohort\'s LAST question', () => {
    // Derived, not hardcoded: the two cohorts run different-length wizards, and
    // the URL has to follow the same denominator the counter does.
    for (const cohort of ['cold', 'dapta'] as const) {
      const screens = wizardQuestions(m, cohort).length + 1;
      expect(stepParam(screens - 1), cohort).toBe(`?step=${screens}`);
    }
  });

  it('round-trips its own output', () => {
    for (const index of [0, 1, 5]) {
      expect(stepIndexFromSearch(stepParam(index), 7)).toBe(index);
    }
  });

  it('clamps a URL pointing past the wizard onto the last real screen', () => {
    // The URL is user-editable input. Past the end lands on the template
    // picker, never on an index the wizard has no screen for.
    expect(stepIndexFromSearch('?step=99', 7)).toBe(6);
  });

  it('reads garbage, absence and sub-one steps as the first screen', () => {
    expect(stepIndexFromSearch('?step=0', 7)).toBe(0);
    expect(stepIndexFromSearch('?step=-3', 7)).toBe(0);
    expect(stepIndexFromSearch('?step=banana', 7)).toBe(0);
    expect(stepIndexFromSearch('', 7)).toBe(0);
    expect(stepIndexFromSearch('?utm_source=landing', 7)).toBe(0);
  });
});
