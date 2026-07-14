/**
 * Admin-shell nav helpers. Framework-free so both the shell (client) and tests
 * can share the exact active-route rule.
 */

/**
 * Is a nav item the active one for the current path?
 *
 * `/admin` (Home) is exact-match only — a root href must never light up on every
 * child route. Every other item matches its href OR any of the extra `matches`
 * prefixes, treating `href` as a path prefix (so `/admin/forms/123/edit` keeps
 * "Forms" active).
 */
export function isNavItemActive(pathname: string, href: string, matches?: string[]): boolean {
  if (href === '/admin') return pathname === '/admin';
  const targets = matches ?? [href];
  return targets.some((t) => pathname === t || pathname.startsWith(`${t}/`));
}
