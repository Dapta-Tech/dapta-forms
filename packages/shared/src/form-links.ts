/**
 * The links of a form: where the public reaches it and where its owner edits it.
 *
 * The public URL of a form is `/{accountCode}/f/{slug}`.
 *
 * The middle segment used to be a member handle, and not even the author's: the
 * builder composed it from whichever member was LOOKING at the editor or the
 * forms list, so two teammates copied two different links for one form, and a
 * link handed to a lead, an ad audience or a printed QR told them who inside
 * the company had built it. No route, endpoint or query ever read that segment
 * (the form resolves by account code and slug alone), so a fixed word in its
 * place changes nothing about how a link resolves, only what it gives away.
 *
 * Every surface that hands a form link out (the builder's topbar, Embed, QR,
 * Open form, the preview's address bar, the prefill example, the forms list,
 * a member's public page, and the API's `publicUrl`) builds it here, so none of
 * them can drift back. It lives in this package rather than in the web because
 * the API hands the same link to agents and must not keep a second copy.
 */

import { trimTrailing } from './trim';

/**
 * The fixed middle segment. It can never collide with a member's public page
 * at `/{accountCode}/{handle}`: a handle is at least three characters, both by
 * validation and by derivation.
 */
export const PUBLIC_FORM_SEGMENT = 'f';

/**
 * The path to hand out for a form. Each segment is encoded: the public page
 * also passes in an account code that arrived in the URL, already decoded, and
 * a CRLF interpolated into a redirect target makes Node answer 500.
 *
 * `accountCode` is the workspace's canonical public code: its vanity slug when
 * it claimed one, else its short code (what `/v1/me` reports as `accountCode`).
 * `slug` is the form's live slug; retired ones keep resolving through the alias
 * ledger, but the link handed out always names the current one.
 */
export function publicFormPath(accountCode: string, slug: string): string {
  return `/${encodeURIComponent(accountCode)}/${PUBLIC_FORM_SEGMENT}/${encodeURIComponent(slug)}`;
}

/** The builder of a form in the admin. */
export function formEditorPath(formId: string): string {
  return `/admin/forms/${encodeURIComponent(formId)}/edit`;
}

export interface FormLinks {
  /** The absolute public link of the form, or null when it cannot be known. */
  publicUrl: string | null;
  /** The absolute link to the form's builder, or null when it cannot be known. */
  editorUrl: string | null;
}

/**
 * Both links of a form as absolute URLs on the deployment's public address.
 *
 * `appUrl` is the deployment's `PUBLIC_APP_URL`. A bare fork leaves it empty,
 * and then there is no address to promise, so both links are null rather than
 * a guess built from a request's Host header. A null `accountCode` (the
 * workspace row could not be read) drops only the public link.
 */
export function formLinks(
  appUrl: string | null | undefined,
  accountCode: string | null | undefined,
  form: { id: string; slug: string },
): FormLinks {
  const base = trimTrailing((appUrl ?? '').trim(), '/');
  if (!base) return { publicUrl: null, editorUrl: null };
  return {
    publicUrl: accountCode ? `${base}${publicFormPath(accountCode, form.slug)}` : null,
    editorUrl: `${base}${formEditorPath(form.id)}`,
  };
}

/** The fixed segment a workspace's extra link pages live under: `/{accountCode}/p/{slug}`. */
export const LINK_PAGE_PUBLIC_SEGMENT = 'p';

/**
 * A workspace link page's absolute public URL on the deployment's public
 * address, or null when there is no `PUBLIC_APP_URL` to promise. The default
 * page (or a call without `page`) is `/{accountCode}`; any other page is
 * `/{accountCode}/p/{slug}`. Built here like a form's link, so the API hands
 * agents the same address the editor shows.
 */
export function linkPageUrl(
  appUrl: string | null | undefined,
  accountCode: string,
  page?: { slug: string; isDefault: boolean } | null,
): string | null {
  const base = trimTrailing((appUrl ?? '').trim(), '/');
  if (!base) return null;
  const root = `${base}/${encodeURIComponent(accountCode)}`;
  return !page || page.isDefault ? root : `${root}/${LINK_PAGE_PUBLIC_SEGMENT}/${encodeURIComponent(page.slug)}`;
}
