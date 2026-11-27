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

import { answersTableHtml, autolinkEscaped, linkHtml, type AnswerRow } from './render-html';
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
  /**
   * The respondent's full name, as the caller resolved it from the answers
   * (the same rule as the form's own `[name]` token). Rendered by
   * `{{respondentName}}`; absent or blank when the form asked for no name.
   */
  respondentName?: string | null;
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
  /** The respondent's full name, for a custom receipt that greets them. */
  respondentName?: string | null;
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
          ? `${v.invitedBy} te agregó al espacio de trabajo "${v.accountName}" en dForms.`
          : `Te agregaron al espacio de trabajo "${v.accountName}" en dForms.`,
        'Entra con este mismo correo y vas a llegar directo ahí.',
        v.signInLink ? `Entrar: ${v.signInLink}` : '',
      ],
    };
  }
  return {
    subject: `You were added to ${v.accountName}`,
    lines: [
      v.invitedBy
        ? `${v.invitedBy} added you to the "${v.accountName}" workspace on dForms.`
        : `You were added to the "${v.accountName}" workspace on dForms.`,
      'Sign in with this same address and you will land straight in it.',
      v.signInLink ? `Sign in: ${v.signInLink}` : '',
    ],
  };
}

// --- Resource hub: the playbook sent at signup --------------------------------

/** What the playbook email needs. */
export interface PlaybookPdfCopyVars {
  /** The playbook's title, in the email's language when it has that version. */
  title: string;
}

/**
 * "Your playbook as a PDF", to someone who signed up on their way to it. The
 * `button` is the call to action's label; the link itself is the notifier's.
 */
export function renderPlaybookPdf(
  locale: NotificationLocale,
  v: PlaybookPdfCopyVars,
): RenderedCopy & { button: string } {
  if (locale === 'es') {
    return {
      subject: `Tu playbook en PDF: ${v.title}`,
      lines: [
        `Ya tienes cuenta en dForms. Aquí está «${v.title}», completo y listo para guardar en PDF.`,
        'Si te pide entrar, usa este mismo correo y vuelve a tocar el botón.',
      ],
      button: 'Descargar el PDF',
    };
  }
  return {
    subject: `Your playbook PDF: ${v.title}`,
    lines: [
      `Your dForms account is ready. Here is “${v.title}”, in full and ready to save as a PDF.`,
      'If it asks you to sign in, use this same address and press the button again.',
    ],
    button: 'Get the PDF',
  };
}

// --- Referral program: emails to the referrer ---------------------------------
//
// Platform copy, never overridable. The badge is named by the label it carries
// on a form (`growth.madeWith` in the shared catalog: "Made with dForms" /
// "Hecho con dForms"), resolved by the caller and passed in, so the email
// always names the badge the way the reader sees it.

/** What the countdown email ("{invitee} joined. {left} to go") needs. */
export interface ReferralJoinedCopyVars {
  /** The invitee's first name, or null/blank when none is safe to show. */
  invitee?: string | null;
  /** Referrals credited to the referrer, this one included. */
  count: number;
  /** Referrals the referral unlock needs (5). */
  goal: number;
  /** The badge's localized label. */
  badgeLabel: string;
}

/** The invitee as the copy names them: their first name, else a generic one. */
function inviteeName(locale: NotificationLocale, invitee: string | null | undefined): string {
  const name = invitee?.trim();
  if (name) return name;
  return locale === 'es' ? 'Alguien' : 'Someone';
}

/**
 * "{invitee} joined. {left} to go to remove the badge", sent to the referrer
 * on each referral that leaves them between 1 and 4. With one left the
 * subject changes to push for the last one.
 */
export function renderReferralJoined(locale: NotificationLocale, v: ReferralJoinedCopyVars): RenderedCopy {
  const name = inviteeName(locale, v.invitee);
  const left = Math.max(v.goal - v.count, 0);
  if (locale === 'es') {
    return {
      subject: left === 1 ? `¡Te falta 1! ${name} se unió` : `${name} se unió. Te faltan ${left} para quitar el sello`,
      lines: [
        `${name} se registró en dForms con tu link. Vas ${v.count} de ${v.goal}. Con ${left} más, «${v.badgeLabel}» se va de todos tus formularios, para siempre.`,
      ],
    };
  }
  return {
    subject: left === 1 ? `Just 1 to go! ${name} joined` : `${name} joined. ${left} to go to remove the badge`,
    lines: [
      `${name} signed up for dForms with your link. You're at ${v.count} of ${v.goal}. ${left} more and “${v.badgeLabel}” is gone from all your forms, for good.`,
    ],
  };
}

