/**
 * The HTML side of a notification email. The text body is the source of truth
 * (every line is plain text); this module turns those lines into a complete,
 * responsive document and renders the answers block as a real table.
 *
 * Escaping contract: `answersTableHtml` escapes its inputs. `emailDocument`
 * does NOT escape `lines`: the caller passes lines that are already escaped
 * text or trusted markup (the answers table), never raw user input.
 */
import { escapeHtml } from "./util";

/** One answered question, already resolved to plain text by the caller. */
export interface AnswerRow {
  label: string;
  value: string;
}

const FONT_STACK =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

/**
 * dForms palette for email. `ACCENT` is the brand green (`forms-logo.tsx`,
 * `#3ddc84`), used only as a fill: as text on white it is under 2:1. Links use
 * `LINK`, the same hue dark enough for 4.5:1 on the card.
 */
const INK = "#1a1a1c";
const MUTED = "#6b7280";
const ACCENT = "#3ddc84";
const LINK = "#0e7a3f";
const CANVAS = "#f4f5f7";
const HAIRLINE = "#e7e8ec";

/** Text on the brand-green button: dark green, over 9:1 on `ACCENT`. */
const ON_ACCENT = "#0b2e1a";

/**
 * The growth button under the card: a question, then a green button. The
 * caller resolves the copy in the email's language and the tagged link; null
 * means the deployment has the growth loop off, and nothing is drawn.
 */
export interface EmailCta {
  question: string;
  action: string;
  href: string;
}

/** Where the dForms wordmark PNG lives under the web app (`apps/web/public`). */
export const EMAIL_LOGO_PATH = "/email/dforms-wordmark.png";

/**
 * The answers as a two-column table: muted label on the left, value on the
 * right, a hairline between rows. `role="presentation"` because it is layout,
 * not data, to a screen reader; `word-break` so a long URL or a pasted
 * paragraph wraps instead of forcing the email wider than a phone.
 */
export function answersTableHtml(rows: AnswerRow[]): string {
  if (rows.length === 0) return "";
  const body = rows
    .map(
      (row, i) => {
        const rule = i === 0 ? "" : `border-top:1px solid ${HAIRLINE};`;
        return (
          `<tr>` +
          `<td style="${rule}padding:10px 12px 10px 0;vertical-align:top;width:40%;color:${MUTED};font-size:13px;line-height:1.45;word-break:break-word;">${escapeHtml(row.label)}</td>` +
          `<td style="${rule}padding:10px 0;vertical-align:top;color:${INK};font-size:14px;font-weight:500;line-height:1.45;word-break:break-word;white-space:pre-wrap;">${escapeHtml(row.value)}</td>` +
          `</tr>`
        );
      },
    )
    .join("");
  return (
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;margin:16px 0;border-top:1px solid ${HAIRLINE};border-bottom:1px solid ${HAIRLINE};">` +
    `<tbody>${body}</tbody></table>`
  );
}

/**
 * A URL as a link, for the `{{formLink}}` token on the HTML side. Only http(s)
 * becomes an anchor; anything else (an empty value, a relative path) stays
 * escaped text, so a template can never produce a `javascript:` href.
 */
