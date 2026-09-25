/**
 * The public URL of a form: `/{accountCode}/f/{slug}`.
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
 * a member's public page) builds it here, so none of them can drift back.
 */

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
 */
export function publicFormPath(accountCode: string, slug: string): string {
  return `/${encodeURIComponent(accountCode)}/${PUBLIC_FORM_SEGMENT}/${encodeURIComponent(slug)}`;
}

/**
 * What the public page owes a request: a canonical tag, a redirect, or neither.
 *
 * `canonicalSlug` is the slug the API reports for the form, which differs from
 * the requested one only when the alias ledger resolved a retired slug.
 *
 * - A link to a retired slug is moved onto the current one, always under the
 *   neutral segment. The handle a visitor arrived with is never put back into
 *   the target, which also keeps visitor input out of the `Location` header.
 * - A link that still names a member (every link handed out before the neutral
 *   segment existed, printed QRs and live embeds included) keeps serving the
 *   form where it is, and only names the neutral URL as canonical. Forcing a
 *   redirect there would cost every such visit a second render and a second
 *   API call, because Next 16 can only redirect a streamed page from the
 *   browser; if that is ever wanted, it is `retired || named` below.
 * - A neutral link to the live slug is already the canonical URL.
 *
 * Neither result carries a query string: the caller appends the request's own
 * to the redirect, and a canonical naming `?utm_source=...` would ask crawlers
 * to index a campaign's copy of the page as the original.
 */
export function canonicalFor(
  route: { accountCode: string; handle: string; slug: string },
  canonicalSlug: string,
): { canonical: string | null; redirect: string | null } {
  const target = publicFormPath(route.accountCode, canonicalSlug);
  const retired = canonicalSlug !== route.slug;
  const named = route.handle !== PUBLIC_FORM_SEGMENT;
  return {
    canonical: retired || named ? target : null,
    redirect: retired ? target : null,
  };
}
