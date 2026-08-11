/**
 * The onboarding wizard's question bank.
 *
 * Each question is a real `FormStep` — the same shape a form author's questions
 * have — so the wizard renders through `StepInput`, the product's own renderer,
 * rather than a lookalike built beside it. That is the point: the first thing a
 * new user sees IS a Dapta form, and it cannot drift away from one, because a
 * change to how forms render changes this screen too.
 *
 * Values are the enums the API validates against (@quill/types); labels come
 * from the i18n catalog at render time. Keeping copy out of here is what lets
 * the same bank serve both locales without a parallel Spanish structure that
 * could silently drift out of step with the English one.
 */
import type { FormsMessages } from '@quill/shared';
import type { FormStep } from '@quill/engine';
import {
  ONBOARDING_COHORTS,
  ONBOARDING_CRMS,
  ONBOARDING_INDUSTRIES,
  ONBOARDING_LEAD_SOURCES,
  ONBOARDING_LEAD_VOLUMES,
  ONBOARDING_STEPS,
  ONBOARDING_USE_CASES,
  FORM_TEMPLATE_IDS,
  type FormTemplateId,
  type OnboardingCohort,
  type OnboardingStep,
} from '@quill/types';

type OnboardingMessages = FormsMessages['admin']['onboarding'];

/** Every step that is a QUESTION — `template` is the picker, not one of these. */
export type WizardQuestionKey = Exclude<OnboardingStep, 'template'>;

export interface WizardQuestion {
  key: WizardQuestionKey;
  /** Which `OnboardingProgress` field this question's answer patches. */
  field: 'role' | 'industry' | 'useCase' | 'crm' | 'phone' | 'leadVolume' | 'leadSource';
  /** The step `StepInput` renders — a real form question, not a lookalike. */
  step: FormStep;
  /**
   * May this one be passed over? Only the phone screen can be. Every other
   * question is three taps, and an answer that can be skipped is an answer most
   * people skip — which would leave the column this whole feature exists to fill
   * mostly empty. A phone number is the one real keyboard in the flow, so
   * refusing it has to stay an option, and "asked and declined" is itself a fact
   * worth storing.
   */
  skippable?: boolean;
}

/**
 * One glyph per lead source, keyed by the enum so a new source cannot ship
 * without one. `none` gets the empty-state mark rather than a channel logo —
 * "no leads yet" is an answer, not a channel.
 */
const LEAD_SOURCE_ICONS: Readonly<Record<(typeof ONBOARDING_LEAD_SOURCES)[number], string>> = {
  none: '\u{1F331}',
  facebook_ads: '\u{1F4D8}',
  google_ads: '\u{1F50E}',
  outbound: '\u{1F4E4}',
  internal_lists: '\u{1F4C7}',
  other: '\u{2728}',
};

const USE_CASE_ICONS: Readonly<Record<(typeof ONBOARDING_USE_CASES)[number], string>> = {
  leads: '\u{1F3AF}',
  feedback: '\u{1F4DD}',
  event: '\u{1F39F}',
  application: '\u{1F4C4}',
  other: '\u{2728}',
};

/**
 * Every question the wizard knows how to ask, in canonical order.
 *
 * `wizardQuestions` selects from this by cohort — nobody is shown all of it.
 * Order matches `ONBOARDING_STEPS`, which is what keeps `lastStep` monotonic and
 * both cohorts subsequences of one another.
 */
