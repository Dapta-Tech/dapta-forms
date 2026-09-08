import { cookies, headers } from 'next/headers';
import type { Locale } from '@quill/shared';
import { resolveFormLocale } from './form-locale';

/** Persisted admin-UI language choice (F8 parity with the old app's toggle). */
export const LOCALE_COOKIE = 'quill_locale';

/** One year. Shared by every writer of the cookie so a choice made in the wizard
 *  and one made in Preferences do not expire on different days. */
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/** Narrow an arbitrary string to a locale we ship, or null. The cookie and the
 *  member column are both plain text written by more than one writer, so every
 *  read goes through this rather than trusting the stored value. */
export function asLocale(value: string | null | undefined): Locale | null {
  return value === 'en' || value === 'es' ? value : null;
}

/**
 * The admin surface's locale, read from the persisted cookie the language
 * switcher writes. Defaults to English so a bare fork renders with no cookie.
 */
export async function getLocale(): Promise<Locale> {
  const jar = await cookies();
  return asLocale(jar.get(LOCALE_COOKIE)?.value) ?? 'en';
}

/**
 * The locale for a surface a brand-new person reaches BEFORE they have ever
 * touched the language switcher: the persisted choice if there is one, else what
 * their browser asks for.
 *
 * `getLocale` alone is wrong here. It answers English for anyone without the
 * cookie, and the first-run wizard is precisely the screen nobody has a cookie
 * for yet — so a Spanish-speaking signup would be greeted in English and have to
 * find a switcher to fix it, on the one screen they cannot skip.
 */
export async function preferredLocale(): Promise<Locale> {
  const jar = await cookies();
  const saved = asLocale(jar.get(LOCALE_COOKIE)?.value);
  if (saved) return saved;
  const accept = (await headers()).get('accept-language') ?? '';
  return accept.trim().toLowerCase().startsWith('es') ? 'es' : 'en';
}

/**
 * Public-surface locale (no admin cookie there): an explicit ?lang= wins, then
 * the form's own language, then the browser's Accept-Language. Defaults to
 * English. See `resolveFormLocale` for the matrix.
 */
export async function publicLocale(lang?: string, configLanguage?: Locale | null): Promise<Locale> {
  return resolveFormLocale({
    lang,
    configLanguage,
    acceptLanguage: (await headers()).get('accept-language'),
  });
}
