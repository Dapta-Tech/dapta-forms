/**
 * The onboarding demo form — every brand-new account is auto-seeded with ONE
 * polished, self-explanatory example so a new user's admin is never empty and
 * immediately shows what a well-built Dapta form looks like. The auth providers
 * call `seedDemoFormForAccount` right after they JIT-create a new account+owner
 * (both the local OSS stub and the workos overlay), gated by the `SEED_DEMO_FORM`
 * env flag (default ON — a fork can disable it).
 *
 * The demo is a normal form: the user can edit or delete it. Seeding is
 * idempotent — it only ever runs when the account has ZERO forms, so a repeat
 * login never produces a duplicate and a real form is never clobbered.
 *
 * The config is authored against the versioned v1 `formConfigSchema` (Zod) — the
 * spec re-validates it so the showcase can never drift out of contract. Copy is
 * in English (the OSS default); Spanish parity for every string the config
 * carries is kept alongside in `DEMO_FORM_COPY_ES` for anyone localizing a fork.
 */
import { sql, type Db } from './client';
import { createForm, type FormRow } from './forms';
import type { FormConfig } from '@quill/types';

/** The demo form's display name (slugifies to `customer-feedback`). */
export const DEMO_FORM_NAME = 'Customer feedback';

/**
 * A flagship example that shows the product's range without overwhelming: a
 * branded cover (eyebrow + headline + subheadline + CTA + trust line + accent),
 * an icon single-choice, a second icon choice, an NPS slider, an open-text note,
 * an optional email lead-capture, a processing reveal, and warm outcome buckets.
 * Realistic use case: a customer-feedback survey — the clearest, most universal
 * demo, and visually distinct from the CLI `pnpm db:seed` lead-qualifier sample.
 */
export const DEMO_FORM_CONFIG: FormConfig = {
  version: 1,
  // A deliberate colour, not `#6366f1`. The demo's whole job is to show that a
  // form carries its OWNER's brand, and stock Tailwind indigo reads as the colour
  // nobody picked — it made the largest saturated object on the builder screen
  // look like an unstyled default sitting next to our own lime Publish. Forest
  // green is unmistakably a choice, fits the warm feedback copy, and is one of the
  // accents `branding.spec.ts` already exercises end to end.
  branding: { primaryColor: '#2b6e4f' },
  cover: {
    enabled: true,
    bannerText: 'Demo form — edit or delete it anytime from your dashboard',
    eyebrow: 'We would love your feedback',
    headline: 'How was your experience?',
    subheadline:
      'Three quick questions — under a minute. Your answers help us build a better product for you.',
    ctaText: 'Share my feedback',
    trustBadge: 'Anonymous unless you choose to leave your email',
    clientLogos: [{ name: 'Northwind' }, { name: 'Acme Co' }, { name: 'Globex' }, { name: 'Initech' }],
  },
  steps: [
    {
      key: 'satisfaction',
      type: 'multiple_choice',
      question: 'Overall, how happy are you with us?',
      helper: 'Pick the face that fits best.',
      required: true,
      showIcons: true,
      flowGroup: 'qualification',
      options: [
        { label: 'Love it', value: 'love', icon: '\u{1F60D}', points: 10 },
        { label: 'Pretty good', value: 'good', icon: '\u{1F642}', points: 7 },
        { label: "It's okay", value: 'okay', icon: '\u{1F610}', points: 4 },
        { label: 'Could be better', value: 'meh', icon: '\u{1F615}', points: 1 },
      ],
    },
    {
      key: 'favorite_area',
      type: 'multiple_choice',
      question: 'What do you value most about us?',
      required: true,
      showIcons: true,
      flowGroup: 'qualification',
      options: [
        { label: 'Ease of use', value: 'ease', icon: '\u{1FA84}', points: 3 },
        { label: 'Speed', value: 'speed', icon: '\u{26A1}', points: 3 },
        { label: 'Support', value: 'support', icon: '\u{1F4AC}', points: 3 },
        { label: 'Price', value: 'price', icon: '\u{1F4B0}', points: 3 },
      ],
    },
    {
      key: 'recommend',
      type: 'slider',
      question: 'How likely are you to recommend us to a friend or colleague?',
      helper: '0 = not at all likely, 10 = absolutely.',
      flowGroup: 'qualification',
      min: 0,
      max: 10,
      step: 1,
      default: 8,
      sliderUnitLabel: '/ 10',
      sliderScoring: [
        { min: 0, max: 6, points: 0 },
        { min: 7, max: 8, points: 3 },
        { min: 9, max: 10, points: 6 },
      ],
    },
    {
      key: 'improvement',
      type: 'textarea',
      question: 'What is the one thing we could do better?',
      placeholder: 'Optional — but we read every single note.',
      required: false,
      flowGroup: 'qualification',
    },
    {
      key: 'email',
      type: 'email',
      question: 'Want us to follow up? Leave your email.',
      helper: 'Optional. We only use it to reply to your feedback — no spam.',
      placeholder: 'you@company.com',
      required: false,
      flowGroup: 'lead_capture',
      triggersReveal: true,
    },
  ],
  scoring: { enabled: true },
  outcomes: [
    { id: 'thanks', label: 'Thank you for sharing \u{1F64C}', minScore: 0 },
    { id: 'delighted', label: 'You just made our day! \u{1F389}', minScore: 13 },
  ],
  reveal: {
    enabled: true,
    headline: 'Saving your feedback…',
    subtitle: 'Hang tight — this only takes a second.',
  },
  partialSubmitAfterStep: 5,
};

