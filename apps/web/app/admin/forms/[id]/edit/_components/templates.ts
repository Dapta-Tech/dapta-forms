/**
 * Pre-built starting points offered on the guided empty state. Each is a plain
 * v1 `FormConfig` the user immediately edits — zero schema change, and every
 * config is re-validated by the API on save like any hand-built form. The Lead
 * qualifier mirrors the design mockup (Book-a-demo) so it showcases scoring +
 * forward `goto` branching + a scored results map out of the box.
 */
import type { FormConfig } from '@quill/types';
import type { TemplateId } from './builder-messages';

const lead: FormConfig = {
  version: 1,
  steps: [
    {
      key: 'email',
      type: 'email',
      question: 'What’s your work email?',
      helper: 'We’ll tailor the demo and follow up here.',
      placeholder: 'you@company.com',
      required: true,
      corporateEmailOnly: true,
      flowGroup: 'lead_capture',
    },
    {
      key: 'team_size',
      type: 'multiple_choice',
      selectionMode: 'single',
      question: 'How big is your team?',
      helper: 'This helps us tailor the demo to your setup.',
      required: true,
      flowGroup: 'qualification',
      options: [
        { label: 'Just me', value: 'just_me', points: 0 },
        { label: '2–10 people', value: '2_10', points: 2 },
        { label: '11–50 people', value: '11_50', points: 4 },
        { label: '50+ people', value: '50_plus', points: 6 },
      ],
    },
    {
      key: 'main_goal',
      type: 'multiple_choice',
      selectionMode: 'multiple',
      question: 'What’s your main goal?',
      helper: 'Pick all that apply.',
      required: true,
      flowGroup: 'qualification',
      options: [
        { label: 'Capture more leads', value: 'leads', points: 2 },
        { label: 'Qualify faster', value: 'qualify', points: 2 },
        { label: 'Automate follow-up', value: 'automate', points: 2 },
        { label: 'Just exploring', value: 'exploring', points: 0 },
      ],
    },
    {
      key: 'budget',
      type: 'dropdown',
      question: 'What’s your monthly budget?',
      helper: 'Ballpark is fine. It helps us recommend a plan.',
      required: true,
      flowGroup: 'qualification',
      options: [
        { label: 'Under $500 / month', value: 'under_500', points: 0 },
        { label: '$500–$2,000 / month', value: '500_2000', points: 3 },
        { label: '$2,000+ / month', value: 'over_2000', points: 6 },
      ],
      goto: [
        { values: ['under_500'], target: null },
        { values: ['over_2000'], target: 'urgency' },
      ],
    },
    {
      key: 'urgency',
      type: 'slider',
      question: 'How soon do you need this?',
      helper: '0 = just researching, 6 = this month.',
      flowGroup: 'qualification',
      min: 0,
      max: 6,
      step: 1,
      default: 3,
      sliderScoring: [
        { min: 0, max: 2, points: 0 },
        { min: 3, max: 4, points: 3 },
        { min: 5, max: 6, points: 6 },
      ],
    },
    {
      key: 'anything_else',
      type: 'textarea',
      question: 'Anything else we should know?',
      placeholder: 'Optional: context helps us prepare.',
      required: false,
      flowGroup: 'qualification',
    },
  ],
  scoring: { enabled: true },
  outcomes: [
    { id: 'not_a_fit', label: 'Not a fit', minScore: 0, redirectUrl: null },
    { id: 'nurture', label: 'Nurture', minScore: 5, redirectUrl: 'https://example.com/resources/guide' },
    { id: 'book_a_call', label: 'Book a call · hot lead', minScore: 10, redirectUrl: 'https://cal.example.com/demo' },
  ],
  partialSubmitAfterStep: 1,
};

const contact: FormConfig = {
  version: 1,
  steps: [
    {
      key: 'name',
      type: 'name',
      question: 'What’s your name?',
      required: true,
      flowGroup: 'lead_capture',
    },
    {
      key: 'email',
      type: 'email',
      question: 'What’s your email?',
      placeholder: 'you@company.com',
      required: true,
      flowGroup: 'lead_capture',
    },
    {
      key: 'message',
      type: 'textarea',
      question: 'How can we help?',
      placeholder: 'Tell us what you’re looking for…',
      required: true,
      flowGroup: 'qualification',
    },
  ],
  scoring: { enabled: false },
};

const feedback: FormConfig = {
  version: 1,
  steps: [
    {
      key: 'rating',
      type: 'slider',
      question: 'How would you rate your experience?',
      helper: '1 = poor, 5 = excellent.',
      required: true,
      flowGroup: 'qualification',
      min: 1,
      max: 5,
      step: 1,
      default: 4,
      sliderUnitLabel: '/ 5',
    },
    {
      key: 'stood_out',
      type: 'multiple_choice',
      selectionMode: 'single',
      question: 'What stood out the most?',
      required: true,
      flowGroup: 'qualification',
      options: [
        { label: 'Ease of use', value: 'ease' },
        { label: 'Speed', value: 'speed' },
        { label: 'Support', value: 'support' },
        { label: 'Value', value: 'value' },
      ],
    },
    {
      key: 'comments',
      type: 'textarea',
      question: 'What could we do better?',
      placeholder: 'Optional. We read every note.',
      required: false,
      flowGroup: 'qualification',
    },
    {
      key: 'email',
      type: 'email',
      question: 'Want a reply? Leave your email.',
      helper: 'Optional. No spam.',
      placeholder: 'you@company.com',
      required: false,
      flowGroup: 'lead_capture',
    },
  ],
  scoring: { enabled: false },
};

