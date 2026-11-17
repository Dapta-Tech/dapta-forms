import 'server-only';

/**
 * The Dapta AI landing the "Only for Dapta AI subscribers" note links to:
 * `DAPTA_AI_URL`, a server-side runtime variable of the DEPLOYMENT (no host
 * is written in this tree, like `NEXT_PUBLIC_PLATFORM_URL` in `lib/suite.ts`).
 * Shared by Brand kit and the form editor's Design panel. Read at request time, so a deployment changes it without a rebuild. Anything
 * that is not an http(s) URL reads as unset, and the note stays plain text.
 */
export function daptaAiUrl(): string | null {
  const raw = process.env.DAPTA_AI_URL?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}
