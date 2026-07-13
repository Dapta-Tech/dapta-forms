/**
 * EMAIL TEMPLATES — the editable layer of the notification system.
 *
 * Every booking email renders from a { subject, body } template: the shipped
 * defaults below (EN/ES, per email key) or a per-account override stored in
 * `notification_setting`. Bodies are PLAIN TEXT with `{{variable}}` tokens —
 * no user-authored HTML ever reaches an email (public-facing hardening E8):
 * rendering escapes both template text and substituted values, and only
 * whitelisted variables resolve; unknown tokens render empty.
 *
 * Line rule (keeps optional fields tidy, mirrors the pre-template behavior):
 * a line that contains tokens which ALL resolve empty is dropped — so
 * "Where: {{location}}" vanishes when there is no location, and
 * "{{pending_note}}" only appears for approval-required bookings.
 */
import type { BookingNotification } from './booking-notifier';
import { escapeHtml } from './util';

export const EMAIL_TEMPLATE_KEYS = [
  'attendee_confirmation',
  'attendee_pending',
  'attendee_declined',
  'attendee_reschedule',
  'attendee_cancellation',
  'attendee_reminder',
  'host_booked',
  'host_rescheduled',
  'host_cancelled',
  'host_declined',
  'host_reminder',
  'follow_up',
] as const;
export type EmailTemplateKey = (typeof EMAIL_TEMPLATE_KEYS)[number];

export function isEmailTemplateKey(v: string): v is EmailTemplateKey {
  return (EMAIL_TEMPLATE_KEYS as readonly string[]).includes(v);
}

/**
 * Whether a key sends with NO stored setting. Lifecycle mail defaults ON
 * (parity with the pre-toggle product); the post-meeting follow-up is
 * marketing-ish, so it is strictly opt-in.
 */
export function defaultEnabledFor(key: EmailTemplateKey): boolean {
  return key !== 'follow_up';
}

export type TemplateLocale = 'en' | 'es';

export interface EmailTemplate {
  subject: string;
  body: string;
}

/** The variable whitelist — the ONLY tokens that resolve (editor shows these). */
export const TEMPLATE_VARIABLES = [
  'attendee_name',
  'attendee_email',
  'host_name',
  'event_title',
  'start_time',
  'end_time',
  'location',
  'manage_url',
  'cancel_link',
  'reschedule_link',
  'cancellation_reason',
  'previous_start_time',
  'reminder_lead',
  'pending_note',
  'booking_link',
] as const;
export type TemplateVariable = (typeof TEMPLATE_VARIABLES)[number];

const TOKEN_RE = /\{\{\s*([a-z_]+)\s*\}\}/g;

/** All `{{token}}` names appearing in a template string (editor validation). */
export function extractTokens(text: string): string[] {
  const names = new Set<string>();
  for (const m of text.matchAll(TOKEN_RE)) names.add(m[1]!);
  return [...names];
}

/** Tokens present in the text that are NOT in the whitelist (flag in preview). */
export function unknownTokens(text: string): string[] {
  return extractTokens(text).filter(
    (t) => !(TEMPLATE_VARIABLES as readonly string[]).includes(t),
  );
}

