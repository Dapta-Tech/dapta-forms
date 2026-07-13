import type { Locale } from '@quill/shared';

/**
 * Client-side twin of lib/locale.ts#getLocale (that one reads next/headers and
 * is server-only): the persisted admin locale from the document cookie.
 * Defaults to English so a bare fork renders with no cookie.
 */
export function clientLocale(): Locale {
  if (typeof document !== 'undefined' && /(?:^|;\s*)quill_locale=es\b/.test(document.cookie)) return 'es';
  return 'en';
}
