import type { Locale } from "@quill/shared";

/** Spanish-ish → es, anything else → en (the only two languages we ship). */
function pick(value: string): Locale {
  return value.trim().toLowerCase().startsWith("es") ? "es" : "en";
}

/**
 * The language a public form renders in. Precedence, highest first:
 *
 *  1. `?lang=` on the URL, an explicit ask (a share link, an embed);
 *  2. the form's own `language` (absent/null = Auto);
 *  3. the visitor's `Accept-Language`;
 *  4. English.
 *
 * Pure (no `next/headers`) so the matrix is testable in node; `publicLocale`
 * in lib/locale.ts feeds it the request headers.
 */
export function resolveFormLocale(input: {
  lang?: string | null;
  configLanguage?: Locale | null;
  acceptLanguage?: string | null;
}): Locale {
  if (input.lang) return pick(input.lang);
  if (input.configLanguage) return input.configLanguage;
  return pick(input.acceptLanguage ?? "");
}
