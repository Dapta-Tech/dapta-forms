/**
 * Submission-email COPY, in English and Spanish. Kept in the notifications
 * package (not the UI i18n catalog in @quill/shared) so this boundary package
 * stays framework-free and self-contained — a fork can read exactly what an
 * email says without pulling the whole web message catalog.
 *
 * The transport is chosen by config (log-only by default); this module only
 * decides WHAT the two submission emails say. Every dynamic value is left raw
 * here — the notifier HTML-escapes each line before it reaches an HTML body
 * (see submission-notifier.ts / util.escapeHtml), so subjects (plain text) and
 * text bodies read naturally while the HTML path stays XSS-safe (E8).
 */

/** The two supported notification languages. Mirrors @quill/shared `Locale`. */
export type NotificationLocale = 'en' | 'es';

/**
 * Normalize any locale-ish value (a member.locale like `es`, `es-CO`, `en-US`,
 * or an Accept-Language fragment) to one of the two supported languages.
 * Anything that is not clearly Spanish falls back to English — the safe default
 * for a bare fork with no locale set anywhere.
 */
export function normalizeLocale(value?: string | null): NotificationLocale {
  return typeof value === 'string' && value.trim().toLowerCase().startsWith('es') ? 'es' : 'en';
}

/** Everything the "new submission" (owner) copy can interpolate. */
export interface ReceivedCopyVars {
  formName: string;
  respondentEmail?: string | null;
  score?: number | null;
  outcomeLabel?: string | null;
  /** A link back to the submissions view (owner) — optional. */
  formLink?: string | null;
}

/** Everything the "we got your responses" (respondent) copy can interpolate. */
export interface ConfirmedCopyVars {
  formName: string;
  /** A public link back to the form (view/edit) — optional. */
  formLink?: string | null;
}

/** A rendered email: a plain subject + the body lines (blank entries dropped). */
export interface RenderedCopy {
  subject: string;
  lines: string[];
}

/**
 * The internal notice to the account owner: "a new submission landed on your
 * form." This is the primary Forms notification — the equivalent of the
 * host-notification email a Calendly/Bookings flow emits when someone books.
 */
export function renderSubmissionReceived(
  locale: NotificationLocale,
  v: ReceivedCopyVars,
): RenderedCopy {
  if (locale === 'es') {
    return {
      subject: `Nueva respuesta — ${v.formName}`,
      lines: [
        `Recibiste una nueva respuesta en "${v.formName}".`,
        v.respondentEmail ? `De: ${v.respondentEmail}` : '',
        v.score != null ? `Puntuación: ${v.score}` : '',
        v.outcomeLabel ? `Resultado: ${v.outcomeLabel}` : '',
        v.formLink ? `Ver las respuestas: ${v.formLink}` : '',
      ],
    };
  }
  return {
    subject: `New submission — ${v.formName}`,
    lines: [
      `You have a new submission on "${v.formName}".`,
      v.respondentEmail ? `From: ${v.respondentEmail}` : '',
      v.score != null ? `Score: ${v.score}` : '',
      v.outcomeLabel ? `Outcome: ${v.outcomeLabel}` : '',
      v.formLink ? `View submissions: ${v.formLink}` : '',
    ],
  };
}

/**
 * The confirmation to the respondent that their answers were recorded. Fully
 * rendered here for both languages; whether it is actually enqueued is a caller
 * decision (the owner notice is the default Forms behavior).
 */
export function renderSubmissionConfirmed(
  locale: NotificationLocale,
  v: ConfirmedCopyVars,
): RenderedCopy {
  if (locale === 'es') {
    return {
      subject: `Recibimos tus respuestas — ${v.formName}`,
      lines: [
        `Gracias — registramos tus respuestas de "${v.formName}".`,
        v.formLink ? `Ver o editar: ${v.formLink}` : '',
      ],
    };
  }
  return {
    subject: `We got your responses — ${v.formName}`,
    lines: [
      `Thanks — we've recorded your responses to "${v.formName}".`,
      v.formLink ? `View or edit: ${v.formLink}` : '',
    ],
  };
}
