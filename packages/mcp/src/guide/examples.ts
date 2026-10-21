import type { FormConfig } from '@quill/types';

/**
 * The form configs the skill's recipes and the MCP guide show. Typed as
 * `FormConfig` so the compiler checks them against the real contract, and
 * validated in the specs against the JSON Schema both ship, so a recipe can
 * never teach an agent a config the API would refuse.
 *
 * Every step has a `question` (the API refuses an empty one on any step but a
 * reveal, message or scheduler) and none uses a field without a control in the
 * editor.
 */

/** A scored quiz: two scored questions, then name and email, and three result ranges. */
export const QUIZ_CONFIG: FormConfig = {
  version: 1,
  title: 'Which plan fits your team?',
  cover: {
    enabled: true,
    headline: 'Find the right plan in one minute',
    subheadline: 'Four quick questions and you get a recommendation.',
    ctaText: 'Start',
  },
  steps: [
    {
      key: 'team_size',
      type: 'multiple_choice',
      question: 'How many people are on your team?',
      required: true,
      options: [
        { label: 'Just me', value: 'solo', points: 0 },
        { label: '2 to 10', value: 'small', points: 5 },
        { label: 'More than 10', value: 'large', points: 10 },
      ],
    },
    {
      key: 'budget',
      type: 'slider',
      question: 'What is your monthly budget in USD?',
      required: true,
      min: 0,
      max: 1000,
      step: 50,
      sliderScoring: [
        { min: 0, max: 199, points: 0 },
        { min: 200, max: 599, points: 5 },
        { min: 600, max: 1000, points: 10 },
      ],
    },
    {
      key: 'name',
      type: 'name',
      question: 'What is your name?',
      required: true,
    },
    {
      key: 'email',
      type: 'email',
      question: 'Where should we send your result?',
      placeholder: 'you@example.com',
      required: true,
    },
  ],
  scoring: { enabled: true },
  outcomes: [
    {
      id: 'starter',
      label: 'Starter',
      minScore: 0,
      maxScore: 7,
      message: '[name], Starter covers a small team. We sent the details to [email].',
    },
    {
      id: 'growth',
      label: 'Growth',
      minScore: 8,
      maxScore: 14,
      message: 'Growth fits a team that is scaling. We sent the details to [email].',
    },
    {
      id: 'scale',
      label: 'Scale',
      minScore: 15,
      message: 'Scale is built for larger teams. Someone will reach out soon.',
      redirectUrl: 'https://example.com/scale',
    },
  ],
};

/**
 * A scored booking form: two scored questions, name and email, then a booking
 * step that only a high score sees. Below 14 points the scheduler is skipped
 * and the form ends on the low outcome's text.
 */
export const SCORE_GATE_CONFIG: FormConfig = {
  version: 1,
  title: 'Book a demo',
  steps: [
    {
      key: 'team_size',
      type: 'multiple_choice',
      question: 'How many people are on your sales team?',
      required: true,
      options: [
        { label: 'Just me', value: 'solo', points: 0 },
        { label: '2 to 10', value: 'small', points: 6 },
        { label: 'More than 10', value: 'large', points: 10 },
      ],
    },
    {
      key: 'timeline',
      type: 'multiple_choice',
      question: 'When do you want to start?',
      required: true,
      options: [
        { label: 'This month', value: 'now', points: 8 },
        { label: 'This quarter', value: 'quarter', points: 4 },
        { label: 'Just looking', value: 'later', points: 0 },
      ],
    },
    { key: 'name', type: 'name', question: 'What is your name?', required: true },
    {
      key: 'email',
      type: 'email',
      question: 'What is your work email, [firstname]?',
      required: true,
    },
    {
      key: 'demo',
      type: 'scheduler',
      question: 'Pick a time for your demo, [name]',
      scheduler: { provider: 'calendly', url: 'https://calendly.com/example/demo' },
      hideWhen: { field: '@score', op: 'lt', value: 14 },
    },
  ],
  scoring: { enabled: true },
  outcomes: [
    {
      id: 'p3',
      label: 'Thanks, [name]',
      minScore: 0,
      maxScore: 13,
      message: 'We will send a few resources to [email].',
    },
    {
      id: 'p1',
      label: 'See you soon, [name]',
      minScore: 14,
      message: 'Your demo is booked. The invite is on its way to [email].',
    },
  ],
};

/** A short lead form, the starting point of the edit recipe. */
export const LEAD_CONFIG: FormConfig = {
  version: 1,
  title: 'Talk to us',
  steps: [
    { key: 'name', type: 'name', question: 'What is your name?', required: true },
    { key: 'email', type: 'email', question: 'What is your work email?', required: true },
    {
      key: 'interest',
      type: 'multiple_choice',
      question: 'What are you interested in?',
      required: true,
      options: [
        { label: 'A demo', value: 'demo' },
        { label: 'Pricing', value: 'pricing' },
        { label: 'Something else', value: 'other' },
      ],
    },
  ],
};

/** `LEAD_CONFIG` after the edit recipe: one question reworded, one option added. */
export const LEAD_CONFIG_EDITED: FormConfig = {
  ...LEAD_CONFIG,
  steps: LEAD_CONFIG.steps.map((step) =>
    step.key === 'interest'
      ? {
          ...step,
          question: 'What brings you here today?',
          options: [...(step.options ?? []), { label: 'A partnership', value: 'partnership' }],
        }
      : step,
  ),
};

/** Every example, by name, for the specs. */
export const EXAMPLE_CONFIGS: Record<string, FormConfig> = {
  quiz: QUIZ_CONFIG,
  scoreGate: SCORE_GATE_CONFIG,
  lead: LEAD_CONFIG,
  leadEdited: LEAD_CONFIG_EDITED,
};
