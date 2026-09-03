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

import { answersTableHtml, type AnswerRow } from './render-html';
import { escapeHtml } from './util';

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
  /** A link to the admin submissions page (owner notice only). */
  formLink?: string | null;
  /**
   * The answers as the owner reads them (label + value, in step order), already
   * resolved by the caller. Rendered by the `{{answers}}` token: one
   * `Label: value` line each in text, a two-column table in HTML.
   */
  answers?: AnswerRow[] | null;
}

/** Everything the "we got your responses" (respondent) copy can interpolate. */
export interface ConfirmedCopyVars {
  formName: string;
  /** Reserved: no producer sets it on the receipt today, so the stock line drops. */
  formLink?: string | null;
  /** The respondent's own answers, for a custom template that wants to echo them. */
  answers?: AnswerRow[] | null;
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
 * Rendered from the same token-bearing default an owner sees in Settings, so
 * the stock email and the editable default can never drift.
 */
export function renderSubmissionReceived(
  locale: NotificationLocale,
  v: ReceivedCopyVars,
): RenderedCopy {
  const { subject, text } = renderSubmissionEmail('submission_received', locale, {}, v);
  return { subject, lines: text };
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
  const { subject, text } = renderSubmissionEmail('submission_confirmed', locale, {}, v);
  return { subject, lines: text };
}

/** What an invitation email needs to say. */
export interface MemberInvitedCopyVars {
  /** The workspace they are being invited into. */
  accountName: string;
  /** Who sent it, when we know — an invitation from a stranger reads as spam. */
  invitedBy?: string | null;
  /** Where to sign in. Absent in a bare fork with no PUBLIC_APP_URL set. */
  signInLink?: string | null;
}

/**
 * "You have been added to a workspace."
 *
 * There was no invitation email at all: `inviteMember` inserted a row with
 * status `invited` and stopped, so the person being invited was never told. The
 * copy stays deliberately plain — it names the workspace, who added them, and
 * where to sign in, because everything else an invite usually carries (a token,
 * an accept step) does not exist here: signing in with the invited address is
 * what binds the account.
 */
export function renderMemberInvited(
  locale: NotificationLocale,
  v: MemberInvitedCopyVars,
): RenderedCopy {
  if (locale === 'es') {
    return {
      subject: `Te agregaron a ${v.accountName}`,
      lines: [
        v.invitedBy
          ? `${v.invitedBy} te agregó al espacio de trabajo "${v.accountName}" en Dapta Forms.`
          : `Te agregaron al espacio de trabajo "${v.accountName}" en Dapta Forms.`,
        'Entra con este mismo correo y vas a llegar directo ahí.',
        v.signInLink ? `Entrar: ${v.signInLink}` : '',
      ],
    };
  }
  return {
    subject: `You were added to ${v.accountName}`,
    lines: [
      v.invitedBy
        ? `${v.invitedBy} added you to the "${v.accountName}" workspace on Dapta Forms.`
        : `You were added to the "${v.accountName}" workspace on Dapta Forms.`,
      'Sign in with this same address and you will land straight in it.',
      v.signInLink ? `Sign in: ${v.signInLink}` : '',
    ],
  };
}

// --- Account-editable overrides (Settings → Notifications) --------------------
//
// An account owner may replace the stock subject/body above with their own copy,
// stored per (account, email_key) in `notification_setting`. The send path renders
// the stock template first, then overlays any non-null custom subject/body — each
// independently overridable. Custom copy is PLAIN TEXT with `{{token}}` markers;
// the notifier keeps the exact same HTML-escaping boundary as the stock path
// (every rendered line is escaped before it reaches an HTML body), so a custom
// template can never introduce XSS (E8).

/** The two submission emails an account can customize. */
export const SUBMISSION_EMAIL_KEYS = ['submission_received', 'submission_confirmed'] as const;
export type SubmissionEmailKey = (typeof SUBMISSION_EMAIL_KEYS)[number];

/** Narrow an arbitrary string to a known email key (the API validates writes). */
export function isSubmissionEmailKey(value: string): value is SubmissionEmailKey {
  return (SUBMISSION_EMAIL_KEYS as readonly string[]).includes(value);
}

/**
 * The interpolation tokens a custom subject/body may reference. The SAME set is
 * offered for both emails — every value is carried on the notification, so the
 * owner can compose freely (an absent optional value renders as an empty string).
 */
export const NOTIFICATION_TOKENS = [
  'formName',
  'respondentEmail',
  'score',
  'outcomeLabel',
  'formLink',
  'answers',
] as const;
export type NotificationToken = (typeof NOTIFICATION_TOKENS)[number];

/** Build the `{{token}} → string` map from the notification vars (null → ''). */
export function notificationTokenValues(v: ReceivedCopyVars): Record<NotificationToken, string> {
  return {
    formName: v.formName ?? '',
    respondentEmail: v.respondentEmail ?? '',
    score: v.score != null ? String(v.score) : '',
    outcomeLabel: v.outcomeLabel ?? '',
    formLink: v.formLink ?? '',
    answers: (v.answers ?? []).map((row) => `${row.label}: ${row.value}`).join('\n'),
  };
}

/**
 * The same map for the HTML body: every value escaped, except `answers`, which
 * is the already-escaped table (see render-html.ts). This is the ONLY place a
 * token value reaches HTML unescaped, and only because the table escaped its
 * cells itself.
 */
export function htmlTokenValues(v: ReceivedCopyVars): Record<NotificationToken, string> {
  const text = notificationTokenValues(v);
  return {
    formName: escapeHtml(text.formName),
    respondentEmail: escapeHtml(text.respondentEmail),
    score: escapeHtml(text.score),
    outcomeLabel: escapeHtml(text.outcomeLabel),
    formLink: escapeHtml(text.formLink),
    answers: answersTableHtml(v.answers ?? []),
  };
}

const TOKEN_RE = /\{\{\s*([a-zA-Z][A-Za-z0-9_]*)\s*\}\}/g;

/**
 * Substitute `{{token}}` markers in ONE pass. Single-pass matters: a value that
 * itself contains `{{...}}` is copied verbatim, never re-expanded (deterministic,
 * and no way to smuggle another token through a value). An UNKNOWN token is left
 * literal so the owner sees their typo rather than a silent blank. Whitespace
 * inside the braces is tolerated (`{{ formName }}`).
 */
export function interpolateTokens(template: string, values: Record<string, string>): string {
  return template.replace(TOKEN_RE, (whole, name: string) => {
    const value = values[name];
    return value === undefined ? whole : value;
  });
}

/** A rendered body: the text lines and their HTML twins, index for index. */
export interface RenderedBodyLines {
  text: string[];
  html: string[];
}

/**
 * Render a body template line by line, for the text and the HTML body at once.
 * ONE rule for stock and custom copy alike: a line is dropped only when it
 * carries tokens and every one of them resolved to nothing (`Score: {{score}}`
 * with no score), so an absent optional never leaves a dangling label, while a
 * line with no tokens (a blank spacer, a sign-off) is always kept. Runs of
 * blank lines left behind collapse to one and blank ends are trimmed.
 *
 * The HTML twin escapes the TEMPLATE text first (the owner's own copy is plain
 * text) and then substitutes `htmlValues`, which the caller has escaped per
 * token; `escapeHtml` never touches `{{`, so the markers survive the escape.
 * An unknown token stays literal on both sides and counts as visible content.
 */
export function renderBodyLines(
  template: string,
  textValues: Record<string, string>,
  htmlValues: Record<string, string>,
): RenderedBodyLines {
  const text: string[] = [];
  const html: string[] = [];
  for (const line of template.replace(/\r\n?/g, '\n').split('\n')) {
    const names = [...line.matchAll(TOKEN_RE)].map((m) => m[1]!);
    if (names.length > 0 && names.every((name) => textValues[name] === '')) continue;
    const rendered = interpolateTokens(line, textValues);
    // A blank spacer stays; a run of blanks (from dropped lines) collapses.
    if (rendered.trim() === '' && (text.length === 0 || text[text.length - 1]!.trim() === '')) continue;
    text.push(rendered);
    html.push(interpolateTokens(escapeHtml(line), htmlValues));
  }
  while (text.length > 0 && text[text.length - 1]!.trim() === '') {
    text.pop();
    html.pop();
  }
  return { text, html };
}

/** A fully rendered submission email: the subject plus text and HTML lines. */
export interface RenderedSubmissionEmail extends RenderedBodyLines {
  subject: string;
}

/**
 * Render one submission email from its effective template: the account/form
 * override where set, the shipped default otherwise, each field independent.
 * The subject collapses any newlines to spaces (a header is single-line; this
 * closes off subject header-injection).
 */
export function renderSubmissionEmail(
  key: SubmissionEmailKey,
  locale: NotificationLocale,
  override: { subject?: string | null; body?: string | null },
  vars: ReceivedCopyVars,
): RenderedSubmissionEmail {
  const def = defaultSubmissionTemplate(key, locale);
  const values = notificationTokenValues(vars);
  const subject = interpolateTokens(override.subject ?? def.subject, values)
    .replace(/[\r\n]+/g, ' ')
    .trim();
  const body = renderBodyLines(override.body ?? def.body, values, htmlTokenValues(vars));
  return { subject, ...body };
}

/**
 * Overlay a custom subject/body onto an already-rendered stock copy. Each field
 * is independent: a non-null override replaces it (interpolated), a null/absent
 * override keeps the stock text. The subject collapses any newlines to spaces
 * (a header is single-line — closes off subject header-injection). The returned
 * lines are the TEXT lines (unescaped), exactly like the stock render; the HTML
 * twin comes from `renderSubmissionEmail`.
 */
export function applyCopyOverride(
  base: RenderedCopy,
  override: { subject?: string | null; body?: string | null },
  vars: ReceivedCopyVars,
): RenderedCopy {
  const values = notificationTokenValues(vars);
  const subject =
    override.subject != null
      ? interpolateTokens(override.subject, values).replace(/[\r\n]+/g, ' ').trim()
      : base.subject;
  const lines =
    override.body != null
      ? renderBodyLines(override.body, values, htmlTokenValues(vars)).text
      : base.lines;
  return { subject, lines };
}

/**
 * The stock copy as an editable, token-bearing starting point — what Settings →
 * Notifications shows as the default (and the shape "Reset to default" returns
 * to). These MIRROR the code templates above; `templates.spec.ts` pins them in
 * sync so the two never drift.
 */
export function defaultSubmissionTemplate(
  key: SubmissionEmailKey,
  locale: NotificationLocale,
): { subject: string; body: string } {
  if (key === 'submission_received') {
    return locale === 'es'
      ? {
          subject: 'Nueva respuesta: {{formName}}',
          body: [
            'Recibiste una nueva respuesta en "{{formName}}".',
            'De: {{respondentEmail}}',
            'Puntuación: {{score}}',
            'Resultado: {{outcomeLabel}}',
            '',
            '{{answers}}',
            '',
            'Ver las respuestas: {{formLink}}',
          ].join('\n'),
        }
      : {
          subject: 'New submission: {{formName}}',
          body: [
            'You have a new submission on "{{formName}}".',
            'From: {{respondentEmail}}',
            'Score: {{score}}',
            'Outcome: {{outcomeLabel}}',
            '',
            '{{answers}}',
            '',
            'View submissions: {{formLink}}',
          ].join('\n'),
        };
  }
  return locale === 'es'
    ? {
        subject: 'Recibimos tus respuestas: {{formName}}',
        body: ['Gracias: registramos tus respuestas de "{{formName}}".', 'Ver o editar: {{formLink}}'].join(
          '\n',
        ),
      }
    : {
        subject: 'We got your responses: {{formName}}',
        body: ["Thanks: we've recorded your responses to \"{{formName}}\".", 'View or edit: {{formLink}}'].join(
          '\n',
        ),
      };
}
