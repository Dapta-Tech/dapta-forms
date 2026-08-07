/**
 * TEMPLATE — Lead qualifier. Offered to whoever answers "get more customers and
 * leads" in the onboarding wizard.
 *
 * The one template that exercises SCORING end to end: every qualifying answer
 * carries points, and two outcome buckets split the results. That is deliberate
 * — scoring is the feature a lead-gen user came for, and a template that ships
 * it switched off teaches them the product does not have it.
 *
 * Copy is English (the OSS default); Spanish parity lives beside it in
 * `TEMPLATE_COPY_ES` (see ./copy-es.ts) for anyone localizing a fork.
 */
import type { FormConfig } from '@quill/types';

export const LEAD_QUALIFIER_CONFIG: FormConfig = {
  version: 1,
  branding: { primaryColor: '#2563eb' },
  cover: {
    enabled: true,
    eyebrow: 'Two minutes, tops',
    headline: 'Let us see if we are a fit',
    subheadline:
      'A few quick questions so we can point you at the right thing instead of a generic demo.',
    ctaText: 'Get started',
    trustBadge: 'No credit card, no sales call unless you ask for one',
  },
  steps: [
    {
      key: 'role',
      type: 'multiple_choice',
      question: 'What best describes you?',
      required: true,
      showIcons: true,
      flowGroup: 'qualification',
      options: [
        { label: 'Founder or owner', value: 'founder', icon: '\u{1F680}', points: 10 },
        { label: 'Team lead or manager', value: 'lead', icon: '\u{1F9ED}', points: 7 },
        { label: 'Individual contributor', value: 'individual', icon: '\u{1F464}', points: 3 },
        { label: 'Just exploring', value: 'exploring', icon: '\u{1F440}', points: 1 },
      ],
    },
    {
      key: 'team_size',
      type: 'slider',
      question: 'How many people are on your team?',
      helper: 'Drag to the closest number.',
      flowGroup: 'qualification',
      min: 1,
      max: 100,
      step: 1,
      default: 5,
      sliderUnitLabel: 'people',
      sliderScoring: [
        { min: 1, max: 4, points: 2 },
        { min: 5, max: 24, points: 6 },
        { min: 25, max: 100, points: 10 },
      ],
    },
    {
      key: 'timeline',
      type: 'multiple_choice',
      question: 'When are you looking to get started?',
      required: true,
      flowGroup: 'qualification',
      options: [
        { label: 'This month', value: 'now', icon: '\u{1F525}', points: 10 },
        { label: 'This quarter', value: 'quarter', icon: '\u{1F4C5}', points: 6 },
        { label: 'Sometime this year', value: 'year', icon: '\u{1F5D3}', points: 3 },
        { label: 'Just researching', value: 'research', icon: '\u{1F4DA}', points: 0 },
      ],
    },
    {
      key: 'challenge',
      type: 'textarea',
      question: 'What are you trying to solve?',
      placeholder: 'A sentence is plenty — it helps us skip the generic pitch.',
      required: false,
      flowGroup: 'qualification',
    },
    {
      key: 'name',
      type: 'name',
      question: 'Last thing — who are we talking to?',
      required: true,
      flowGroup: 'lead_capture',
    },
    {
      key: 'email',
      type: 'email',
      question: 'Where should we send the results?',
      placeholder: 'you@company.com',
      required: true,
      flowGroup: 'lead_capture',
    },
  ],
  scoring: { enabled: true },
  outcomes: [
    {
      id: 'nurture',
      label: 'Thanks — we will be in touch',
      minScore: 0,
      message: 'We will send over a few things worth reading while you decide.',
    },
    {
      id: 'qualified',
      label: 'You are exactly who we built this for',
      minScore: 20,
      message: 'Keep an eye on your inbox — someone from the team will reach out today.',
    },
  ],
  partialSubmitAfterStep: 4,
};
