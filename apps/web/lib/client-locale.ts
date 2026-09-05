import type { Locale } from '@quill/shared';
import { shippedLocale } from './form-locale';

/**
 * Client-side twin of lib/locale.ts#getLocale (that one reads next/headers and
 * is server-only): the persisted admin locale from the document cookie.
 * Defaults to English so a bare fork renders with no cookie.
 */
/**
 * The locale of a PUBLIC surface that has no request to read (the error
 * boundary is a client component): an explicit `?lang`, else the browser's
 * language, else English. Same order as `resolveFormLocale`, minus the form
 * language, which the boundary cannot know.
 */
export function publicClientLocale(): Locale {
  const pick = (v: string): Locale => (v.trim().toLowerCase().startsWith('es') ? 'es' : 'en');
  if (typeof location !== 'undefined' && location?.search) {
    const asked = shippedLocale(new URLSearchParams(location.search).get('lang'));
    if (asked) return asked;
  }
  if (typeof navigator !== 'undefined' && navigator?.language) return pick(navigator.language);
  return 'en';
}

export function clientLocale(): Locale {
  if (typeof document !== 'undefined' && /(?:^|;\s*)quill_locale=es\b/.test(document.cookie)) return 'es';
  return 'en';
}
