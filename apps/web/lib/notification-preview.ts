/**
 * Client-side helpers for the Settings → Notifications preview. `interpolate`
 * mirrors the server's `interpolateTokens` (single-pass; unknown tokens stay
 * literal) so what the owner sees matches what the notifier renders. This is
 * preview-only: React escapes the rendered text, and the real HTML-escaping
 * boundary lives server-side in the notifier — never trust this for safety.
 */

/** Illustrative values used ONLY for the on-screen preview (never sent). */
export const NOTIFICATION_SAMPLE: Record<string, string> = {
  formName: 'Lead Qualifier',
  respondentEmail: 'lead@acme.io',
  score: '15',
  outcomeLabel: 'Qualified',
  formLink: 'https://forms.example.com/acme/lead-qualifier',
};

/** Substitute `{{token}}` markers in one pass; an unknown token stays literal. */
export function interpolate(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{\s*([a-zA-Z][A-Za-z0-9_]*)\s*\}\}/g, (whole, name: string) => {
    const value = values[name];
    return value === undefined ? whole : value;
  });
}