/**
 * Spanish parity for every user-facing string the demo config carries. Not wired
 * into the single-language config (the v1 schema is mono-locale by design); kept
 * here so a Spanish-first fork can swap the copy in one place. The renderer
 * chrome (buttons, validation, thank-you body) is already localized separately
 * via `@quill/shared`.
 */
export const DEMO_FORM_COPY_ES = {
  name: 'Opiniones de clientes',
  cover: {
    bannerText: 'Formulario de demostración: puedes editarlo o eliminarlo cuando quieras',
    eyebrow: 'Nos encantaría conocer tu opinión',
    headline: '¿Cómo fue tu experiencia?',
    subheadline:
      'Tres preguntas rápidas, en menos de un minuto. Tus respuestas nos ayudan a construir un mejor producto para ti.',
    ctaText: 'Compartir mi opinión',
    trustBadge: 'Anónimo, salvo que decidas dejar tu correo',
  },
  steps: {
    satisfaction: {
      question: 'En general, ¿qué tan contento estás con nosotros?',
      helper: 'Elige la cara que mejor te represente.',
      options: {
        love: 'Me encanta',
        good: 'Bastante bien',
        okay: 'Más o menos',
        meh: 'Podría mejorar',
      },
    },
    favorite_area: {
      question: '¿Qué es lo que más valoras de nosotros?',
      options: {
        ease: 'Facilidad de uso',
        speed: 'Rapidez',
        support: 'Soporte',
        price: 'Precio',
      },
    },
    recommend: {
      question: '¿Qué tan probable es que nos recomiendes a un amigo o colega?',
      helper: '0 = nada probable, 10 = totalmente.',
    },
    improvement: {
      question: '¿Cuál es la única cosa que podríamos hacer mejor?',
      placeholder: 'Opcional, pero leemos cada nota.',
    },
    email: {
      question: '¿Quieres que te contactemos? Déjanos tu correo.',
      helper: 'Opcional. Solo lo usamos para responder tu opinión, sin spam.',
    },
  },
  outcomes: {
    thanks: 'Gracias por compartir \u{1F64C}',
    delighted: '¡Nos alegraste el día! \u{1F389}',
  },
  reveal: {
    headline: 'Guardando tu opinión…',
    subtitle: 'Un momento, esto solo toma un segundo.',
  },
} as const;

/** True when the account already owns at least one form. */
export async function accountHasForms(db: Db, accountId: string): Promise<boolean> {
  const row = await db.get<{ id: string }>(
    sql`SELECT id FROM form WHERE account_id = ${accountId} LIMIT 1`,
  );
  return row != null;
}

/**
 * Seed the polished demo form for `accountId` — but ONLY when the account has no
 * forms yet, so this is safe to call on every login (idempotent) and never
 * duplicates the demo nor overwrites a form the user created or kept. Reuses the
 * standard `createForm` path so the slug/short-link/handle all resolve exactly
 * like a hand-built form. Returns the created form, or `null` when it was
 * skipped (the account already had forms).
 */
export async function seedDemoFormForAccount(db: Db, accountId: string): Promise<FormRow | null> {
  if (await accountHasForms(db, accountId)) return null;
  const result = await createForm(db, accountId, {
    name: DEMO_FORM_NAME,
    config: DEMO_FORM_CONFIG,
  });
  return result.ok ? result.value : null;
}
