/**
 * Did this signup come from the resource hub?
 *
 * A playbook page of the landing sends people to `/admin/playbooks/<slug>`,
 * which is parked as the return path (lib/return-path.ts) through the login and
 * the first-run wizard. That parked destination is the whole signal: the wizard
 * reads it to ask two questions instead of the cohort's list, and its completion
 * names the playbook so the API can email it.
 *
 * Decided by the PATH alone. The query only says how to show the page, so it
 * never changes the answer; its `lang`, when it is a playbook language, is the
 * language the person was reading in.
 */
export interface HubEntry {
  /** The playbook they were on their way to. */
  playbook: string;
  /** The language the link asked for, or null when it said none. */
  playbookLocale: 'es' | 'en' | null;
}

/** A playbook page: one slug (lowercase words joined by hyphens), never the gallery. */
const PLAYBOOK_PAGE = /^\/admin\/playbooks\/([a-z0-9]+(?:-[a-z0-9]+)*)(?:\?(.*))?$/;

/** The hub entry inside a parked return path, or null for every other destination. */
export function hubEntry(next: string | null | undefined): HubEntry | null {
  const match = next && next.length <= 200 ? PLAYBOOK_PAGE.exec(next) : null;
  const slug = match?.[1];
  if (!slug) return null;
  const lang = new URLSearchParams(match[2] ?? '').get('lang');
  return { playbook: slug, playbookLocale: lang === 'es' || lang === 'en' ? lang : null };
}