export function linkHtml(url: string): string {
  const safe = escapeHtml(url);
  if (!/^https?:\/\//i.test(url.trim())) return safe;
  return anchor(safe);
}

/** A brand-styled anchor around an already-escaped http(s) URL. */
function anchor(escapedUrl: string): string {
  return `<a href="${escapedUrl}" style="color:${LINK};font-weight:600;text-decoration:underline;word-break:break-all;">${escapedUrl}</a>`;
}

/**
 * An http(s) URL inside ESCAPED text: no whitespace, quotes, angle brackets or
 * braces (so a `{{token}}` written right after a URL is never swallowed).
 */
const URL_IN_TEXT = /https?:\/\/[^\s<>"'{}]+/gi;
/**
 * Turn every http(s) URL in an already-escaped template line into a link, the
 * same as `{{formLink}}` renders. For the text an account OWNER writes in
 * Settings (a Calendly link, a site): run it on the escaped template BEFORE the
 * tokens are substituted, so a value a respondent typed (a name, an answer) is
 * never made clickable.
 *
 * Sentence punctuation right after a URL stays outside the link ("aquí:
 * https://x.io." links `https://x.io`), except a `;` that closes an entity
 * (`&amp;`) and a `)` the URL itself opened.
 */
export function autolinkEscaped(escaped: string): string {
  return escaped.replace(URL_IN_TEXT, (found) => {
    // A quote or angle bracket was escaped to an entity, so the pattern above
    // cannot stop at it: end the URL there (`"https://x.io"` links `https://x.io`).
    const match = found.split(/&(?:quot|#39|#x27|lt|gt);/i)[0]!;
    const rest = found.slice(match.length);
    let url = match;
    while (url.length > 0) {
      const last = url[url.length - 1]!;
      if (last === ";" && /&[a-z]+;$/i.test(url)) break;
      if (last === ")" && (url.match(/\(/g)?.length ?? 0) >= (url.match(/\)/g)?.length ?? 0)) break;
      if (!".,;:!?)]".includes(last)) break;
      url = url.slice(0, -1);
    }
    if (!/^https?:\/\/[^/?#]/i.test(url)) return found;
    return anchor(url) + match.slice(url.length) + rest;
  });
}

/**
 * A complete email document around the rendered lines: doctype, viewport and
 * color-scheme metas, a canvas, and a 600px dForms card (brand accent bar, the
 * wordmark, then the content). The lines are joined with `<br/>` inside a
 * `<div>` (a `<p>` cannot legally contain the answers table).
 *
 * `logoUrl` is the absolute URL of the wordmark PNG (SVG does not render in
 * Gmail or Outlook). Without one (self-host with no public URL, tests) the
 * header shows the name as type instead, which is also what a client that
 * blocks images shows through the `alt`.
 *
 * Emits a real `</body></html>` because the transactional service appends its
 * support footer right before `</body>`, below the card.
 */
export function emailDocument(input: {
  lang: "en" | "es";
  lines: string[];
  logoUrl?: string | null;
  cta?: EmailCta | null;
}): string {
  const content = input.lines.join("<br/>");
  const wordmark = `<span style="font-family:${FONT_STACK};font-size:22px;font-weight:800;letter-spacing:-0.02em;color:${INK};">d<span style="color:${LINK};">F</span>orms</span>`;
  const logo = input.logoUrl
    ? `<img src="${escapeHtml(input.logoUrl)}" width="148" height="36" alt="dForms" style="display:block;border:0;outline:none;height:36px;width:148px;font-family:${FONT_STACK};font-size:22px;font-weight:800;color:${INK};"/>`
    : wordmark;
  return (
    `<!DOCTYPE html>` +
    `<html lang="${input.lang}">` +
    `<head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>` +
    // The card is designed light; ask clients not to auto-invert it.
    `<meta name="color-scheme" content="light"/><meta name="supported-color-schemes" content="light"/>` +
    `<style>@media (max-width:480px){.dfm-pad{padding-left:20px !important;padding-right:20px !important;}.dfm-body{padding:0 8px !important;}.dfm-outer{padding:16px 0 !important;}}</style>` +
    `</head>` +
    // The side padding sits on <body>, not on the outer cell: the transactional
    // service splices its footer in just before </body>, outside our tables,
    // and this is the one box that also insets it from the window edge.
    `<body class="dfm-body" style="margin:0;padding:0 16px;background:${CANVAS};">` +
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;background:${CANVAS};">` +
    `<tr><td class="dfm-outer" align="center" style="padding:32px 0;">` +
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:separate;max-width:600px;background:#ffffff;border:1px solid ${HAIRLINE};border-radius:16px;overflow:hidden;">` +
    `<tr><td style="height:4px;line-height:4px;font-size:0;background:${ACCENT};">&nbsp;</td></tr>` +
    `<tr><td class="dfm-pad" style="padding:28px 32px 0;">${logo}</td></tr>` +
    `<tr><td class="dfm-pad" style="padding:24px 32px 32px;font-family:${FONT_STACK};font-size:16px;line-height:1.6;color:${INK};">` +
    `<div style="word-break:break-word;overflow-wrap:anywhere;">${content}</div>` +
    `</td></tr>` +
    ctaRow(input.cta) +
    `</table>` +
    `</td></tr></table>` +
    `</body></html>`
  );
}

/**
 * The growth row at the foot of the card: hairline, the question, then a
 * "bulletproof" button (a table cell carries the fill, so Outlook, which drops
 * an anchor's padding and background, still draws a green block). Only an
 * http(s) link is drawn; anything else leaves the card as it was.
 */
function ctaRow(cta: EmailCta | null | undefined): string {
  if (!cta || !/^https?:\/\//i.test(cta.href.trim())) return "";
  const href = escapeHtml(cta.href);
  return (
    `<tr><td class="dfm-pad" align="center" style="border-top:1px solid ${HAIRLINE};padding:24px 32px 28px;font-family:${FONT_STACK};">` +
    `<p style="margin:0 0 14px;font-size:14px;line-height:1.5;color:${MUTED};">${escapeHtml(cta.question)}</p>` +
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;margin:0 auto;">` +
    `<tr><td align="center" bgcolor="${ACCENT}" style="border-radius:10px;background:${ACCENT};">` +
    `<a href="${href}" target="_blank" rel="noopener" style="display:inline-block;padding:12px 26px;font-family:${FONT_STACK};font-size:15px;font-weight:700;line-height:1.2;color:${ON_ACCENT};text-decoration:none;border-radius:10px;">${escapeHtml(cta.action)}</a>` +
    `</td></tr></table>` +
    `</td></tr>`
  );
}
