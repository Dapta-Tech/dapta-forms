import type { Locale } from "@quill/shared";

/** Spanish-ish → es, anything else → en (the only two languages we ship). */
function pick(value: string): Locale {
  return value.trim().toLowerCase().startsWith("es") ? "es" : "en";
}

/**
 * The language a public form renders in. Precedence, highest first:
 *
 *  1. `?lang=` on the URL, an explicit ask (a share link, an embed), when it
 *     names a language we ship: `?lang=fr` from a tracking tool is noise and
 *     must not override the author's choice;
 *  2. the form's own `language` (absent/null = Auto);
 *  3. the visitor's `Accept-Language`;
 *  4. English.
 *
 * Pure (no `next/headers`) so the matrix is testable in node; `publicLocale`
 * in lib/locale.ts feeds it the request headers.
 */
/** A `?lang` that names a language we ship, else null (a stray value must not beat the author). */
export function shippedLocale(value: string | null | undefined): Locale | null {
  const v = value?.trim().toLowerCase() ?? '';
  if (v.startsWith('es')) return 'es';
  if (v.startsWith('en')) return 'en';
  return null;
}

export function resolveFormLocale(input: {
  lang?: string | null;
  configLanguage?: Locale | null;
  acceptLanguage?: string | null;
}): Locale {
  const asked = shippedLocale(input.lang);
  if (asked) return asked;
  if (input.configLanguage) return input.configLanguage;
  return pick(input.acceptLanguage ?? "");
}