/** Locale-aware "Sat, Aug 1, 11:00 AM EDT" in the given time zone. */
export function formatWhen(iso: string, tz: string, locale: TemplateLocale = 'en'): string {
  try {
    return new Intl.DateTimeFormat(locale === 'es' ? 'es' : 'en-US', {
      timeZone: tz,
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

/** "in 24 hour(s)" / "en 30 minutos" — the reminder lead phrase. */
export function formatLead(leadMinutes: number | undefined, locale: TemplateLocale): string {
  if (leadMinutes == null) return locale === 'es' ? 'pronto' : 'soon';
  const day = 1440;
  if (leadMinutes % day === 0) {
    const d = leadMinutes / day;
    return locale === 'es' ? `en ${d} día(s)` : `in ${d} day(s)`;
  }
  if (leadMinutes % 60 === 0) {
    const h = leadMinutes / 60;
    return locale === 'es' ? `en ${h} hora(s)` : `in ${h} hour(s)`;
  }
  return locale === 'es' ? `en ${leadMinutes} minutos` : `in ${leadMinutes} minutes`;
}

/**
 * Build the variable map for one notification. Times are formatted in the
 * ATTENDEE's time zone for both sides (v1 — the booking's reference zone).
 */
export function templateVars(
  n: BookingNotification & { reminderLeadMinutes?: number },
  locale: TemplateLocale = 'en',
): Record<TemplateVariable, string> {
  const tz = n.attendee.timeZone ?? 'UTC';
  const pendingNote = n.pending
    ? locale === 'es'
      ? 'Esta solicitud está pendiente de tu confirmación.'
      : 'This request is pending your confirmation.'
    : '';
  return {
    attendee_name: n.attendee.name ?? '',
    attendee_email: n.attendee.email ?? '',
    host_name: n.host.name ?? '',
    event_title: n.title,
    start_time: formatWhen(n.startUtc, tz, locale),
    end_time: formatWhen(n.endUtc, tz, locale),
    location: n.location ?? '',
    manage_url: n.manageUrl ?? '',
    cancel_link: n.manageUrl ?? '',
    reschedule_link: n.manageUrl ?? '',
    cancellation_reason: n.cancellationReason ?? '',
    previous_start_time: n.previousStartUtc ? formatWhen(n.previousStartUtc, tz, locale) : '',
    reminder_lead: formatLead(n.reminderLeadMinutes, locale),
    pending_note: pendingNote,
    booking_link: n.bookingLink ?? '',
  };
}

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

/** Own-property lookup only — `{{constructor}}`/`{{__proto__}}` must resolve
 *  empty, never reach into Object.prototype and stringify a function. */
function varValue(vars: Record<string, string>, name: string): string {
  return Object.hasOwn(vars, name) ? (vars[name] ?? '') : '';
}

function substituteLine(line: string, vars: Record<string, string>): string | null {
  let sawToken = false;
  let sawValue = false;
  const out = line.replace(TOKEN_RE, (_, name: string) => {
    sawToken = true;
    const v = varValue(vars, name);
    if (v !== '') sawValue = true;
    return v;
  });
  // Drop a line whose tokens all resolved empty ("Where: {{location}}" with no
  // location) — literal-only lines always stay.
  if (sawToken && !sawValue) return null;
  return out;
}

/**
 * Render a template against the whitelist variables. Safe by construction:
 * the HTML variant escapes the whole substituted line (template text AND
 * values), so neither an edited template nor attendee-supplied data can inject
 * markup. Unknown tokens resolve empty.
 */
export function renderTemplate(
  template: EmailTemplate,
  vars: Record<string, string>,
): RenderedEmail {
  const subject = template.subject
    .replace(TOKEN_RE, (_, name: string) => varValue(vars, name))
    .replace(/\s+/g, ' ')
    .trim();
  const lines = template.body
    .split('\n')
    .map((l) => substituteLine(l, vars))
    .filter((l): l is string => l !== null);
  // Collapse runs of blank lines left behind by dropped neighbors.
  const text = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  const html = `<p>${text.split('\n').map(escapeHtml).join('<br/>')}</p>`;
  return { subject, text, html };
}

/* ------------------------------------------------------------------------ *
 * Shipped defaults. EN copy intentionally matches the pre-template emails   *
 * so forks that never touch Settings see identical mail.                    *
 * ------------------------------------------------------------------------ */

const EN: Record<EmailTemplateKey, EmailTemplate> = {
  attendee_confirmation: {
    subject: 'Confirmed: {{event_title}} — {{start_time}}',
    body: `Hi {{attendee_name}},

Your booking "{{event_title}}" is confirmed.
When: {{start_time}}
Host: {{host_name}}
Where: {{location}}
Manage your booking: {{manage_url}}`,
  },
  attendee_pending: {
    subject: 'Request received: {{event_title}} — {{start_time}}',
    body: `Hi {{attendee_name}},

We received your request to book "{{event_title}}".
When: {{start_time}}
Host: {{host_name}}
This is pending confirmation. You'll get another email once it's confirmed.
Cancel this request: {{manage_url}}`,
  },
  attendee_declined: {
    subject: 'Not accepted: {{event_title}} — {{start_time}}',
    body: `Hi {{attendee_name}},

Unfortunately your request to book "{{event_title}}" ({{start_time}}) was not accepted.
Reason: {{cancellation_reason}}`,
  },
  attendee_reschedule: {
    subject: 'Rescheduled: {{event_title}} — {{start_time}}',
    body: `Hi {{attendee_name}},

Your booking "{{event_title}}" has been rescheduled.
Was: {{previous_start_time}}
Now: {{start_time}}
Host: {{host_name}}
Where: {{location}}
Manage your booking: {{manage_url}}`,
  },
  attendee_cancellation: {
    subject: 'Cancelled: {{event_title}} — {{start_time}}',
    body: `Hi {{attendee_name}},

Your booking "{{event_title}}" ({{start_time}}) has been cancelled.
Reason: {{cancellation_reason}}`,
  },
  attendee_reminder: {
    subject: 'Reminder: {{event_title}} — {{start_time}}',
    body: `Hi {{attendee_name}},

Reminder: "{{event_title}}" starts {{reminder_lead}}.
When: {{start_time}}
Host: {{host_name}}
Where: {{location}}
Manage your booking: {{manage_url}}`,
  },
  host_booked: {
    subject: 'New booking: {{event_title}} — {{start_time}}',
    body: `Hi {{host_name}},

{{attendee_name}} ({{attendee_email}}) booked "{{event_title}}".
When: {{start_time}}
Where: {{location}}
{{pending_note}}`,
  },
  host_rescheduled: {
    subject: 'Rescheduled: {{event_title}} — {{start_time}}',
    body: `Hi {{host_name}},

The booking "{{event_title}}" with {{attendee_name}} has been rescheduled.
Was: {{previous_start_time}}
Now: {{start_time}}
Where: {{location}}`,
  },
  host_cancelled: {
    subject: 'Cancelled: {{event_title}} — {{start_time}}',
    body: `Hi {{host_name}},

The booking "{{event_title}}" ({{start_time}}) with {{attendee_name}} has been cancelled.
Reason: {{cancellation_reason}}`,
  },
  host_declined: {
    subject: 'Declined: {{event_title}} — {{start_time}}',
    body: `Hi {{host_name}},

The booking request from {{attendee_name}} ({{attendee_email}}) for "{{event_title}}" ({{start_time}}) was declined.
Reason: {{cancellation_reason}}`,
  },
  host_reminder: {
    subject: 'Reminder: {{event_title}} — {{start_time}}',
    body: `Hi {{host_name}},

Reminder: "{{event_title}}" with {{attendee_name}} starts {{reminder_lead}}.
When: {{start_time}}
Where: {{location}}`,
  },
  follow_up: {
    subject: 'Thanks for meeting — {{event_title}}',
    body: `Hi {{attendee_name}},

Thanks for taking the time for "{{event_title}}" — we hope it was useful.
Want to talk again? Book another slot: {{booking_link}}`,
  },
};

const ES: Record<EmailTemplateKey, EmailTemplate> = {
  attendee_confirmation: {
    subject: 'Confirmada: {{event_title}} — {{start_time}}',
    body: `Hola {{attendee_name}},

Tu reserva "{{event_title}}" está confirmada.
Cuándo: {{start_time}}
Anfitrión: {{host_name}}
Dónde: {{location}}
Gestiona tu reserva: {{manage_url}}`,
  },
  attendee_pending: {
    subject: 'Solicitud recibida: {{event_title}} — {{start_time}}',
    body: `Hola {{attendee_name}},

Recibimos tu solicitud para reservar "{{event_title}}".
Cuándo: {{start_time}}
Anfitrión: {{host_name}}
Está pendiente de confirmación. Recibirás otro correo cuando se confirme.
Cancelar esta solicitud: {{manage_url}}`,
  },
  attendee_declined: {
    subject: 'No aceptada: {{event_title}} — {{start_time}}',
    body: `Hola {{attendee_name}},

Lamentablemente tu solicitud para reservar "{{event_title}}" ({{start_time}}) no fue aceptada.
Motivo: {{cancellation_reason}}`,
  },
  attendee_reschedule: {
    subject: 'Reprogramada: {{event_title}} — {{start_time}}',
    body: `Hola {{attendee_name}},

Tu reserva "{{event_title}}" ha sido reprogramada.
Antes: {{previous_start_time}}
Ahora: {{start_time}}
Anfitrión: {{host_name}}
Dónde: {{location}}
Gestiona tu reserva: {{manage_url}}`,
  },
  attendee_cancellation: {
    subject: 'Cancelada: {{event_title}} — {{start_time}}',
    body: `Hola {{attendee_name}},

Tu reserva "{{event_title}}" ({{start_time}}) ha sido cancelada.
Motivo: {{cancellation_reason}}`,
  },
  attendee_reminder: {
    subject: 'Recordatorio: {{event_title}} — {{start_time}}',
    body: `Hola {{attendee_name}},

Recordatorio: "{{event_title}}" comienza {{reminder_lead}}.
Cuándo: {{start_time}}
Anfitrión: {{host_name}}
Dónde: {{location}}
Gestiona tu reserva: {{manage_url}}`,
  },
  host_booked: {
    subject: 'Nueva reserva: {{event_title}} — {{start_time}}',
    body: `Hola {{host_name}},

{{attendee_name}} ({{attendee_email}}) reservó "{{event_title}}".
Cuándo: {{start_time}}
Dónde: {{location}}
{{pending_note}}`,
  },
  host_rescheduled: {
    subject: 'Reprogramada: {{event_title}} — {{start_time}}',
    body: `Hola {{host_name}},

La reserva "{{event_title}}" con {{attendee_name}} ha sido reprogramada.
Antes: {{previous_start_time}}
Ahora: {{start_time}}
Dónde: {{location}}`,
  },
  host_cancelled: {
    subject: 'Cancelada: {{event_title}} — {{start_time}}',
    body: `Hola {{host_name}},

La reserva "{{event_title}}" ({{start_time}}) con {{attendee_name}} ha sido cancelada.
Motivo: {{cancellation_reason}}`,
  },
  host_declined: {
    subject: 'Rechazada: {{event_title}} — {{start_time}}',
    body: `Hola {{host_name}},

La solicitud de reserva de {{attendee_name}} ({{attendee_email}}) para "{{event_title}}" ({{start_time}}) fue rechazada.
Motivo: {{cancellation_reason}}`,
  },
  host_reminder: {
    subject: 'Recordatorio: {{event_title}} — {{start_time}}',
    body: `Hola {{host_name}},

Recordatorio: "{{event_title}}" con {{attendee_name}} comienza {{reminder_lead}}.
Cuándo: {{start_time}}
Dónde: {{location}}`,
  },
  follow_up: {
    subject: 'Gracias por la reunión — {{event_title}}',
    body: `Hola {{attendee_name}},

Gracias por tu tiempo en "{{event_title}}" — esperamos que haya sido útil.
¿Quieres volver a hablar? Reserva otro espacio: {{booking_link}}`,
  },
};

export const DEFAULT_TEMPLATES: Record<TemplateLocale, Record<EmailTemplateKey, EmailTemplate>> = {
  en: EN,
  es: ES,
};

/** The shipped default for a key (EN fallback for any unknown locale). */
export function defaultTemplate(key: EmailTemplateKey, locale?: string | null): EmailTemplate {
  const l: TemplateLocale = locale === 'es' ? 'es' : 'en';
  return DEFAULT_TEMPLATES[l][key];
}

/**
 * Resolve the effective template: per-field override (custom subject may pair
 * with the default body, and vice versa) over the shipped default.
 */
export function resolveTemplate(
  key: EmailTemplateKey,
  custom: { subject?: string | null; body?: string | null } | null | undefined,
  locale?: string | null,
): EmailTemplate {
  const base = defaultTemplate(key, locale);
  return {
    subject: custom?.subject ?? base.subject,
    body: custom?.body ?? base.body,
  };
}
