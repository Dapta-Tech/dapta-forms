/**
 * The onboarding wizard's question bank — SHAPE only.
 *
 * Values are the enums the API validates against (@quill/types); labels come
 * from the i18n catalog at render time. Keeping copy out of here is what lets
 * the same bank serve both locales without a parallel Spanish structure that
 * could silently drift out of step with the English one.
 */
import type { FormsMessages } from '@quill/shared';
import {
  ONBOARDING_INDUSTRIES,
  ONBOARDING_ROLES,
  ONBOARDING_USE_CASES,
  FORM_TEMPLATE_IDS,
  type FormTemplateId,
  type OnboardingStep,
} from '@quill/types';

type OnboardingMessages = FormsMessages['admin']['onboarding'];

export interface WizardOption {
  value: string;
  label: string;
  /** Emoji glyph for the option card; absent on the searchable dropdown. */
  icon?: string;
}

export interface WizardQuestion {
  key: Extract<OnboardingStep, 'role' | 'industry' | 'use_case'>;
  /** Which `OnboardingProgress` field this question's answer patches. */
  field: 'role' | 'industry' | 'useCase';
  /**
   * `list` stacks full-width rows, `cards` renders a tile grid, `search`
   * renders the searchable dropdown. Nine roles as tiles read as a wall of
   * cards next to the five-tile use-case screen two questions later — a list
   * scans top-to-bottom in one pass and keeps the card treatment meaningful
   * where it is actually used.
   */
  layout: 'list' | 'cards' | 'search';
  question: string;
  helper: string;
  options: WizardOption[];
}

/**
 * Per-role glyphs, keyed by the enum so a new role cannot ship without one.
 * Icons are here rather than in the i18n catalog because they are the same in
 * every language — duplicating them per locale would only create a way for the
 * two to disagree.
 */
const ROLE_ICONS: Readonly<Record<(typeof ONBOARDING_ROLES)[number], string>> = {
  sales: '\u{1F4B0}',
  marketing: '\u{1F4E3}',
  support: '\u{1F4AC}',
  product: '\u{1F9ED}',
  founder: '\u{1F680}',
  engineering: '\u{1F4BB}',
  hr: '\u{1F91D}',
  operations: '\u{2699}',
  other: '\u{2728}',
};

const USE_CASE_ICONS: Readonly<Record<(typeof ONBOARDING_USE_CASES)[number], string>> = {
  leads: '\u{1F3AF}',
  feedback: '\u{1F4DD}',
  event: '\u{1F39F}',
  application: '\u{1F4C4}',
  other: '\u{2728}',
};

/** The three questions, in the order they are asked. */
export function wizardQuestions(m: OnboardingMessages): WizardQuestion[] {
  return [
    {
      key: 'role',
      field: 'role',
      layout: 'list',
      question: m.role.question,
      helper: m.role.helper,
      options: ONBOARDING_ROLES.map((value) => ({
        value,
        label: m.role.options[value],
        icon: ROLE_ICONS[value],
      })),
    },
    {
      // Second, deliberately. It is the most "for us" of the three, and the
      // middle is where an unglamorous question costs the least.
      key: 'industry',
      field: 'industry',
      layout: 'search',
      question: m.industry.question,
      helper: m.industry.helper,
      options: ONBOARDING_INDUSTRIES.map((value) => ({
        value,
        label: m.industry.options[value],
      })),
    },
    {
      // Last, and adjacent to the template picker on purpose: this answer
      // pre-selects a card on the very next screen, so the momentum carries.
      key: 'use_case',
      field: 'useCase',
      layout: 'cards',
      question: m.useCase.question,
      helper: m.useCase.helper,
      options: ONBOARDING_USE_CASES.map((value) => ({
        value,
        label: m.useCase.options[value],
        icon: USE_CASE_ICONS[value],
      })),
    },
  ];
}

export interface WizardTemplate {
  id: FormTemplateId;
  name: string;
  description: string;
  icon: string;
}

/**
 * One glyph per template, keyed by the id so a new template cannot ship without
 * one. Deliberately echoes `USE_CASE_ICONS` where the two correspond, so the
 * card the previous answer pre-selects carries the same symbol that answer did.
 */
const TEMPLATE_ICONS: Readonly<Record<FormTemplateId, string>> = {
  'lead-qualifier': '\u{1F3AF}',
  'customer-feedback': '\u{1F4DD}',
  'event-registration': '\u{1F39F}',
  application: '\u{1F4C4}',
  blank: '\u{270D}',
};

/**
 * The template cards, in offer order. `blank` is forced LAST regardless of where
 * it sits in the enum: it is the fallback, and a fallback above real options
 * reads as the recommended path.
 */
export function wizardTemplates(m: OnboardingMessages): WizardTemplate[] {
  const ids = FORM_TEMPLATE_IDS.filter((id) => id !== 'blank');
  return [...ids, 'blank' as const].map((id) => ({
    id,
    name: m.templates.options[id].name,
    description: m.templates.options[id].description,
    icon: TEMPLATE_ICONS[id],
  }));
}

/** Interpolate `{key}` placeholders — the same convention the renderer uses. */
export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in values ? String(values[key]) : match,
  );
}
