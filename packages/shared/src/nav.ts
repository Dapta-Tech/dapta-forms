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

/** The parts of a rail link the active rule reads. */
export interface NavTarget {
  href: string;
  match?: string[];
  /** Leaves the app (another origin): never the page you are on. */
  external?: boolean;
}

/**
 * Is a rail group (a parent row that opens onto its own links) the active one?
 *
 * A group has no page of its own: it is "here" exactly when one of its
 * children is, by the same rule as a top-level item. An external child never
 * counts, so a group of external links is never active.
 */
export function isNavGroupActive(pathname: string, children: readonly NavTarget[]): boolean {
  return children.some((c) => !c.external && isNavItemActive(pathname, c.href, c.match));
}

/** The localStorage key a rail group's open state is kept under. */
export function navGroupStorageKey(group: string): string {
  return `forms.nav.group.${group}`;
}

/**
 * Is a rail group open on first paint after mount?
 *
 * Open when the page you are on is one of its children (so the highlighted
 * link is never hidden), otherwise whatever the person left it at, and closed
 * when they never touched it. `stored` is the raw localStorage value: `'1'`
 * open, `'0'` closed, `null` never set.
 */
export function initialNavGroupOpen(childActive: boolean, stored: string | null): boolean {
  return childActive || stored === '1';
}
