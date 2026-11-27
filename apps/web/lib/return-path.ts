/**
 * Where to land once someone is signed in, when they arrived with a destination.
 *
 * The landing links straight into the dashboard: «Connect» means "give my agent
 * a key" and sends people to the API keys page (or the API docs), and a playbook
 * page sends them to that playbook (`/admin/playbooks/<slug>`, or the gallery at
 * `/admin/playbooks`). Someone without a session cannot go there directly: the
 * dashboard bounces them through the hosted login (which always comes back to
 * /admin) and, on a first visit, through the onboarding wizard (which ends on the
 * form it created). The destination rides along instead:
 *
 *   /?next=/admin/developers/keys        the campaign entry (app/page.tsx)
 *   → /api/auth/login?next=…              parks it in a cookie, like the tags
 *   → /api/auth/callback                  lands there instead of /admin
 *   → /onboarding (first visit only)      the wizard ends there and spends it
 *
 * Only a path inside the dashboard is accepted: no scheme, no host, no `..`,
 * at most 200 characters. The value arrives in a URL anyone can compose, and a
 * redirect that honored an arbitrary target would be an open redirect on our
 * domain.
 *
 * No query either, with ONE exception: a playbook page (or the gallery) may
 * carry the reader's language, exactly `?lang=es` or `?lang=en`, so someone who
 * signs up from the English resources hub opens the playbook in English
 * instead of in their platform's language. The whole value must match that
 * shape. Anything else, a third language, a second parameter, `lang` on any
 * other dashboard page, is rejected as a whole (the visitor lands on /admin, as
 * with any other query) rather than trimmed: the guard never rewrites a value
 * it did not fully recognize, so what it lets through is byte for byte what was
 * asked for. The language rides to the final redirect untouched: the cookie
 * encodes it, the callback resolves it with `new URL(next, origin)` and the
 * wizard hands it to `redirect()`, all of which keep the query.
 */
export const NEXT_QUERY_KEY = 'next';
export const NEXT_COOKIE = 'quill_next';
/** Long enough for the login AND a first-visit wizard; short enough to go stale fast. */
export const NEXT_COOKIE_MAX_AGE = 1800;

const DASHBOARD_PATH = /^\/admin(?:\/[A-Za-z0-9_-]+)*$/;
/** A playbook page or the gallery with the reader's language and nothing else. */
const PLAYBOOK_WITH_LANG = /^\/admin\/playbooks(?:\/[A-Za-z0-9_-]+)*\?lang=(?:es|en)$/;

/**
 * The destination if it is a plain dashboard path (or a playbook path with
 * `?lang=es|en`), else null. First of a repeated param.
 */
export function safeNextPath(raw: unknown): string | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== 'string') return null;
  const path = value.trim();
  if (path.length > 200) return null;
  return DASHBOARD_PATH.test(path) || PLAYBOOK_WITH_LANG.test(path) ? path : null;
}

/** `url` with `next` appended, for a relative URL that may already carry a query. */
export function withNextPath(url: string, next: string | null): string {
  if (!next) return url;
  return `${url}${url.includes('?') ? '&' : '?'}${NEXT_QUERY_KEY}=${encodeURIComponent(next)}`;
}
