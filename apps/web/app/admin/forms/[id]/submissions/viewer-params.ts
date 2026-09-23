/**
 * The submissions viewer's state in the address bar, shared by the server page
 * (which reads it on load) and the client viewer (which rewrites it). Kept out
 * of the `'use client'` module on purpose: a server component that imports a
 * constant from a client module gets a client reference, not the string.
 */

/** `?response=`: the response open in the panel, so it survives a reload and can be shared. */
export const RESPONSE_PARAM = 'response';

/** `?view=sheet`: the table as a full-screen sheet, kept across a reload and a page change. */
export const VIEW_PARAM = 'view';
export const SHEET_VIEW = 'sheet';

/** `?size=`: rows per page. Only these; anything else reads as the default. */
export const SIZE_PARAM = 'size';
export const PAGE_SIZES = [25, 50, 100] as const;
export type PageSize = (typeof PAGE_SIZES)[number];
export const DEFAULT_PAGE_SIZE: PageSize = 25;

export function parsePageSize(v: string | undefined): PageSize {
  const n = Number(v);
  return (PAGE_SIZES as readonly number[]).includes(n) ? (n as PageSize) : DEFAULT_PAGE_SIZE;
}

/** Where a question column's width is kept, per form, in this browser only. */
export function columnWidthsKey(formId: string): string {
  return `quill:submissions:column-widths:${formId}`;
}

/**
 * The CSS variable that sizes question column `index`. The heading and every
 * cell of the column read it (with the table's default as the fallback), so
 * one write on the table resizes the whole column at once, header included.
 */
export function columnWidthVar(index: number): string {
  return `--q-w-${index}`;
}
