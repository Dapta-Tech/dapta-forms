import { t } from '@quill/shared';

/** The longest internal name a page takes (`linkPageNameSchema`). */
export const PAGE_NAME_MAX = 80;

/**
 * The internal name of a copy: the catalog's "{name} (copy)", with the
 * original's name cut so the whole fits the 80 characters a name takes. A
 * long name would otherwise make the duplicate fail on a name the person
 * never typed.
 */
export function copyNameFor(template: string, name: string, max: number = PAGE_NAME_MAX): string {
  const base = name.trim();
  const room = max - t(template, { name: '' }).length;
  const kept = base.length > room ? base.slice(0, Math.max(0, room)).trimEnd() : base;
  return t(template, { name: kept });
}
