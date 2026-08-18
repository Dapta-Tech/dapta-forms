/**
 * In-app doors to the rest of the Dapta suite — the app-switcher rows and the
 * "Dapta Agents" nav item. One helper so every door tags itself the same way.
 *
 * A different loop from the public badge (`lib/growth.ts`): the reader here is
 * already a Forms user, so `utm_source` is the product's own name and
 * `utm_medium` is the piece of chrome that was clicked. Best-effort on purpose:
 * a base that cannot be parsed comes back untouched rather than hidden — a
 * suite link that looks broken is a bug worth seeing, whereas the public badge
 * hides because a fork may legitimately have no destination at all.
 *
 * The URLs themselves come only from the deployment (`NEXT_PUBLIC_PLATFORM_URL`,
 * `NEXT_PUBLIC_CALENDARS_URL`), read as full static property accesses so Next
 * inlines them into the client bundle. Empty on a bare fork → the callers render
 * nothing, so the rail never carries a dead item.
 */
export type SuiteMedium = 'app_switcher' | 'sidebar';

export const PLATFORM_URL = process.env.NEXT_PUBLIC_PLATFORM_URL || '';
export const CALENDARS_URL = process.env.NEXT_PUBLIC_CALENDARS_URL || '';

/** A suite URL carrying the in-app UTM tags. */
export function suiteHref(base: string, medium: SuiteMedium): string {
  try {
    const url = new URL(base);
    url.searchParams.set('utm_source', 'forms');
    url.searchParams.set('utm_medium', medium);
    return url.toString();
  } catch {
    return base;
  }
}