/** What the unlock email needs. */
export interface ReferralUnlockedCopyVars {
  /** The badge's localized label. */
  badgeLabel: string;
}

/** "You did it": sent once, when the referral unlock happens, instead of the countdown. */
export function renderReferralUnlocked(locale: NotificationLocale, v: ReferralUnlockedCopyVars): RenderedCopy {
  if (locale === 'es') {
    return {
      subject: `Lo lograste: tus formularios ya no llevan «${v.badgeLabel}»`,
      lines: [
        'Cinco personas se unieron con tu link. Quitamos el sello de todos tus formularios, también de los que crees después.',
        'Es de por vida. Si algún día lo quieres de vuelta, actívalo en Diseño.',
      ],
    };
  }
  return {
    subject: `You did it: your forms no longer show “${v.badgeLabel}”`,
    lines: [
      'Five people joined with your link. We removed the badge from all your forms, including the ones you create later.',
      "It's for life. If you ever want it back, turn it on in Design.",
    ],
  };
}

/** What the 7-day nudge needs. */
export interface ReferralNudgeCopyVars {
  /** Referrals credited to the referrer so far (1 to 4). */
  count: number;
  /** Referrals still needed for the referral unlock. */
  left: number;
  /** Referrals the referral unlock needs (5). */
  goal: number;
  /** The badge's localized label. */
  badgeLabel: string;
}

/**
 * "{left} to go. Your badge is still there": the one reminder per campaign to
 * a referrer stuck between 1 and 4 for 7 days without a new referral.
 */
export function renderReferralNudge(locale: NotificationLocale, v: ReferralNudgeCopyVars): RenderedCopy {
  if (locale === 'es') {
    return {
      subject: `Te faltan ${v.left}. Tu sello sigue ahí`,
      lines: [
        `Vas ${v.count} de ${v.goal}. Manda tu link a alguien que hoy usa Typeform o Google Forms y quita el sello «${v.badgeLabel}» de por vida.`,
      ],
    };
  }
  return {
    subject: `${v.left} to go. Your badge is still there`,
    lines: [
      `You're at ${v.count} of ${v.goal}. Send your link to someone who uses Typeform or Google Forms today and remove the “${v.badgeLabel}” badge for life.`,
    ],
  };
}

/** The labels around the referral link in the countdown email. */
export interface ReferralShareLabels {
  /** The primary button, to the person's referral link. */
  button: string;
  /** The lead-in before the per-channel share links. */
  shareOn: string;
  whatsapp: string;
  email: string;
  x: string;
}

export function referralShareLabels(locale: NotificationLocale): ReferralShareLabels {
  return locale === 'es'
    ? { button: 'Compartir mi link', shareOn: 'O compártelo en', whatsapp: 'WhatsApp', email: 'Correo', x: 'X' }
    : { button: 'Share my link', shareOn: 'Or share it on', whatsapp: 'WhatsApp', email: 'Email', x: 'X' };
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
  'respondentName',
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
    respondentName: v.respondentName?.trim() ?? '',
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
    respondentName: escapeHtml(text.respondentName),
    respondentEmail: escapeHtml(text.respondentEmail),
    score: escapeHtml(text.score),
    outcomeLabel: escapeHtml(text.outcomeLabel),
    formLink: linkHtml(text.formLink),
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
/** True when the template line itself (not a token value) carries an http(s) URL. */
function hasOwnerLink(line: string): boolean {
  return /https?:\/\/[^/?#\s]/i.test(line.replace(TOKEN_RE, ''));
}

export function renderBodyLines(
  template: string,
  textValues: Record<string, string>,
  htmlValues: Record<string, string>,
): RenderedBodyLines {
  const text: string[] = [];
  const html: string[] = [];
  for (const line of template.replace(/\r\n?/g, '\n').split('\n')) {
    const names = [...line.matchAll(TOKEN_RE)].map((m) => m[1]!);
    // A line whose tokens all came out empty is dropped (`Score: {{score}}` on a
    // form with no scoring), unless the owner wrote a link on it: dropping
    // "Gracias {{respondentName}}. Agenda: https://..." would lose the link.
    if (
      names.length > 0 &&
      names.every((name) => textValues[name] === '') &&
      !hasOwnerLink(line)
    ) {
      continue;
    }
    const rendered = interpolateTokens(line, textValues);
    // A blank spacer stays; a run of blanks (from dropped lines) collapses.
    if (rendered.trim() === '' && (text.length === 0 || text[text.length - 1]!.trim() === '')) continue;
    text.push(rendered);
    // URLs the owner wrote become links; token values (respondent input) never do.
    html.push(interpolateTokens(autolinkEscaped(escapeHtml(line)), htmlValues));
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
