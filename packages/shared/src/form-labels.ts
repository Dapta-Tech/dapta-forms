import { getMessages, type Locale } from "./i18n";

/** What the renderer prints on its navigation buttons. */
export interface ResolvedFormLabels {
  back: string;
  next: string;
  submit: string;
  /** The cover CTA: `cover.ctaText`, else the stock "Start". */
  start: string;
}

/** The slice of a form config this resolver reads (engine and types both fit). */
export interface FormLabelSource {
  labels?: {
    back?: string | null;
    next?: string | null;
    submit?: string | null;
  } | null;
  cover?: { ctaText?: string | null } | null;
}

function pick(override: string | null | undefined, fallback: string): string {
  const trimmed = override?.trim();
  return trimmed ? trimmed : fallback;
}

/**
 * The button copy for a form in a locale: the author's form-level override
 * where set (trimmed), the stock renderer copy otherwise. One resolver for
 * both renderers and the builder preview, so they can never disagree.
 */
export function resolveFormLabels(
  config: FormLabelSource,
  locale: Locale,
): ResolvedFormLabels {
  const m = getMessages(locale).renderer;
  return {
    back: pick(config.labels?.back, m.back),
    next: pick(config.labels?.next, m.next),
    submit: pick(config.labels?.submit, m.submit),
    start: pick(config.cover?.ctaText, m.start),
  };
}