function allQuestions(m: OnboardingMessages): WizardQuestion[] {
  return [
    {
      // FIRST, and only for a cold signup. The wording is Dapta's own, verbatim:
      // a neutral field label under "tell us about you", never a verb. "What
      // number should we call you on?" announces a sales call, and the honest
      // answer to that is no — so it is not what either product asks.
      key: 'phone',
      field: 'phone',
      skippable: true,
      // The field LABEL ("Your phone number") is not on the step: `FormStep` has
      // no such field, and inventing one would put a wizard-only concept into
      // the form config contract. The wizard renders it beside the input.
      step: {
        key: 'phone',
        type: 'phone',
        question: m.phone.question,
        helper: m.phone.helper,
        placeholder: m.phone.placeholder,
      },
    },
    {
      // Second, deliberately. It is the most "for us" of the three, and the
      // middle is where an unglamorous question costs the least.
      key: 'industry',
      field: 'industry',
      step: {
        key: 'industry',
        type: 'dropdown',
        question: m.industry.question,
        helper: m.industry.helper,
        placeholder: m.industry.placeholder,
        options: ONBOARDING_INDUSTRIES.map((value) => ({
          value,
          label: m.industry.options[value],
        })),
      },
    },
    {
      // Cold cohort only — someone arriving from Dapta answered this in the
      // IAM's own `crm_usage` question. It is also the one answer here that is
      // an ACTION rather than a segment: Forms already syncs to HubSpot, so
      // "hubspot" is a connection to offer on day one.
      key: 'crm',
      field: 'crm',
      step: {
        key: 'crm',
        type: 'dropdown',
        question: m.crm.question,
        helper: m.crm.helper,
        placeholder: m.industry.placeholder,
        options: ONBOARDING_CRMS.map((value) => ({
          value,
          label: m.crm.options[value],
        })),
      },
    },
    {
      // Cold cohort only — someone arriving from Dapta answered this in the
      // IAM's own `contacts_per_month` question, and the buckets here are that
      // question's, verbatim, so the two products' answers can be added up.
      key: 'lead_volume',
      field: 'leadVolume',
      step: {
        key: 'lead_volume',
        type: 'multiple_choice',
        question: m.leadVolume.question,
        helper: m.leadVolume.helper,
        optionLayout: 'list',
        options: ONBOARDING_LEAD_VOLUMES.map((value) => ({
          value,
          label: m.leadVolume.options[value],
        })),
      },
    },
    {
      // Asked of EVERYONE, including people from Dapta — the IAM has no
      // equivalent, so it is the only thing here nobody can answer on their
      // behalf, and the only genuinely new signal Forms sends back.
      key: 'lead_source',
      field: 'leadSource',
      step: {
        key: 'lead_source',
        type: 'multiple_choice',
        question: m.leadSource.question,
        helper: m.leadSource.helper,
        optionLayout: 'list',
        options: ONBOARDING_LEAD_SOURCES.map((value) => ({
          value,
          label: m.leadSource.options[value],
          icon: LEAD_SOURCE_ICONS[value],
        })),
      },
    },
    {
      // Last, and adjacent to the template picker on purpose: this answer
      // pre-selects a card on the very next screen, so the momentum carries.
      key: 'use_case',
      field: 'useCase',
      step: {
        key: 'use_case',
        type: 'multiple_choice',
        question: m.useCase.question,
        helper: m.useCase.helper,
        optionLayout: 'cards',
        showIcons: true,
        options: ONBOARDING_USE_CASES.map((value) => ({
          value,
          label: m.useCase.options[value],
          icon: USE_CASE_ICONS[value],
        })),
      },
    },
  ];
}

/**
 * The questions THIS person is asked, in order.
 *
 * A cold signup answers all five; someone arriving from Dapta AI answers two.
 * The difference is not a shortcut — Dapta's `pre_signup` bank already holds
 * their industry, their CRM and a phone number, and re-asking is the plainest
 * way to tell a customer that the two products do not talk to each other.
 *
 * Role and use case survive for both, because Dapta asks neither: it collects no
 * role at all, and its `dapta_goals` question is about voice and text agents,
 * not about what someone wants a FORM for.
 *
 * Everything downstream — the counter, `lastStep`, the drop-off buckets — reads
 * the length of THIS list rather than a constant, so the two cohorts cannot end
 * up counted against each other's denominator.
 */
export function wizardQuestions(m: OnboardingMessages, cohort: OnboardingCohort): WizardQuestion[] {
  const wanted: readonly OnboardingStep[] = ONBOARDING_COHORTS[cohort];
  return allQuestions(m).filter((q) => wanted.includes(q.key));
}

/**
 * The steps this cohort never sees but ANOTHER cohort does — so the blob can
 * record why each is empty.
 *
 * Derived from the union of the cohorts rather than from `ONBOARDING_STEPS`,
 * which still carries `role`. Role is not skipped for anyone; it is simply no
 * longer a question, and calling that "skipped" would put a reason next to a
 * field nobody was ever going to be asked about.
 */
export function skippedQuestions(cohort: OnboardingCohort): WizardQuestionKey[] {
  const wanted: readonly OnboardingStep[] = ONBOARDING_COHORTS[cohort];
  const askable = new Set<OnboardingStep>(Object.values(ONBOARDING_COHORTS).flat());
  return ONBOARDING_STEPS.filter(
    (s): s is WizardQuestionKey => askable.has(s) && !wanted.includes(s),
  );
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