const rsvp: FormConfig = {
  version: 1,
  steps: [
    {
      key: 'name',
      type: 'name',
      question: 'Who’s attending?',
      required: true,
      flowGroup: 'lead_capture',
    },
    {
      key: 'attending',
      type: 'multiple_choice',
      selectionMode: 'single',
      question: 'Will you join us?',
      required: true,
      flowGroup: 'qualification',
      options: [
        { label: 'Yes, I’ll be there', value: 'yes' },
        { label: 'Sorry, can’t make it', value: 'no' },
      ],
      goto: [{ values: ['no'], target: null }],
    },
    {
      key: 'guests',
      type: 'dropdown',
      question: 'How many guests are you bringing?',
      required: true,
      flowGroup: 'qualification',
      options: [
        { label: 'Just me', value: '0' },
        { label: '1 guest', value: '1' },
        { label: '2 guests', value: '2' },
        { label: '3+ guests', value: '3_plus' },
      ],
    },
    {
      key: 'dietary',
      type: 'textarea',
      question: 'Any dietary notes?',
      placeholder: 'Optional: allergies, preferences…',
      required: false,
      flowGroup: 'qualification',
    },
  ],
  scoring: { enabled: false },
};

const discoveryQuestions = [
  {
    key: 'recent_task',
    required: true,
    en: {
      question: 'What’s one task you handled recently, and what were you trying to accomplish?',
      helper: 'Use one real example. If your invitation named a topic, choose a task related to it.',
    },
    es: {
      question: '¿Qué tarea hiciste hace poco y qué querías lograr?',
      helper: 'Usa un ejemplo real. Si la invitación mencionaba un tema, elige una tarea relacionada.',
    },
  },
  {
    key: 'workflow',
    required: true,
    en: {
      question: 'How did you handle it from start to finish?',
      helper: 'Mention any tools, documents, or people you relied on.',
    },
    es: {
      question: '¿Cómo hiciste la tarea de principio a fin?',
      helper: 'Menciona las herramientas, los documentos o las personas que te ayudaron.',
    },
  },
  {
    key: 'friction',
    en: { question: 'What, if anything, slowed you down or made the task harder?' },
    es: { question: '¿Hubo algo que te retrasara o hiciera más difícil la tarea?' },
  },
  {
    key: 'impact',
    en: {
      question: 'If you ran into a problem, what happened as a result?',
      helper: 'If it’s happened before, mention how often it came up in the past month.',
    },
    es: {
      question: 'Si tuviste algún problema, ¿qué pasó a raíz de eso?',
      helper: 'Si ya te había pasado, indica cuántas veces ocurrió en el último mes.',
    },
  },
  {
    key: 'past_attempts',
    en: {
      question: 'What have you already tried to make this task easier?',
      helper: 'For anything you tried, tell us what changed.',
    },
    es: {
      question: '¿Qué has probado para facilitar esta tarea?',
      helper: 'Si probaste algo, cuéntanos qué cambió.',
    },
  },
  {
    key: 'actual_cost',
    en: {
      question: 'How much time or money did you spend on the task?',
      helper: 'A rough estimate is fine.',
    },
    es: {
      question: 'Esa vez, ¿cuánto tiempo o dinero invertiste en la tarea?',
      helper: 'Con una estimación basta.',
    },
  },
  {
    key: 'decision_process',
    en: {
      question: 'Who was involved the last time you changed how this task gets done?',
      helper: 'If you bought a tool, tell us who chose it and who approved the purchase.',
    },
    es: {
      question: '¿Quién participó la última vez que cambiaste la forma de hacer esta tarea?',
      helper: 'Si compraste una herramienta, cuéntanos quién la eligió y quién aprobó la compra.',
    },
  },
  {
    key: 'follow_up_email',
    type: 'email',
    flowGroup: 'lead_capture',
    en: {
      question: 'What email can we use to arrange a short follow-up?',
      helper: 'Leave it if you’re open to showing us how you handled the task.',
    },
    es: {
      question: '¿A qué correo te podemos escribir para coordinar una charla breve?',
      helper: 'Déjalo si te interesa mostrarnos cómo hiciste la tarea.',
    },
  },
] as const;

function customerDiscovery(language: 'en' | 'es'): FormConfig {
  return {
    version: 1,
    language,
    steps: discoveryQuestions.map(({ en, es, ...step }) => ({
      type: 'textarea',
      required: false,
      flowGroup: 'qualification',
      ...step,
      ...(language === 'es' ? es : en),
    })),
    scoring: { enabled: false },
  };
}

export const TEMPLATES: Record<TemplateId, FormConfig> = {
  lead,
  contact,
  feedback,
  rsvp,
  'customer-discovery': customerDiscovery('en'),
};

export function getTemplateConfig(id: TemplateId, locale: string): FormConfig {
  return id === 'customer-discovery' && locale === 'es' ? customerDiscovery('es') : TEMPLATES[id];
}

export const TEMPLATE_ORDER: TemplateId[] = ['lead', 'contact', 'feedback', 'rsvp', 'customer-discovery'];

/** PrimeIcons glyph shown on each template card (mirrors the mockup). */
export const TEMPLATE_ICON: Record<TemplateId, string> = {
  lead: 'pi-chart-line',
  contact: 'pi-id-card',
  feedback: 'pi-star',
  rsvp: 'pi-calendar',
  'customer-discovery': 'pi-comment',
};
