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
 * The answers as a two-column table: muted label on the left, value on the
 * right. `role="presentation"` because it is layout, not data, to a screen
 * reader; `word-break` so a long URL or a pasted paragraph wraps instead of
 * forcing the email wider than a phone.
 */
export function answersTableHtml(rows: AnswerRow[]): string {
  if (rows.length === 0) return "";
  const body = rows
    .map(
      (row) =>
        `<tr>` +
        `<td style="padding:8px 12px 8px 0;vertical-align:top;width:40%;color:#6b7280;font-size:13px;line-height:1.4;word-break:break-word;">${escapeHtml(row.label)}</td>` +
        `<td style="padding:8px 0;vertical-align:top;color:#111827;font-size:14px;line-height:1.4;word-break:break-word;white-space:pre-wrap;">${escapeHtml(row.value)}</td>` +
        `</tr>`,
    )
    .join("");
  return (
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;margin:12px 0;">` +
    `<tbody>${body}</tbody></table>`
  );
}

/**
 * A complete email document around the rendered lines: doctype, viewport meta,
 * a full-width outer table and a 600px white card, system font stack. The
 * lines are joined with `<br/>` inside a `<div>` (a `<p>` cannot legally
 * contain the answers table). Emits a real `</body></html>` because the
 * transactional service appends its footer right before `</body>`.
 */
export function emailDocument(input: {
  lang: "en" | "es";
  lines: string[];
}): string {
  const content = input.lines.join("<br/>");
  return (
    `<!DOCTYPE html>` +
    `<html lang="${input.lang}">` +
    `<head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>` +
    `<body style="margin:0;padding:0;background:#f3f4f6;">` +
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;background:#f3f4f6;">` +
    `<tr><td align="center" style="padding:24px 12px;">` +
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;max-width:600px;background:#ffffff;border-radius:8px;">` +
    `<tr><td style="padding:24px;font-family:${FONT_STACK};font-size:15px;line-height:1.5;color:#111827;">` +
    `<div style="word-break:break-word;overflow-wrap:anywhere;">${content}</div>` +
    `</td></tr></table>` +
    `</td></tr></table>` +
    `</body></html>`
  );
}
