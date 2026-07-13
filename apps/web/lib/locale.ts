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
 * Public-surface locale (no admin cookie there): an explicit ?lang= wins,
 * otherwise the browser's Accept-Language decides. Defaults to English.
 */
export async function publicLocale(lang?: string): Promise<Locale> {
  const pick = (v: string) => (v.trim().toLowerCase().startsWith('es') ? 'es' : 'en') as Locale;
  if (lang) return pick(lang);
  return pick((await headers()).get('accept-language') ?? '');
}
