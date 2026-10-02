/**
 * Client-side helpers for the Settings → Notifications preview. `interpolate`
 * mirrors the server's `interpolateTokens` (single-pass; unknown tokens stay
 * literal) so what the owner sees matches what the notifier renders. This is
 * preview-only: React escapes the rendered text, and the real HTML-escaping
 * boundary lives server-side in the notifier — never trust this for safety.
 */

/** The answered questions the sample email carries, as the real answers table gets them. */
export const NOTIFICATION_SAMPLE_ANSWERS: { label: string; value: string }[] = [
  { label: 'What best describes you?', value: 'Founder / Owner' },
  { label: 'How big is your team?', value: '20' },
  { label: 'Email', value: 'lead@acme.io' },
];

/** Illustrative values used ONLY for the on-screen preview (never sent). */
export const NOTIFICATION_SAMPLE: Record<string, string> = {
  formName: 'Lead Qualifier',
  respondentEmail: 'lead@acme.io',
  score: '15',
  outcomeLabel: 'Qualified',
  formLink: 'https://forms.example.com/admin/forms/lead-qualifier/submissions',
  // Multi-line on purpose: the real token expands to one "Label: value" line
  // per answered question, and the preview should show that shape.
  answers: NOTIFICATION_SAMPLE_ANSWERS.map((r) => `${r.label}: ${r.value}`).join('\n'),
};

/** A piece of one rendered body line: plain text, or the answers table. */
export type MockSegment = { kind: 'text'; text: string } | { kind: 'answers' };

const ANSWERS_TOKEN = /\{\{\s*answers\s*\}\}/;

/**
 * The body as the HTML email draws it, line by line. The text body spells the
 * answers out as "Label: value" lines, but the HTML body (what an inbox shows)
 * replaces the `{{answers}}` token with a two-column table, so a mock of the
 * inbox has to split a line at that token. Every other token is substituted as
 * in `interpolate`. Blank ends are trimmed and a run of blank lines collapses to
 * one, like the server's `renderBodyLines`.
 */
export function mockBodyLines(template: string, values: Record<string, string>): MockSegment[][] {
  const lines: MockSegment[][] = [];
  for (const raw of template.replace(/\r\n?/g, '\n').split('\n')) {
    const segments: MockSegment[] = [];
    const parts = raw.split(new RegExp(ANSWERS_TOKEN.source, 'g'));
    parts.forEach((part, i) => {
      const text = interpolate(part, values);
      if (text !== '') segments.push({ kind: 'text', text });
      if (i < parts.length - 1) segments.push({ kind: 'answers' });
    });
    const blank = segments.length === 0 || segments.every((s) => s.kind === 'text' && s.text.trim() === '');
    const previousBlank = lines.length === 0 || lines[lines.length - 1]!.length === 0;
    if (blank && previousBlank) continue;
    lines.push(blank ? [] : segments);
  }
  while (lines.length > 0 && lines[lines.length - 1]!.length === 0) lines.pop();
  return lines;
}

/** True when `template` references `{{name}}` (inner whitespace tolerated, like the server). */
export function hasToken(template: string, name: string): boolean {
  return new RegExp(`\\{\\{\\s*${name}\\s*\\}\\}`).test(template);
}

/** Substitute `{{token}}` markers in one pass; an unknown token stays literal. */
export function interpolate(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{\s*([a-zA-Z][A-Za-z0-9_]*)\s*\}\}/g, (whole, name: string) => {
    const value = values[name];
    return value === undefined ? whole : value;
  });
}
