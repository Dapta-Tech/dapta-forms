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
 * Only a path inside the dashboard is accepted: no scheme, no host, no query,
 * no `..`. The value arrives in a URL anyone can compose, and a redirect that
 * honored an arbitrary target would be an open redirect on our domain.
 */
export const NEXT_QUERY_KEY = 'next';
export const NEXT_COOKIE = 'quill_next';
/** Long enough for the login AND a first-visit wizard; short enough to go stale fast. */
export const NEXT_COOKIE_MAX_AGE = 1800;

const DASHBOARD_PATH = /^\/admin(?:\/[A-Za-z0-9_-]+)*$/;

/** The destination if it is a plain dashboard path, else null. First of a repeated param. */
export function safeNextPath(raw: unknown): string | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== 'string') return null;
  const path = value.trim();
  return path.length <= 200 && DASHBOARD_PATH.test(path) ? path : null;
}

/** `url` with `next` appended, for a relative URL that may already carry a query. */
export function withNextPath(url: string, next: string | null): string {
  if (!next) return url;
  return `${url}${url.includes('?') ? '&' : '?'}${NEXT_QUERY_KEY}=${encodeURIComponent(next)}`;
}
