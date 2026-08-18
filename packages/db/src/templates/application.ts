/**
 * TEMPLATE — Applications and requests. Offered to whoever answers "take
 * applications or requests" in the onboarding wizard.
 *
 * Covers both halves of that answer on purpose: a job application and an inbound
 * work request ask the same shape of question (who are you, what for, where can
 * we see your work, when do you need it). Splitting them into two templates
 * would have meant two near-identical configs and one more decision at the
 * moment the person just wants to get going.
 *
 * No file-upload step: `FORM_FIELD_TYPES` has no `file` kind, so the portfolio
 * question asks for a LINK. A template must never reference a step type the
 * engine cannot render.
 */
import type { FormConfig } from '@quill/types';

export const APPLICATION_CONFIG: FormConfig = {
  version: 1,
  branding: { primaryColor: '#0f766e' },
  cover: {
    enabled: true,
    eyebrow: 'We are reading every one',
    headline: 'Tell us what you need',
    subheadline: 'Six questions. No account, no login: just the details so we can get moving.',
    ctaText: 'Start my request',
  },
  steps: [
    {
      key: 'name',
      type: 'name',
      question: 'What is your name?',
      required: true,
      flowGroup: 'lead_capture',
    },
    {
      key: 'email',
      type: 'email',
      question: 'How do we reach you?',
      placeholder: 'you@company.com',
      required: true,
      flowGroup: 'lead_capture',
    },
    {
      key: 'request_type',
      type: 'multiple_choice',
      question: 'What is this about?',
      required: true,
      showIcons: true,
      options: [
        { label: 'A role you are hiring for', value: 'job', icon: '\u{1F4BC}' },
        { label: 'A project or piece of work', value: 'project', icon: '\u{1F6E0}' },
        { label: 'Support with something', value: 'support', icon: '\u{1F198}' },
        { label: 'Something else', value: 'other', icon: '\u{2728}' },
      ],
    },
    {
      key: 'details',
      type: 'textarea',
      question: 'Tell us more',
      placeholder: 'What you need, and anything that would help us understand it.',
      required: true,
    },
    {
      key: 'portfolio',
      type: 'text',
      question: 'Somewhere we can see your work?',
      helper: 'A link to a site, a profile, or a repo. Optional.',
      placeholder: 'https://',
      required: false,
    },
    {
      key: 'timeline',
      type: 'multiple_choice',
      question: 'How soon do you need an answer?',
      required: true,
      options: [
        { label: 'As soon as possible', value: 'asap', icon: '\u{26A1}' },
        { label: 'Within a couple of weeks', value: 'weeks', icon: '\u{1F4C5}' },
        { label: 'No rush', value: 'flexible', icon: '\u{1F60C}' },
      ],
    },
  ],
  ending: {
    headline: 'Got it: thank you',
    body: 'We read every submission and will come back to you at the address you gave us.',
  },
  partialSubmitAfterStep: 2,
};
