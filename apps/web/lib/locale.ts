import { cookies, headers } from 'next/headers';
import type { Locale } from '@quill/shared';

/** Persisted admin-UI language choice (F8 parity with the old app's toggle). */
export const LOCALE_COOKIE = 'quill_locale';

/**
 * The admin surface's locale, read from the persisted cookie the language
 * switcher writes. Defaults to English so a bare fork renders with no cookie.
 */
export async function getLocale(): Promise<Locale> {
  const jar = await cookies();
  return jar.get(LOCALE_COOKIE)?.value === 'es' ? 'es' : 'en';
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
  const saved = jar.get(LOCALE_COOKIE)?.value;
  if (saved === 'es' || saved === 'en') return saved;
  const accept = (await headers()).get('accept-language') ?? '';
  return accept.trim().toLowerCase().startsWith('es') ? 'es' : 'en';
}

/**
 * Public-surface locale (no admin cookie there): an explicit ?lang= wins,
 * otherwise the browser's Accept-Language decides. Defaults to English.
 */
export async function publicLocale(lang?: string): Promise<Locale> {
  const pick = (v: string) => (v.trim().toLowerCase().startsWith('es') ? 'es' : 'en') as Locale;
  if (lang) return pick(lang);
  return pick((await headers()).get('accept-language') ?? '');
}
