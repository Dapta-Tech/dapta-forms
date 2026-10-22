/**
 * The public URL of a form: `/{accountCode}/f/{slug}`.
 *
 * The rule itself (the neutral `f` segment, the per-segment encoding, and why a
 * member handle no longer appears there) lives in `@quill/shared`, because the
 * API hands the same link to agents as `publicUrl` and must not keep a second
 * copy. It is re-exported here so every web surface keeps importing it from
 * one place, and this module keeps the web-only half: `canonicalFor`.
 */
import { PUBLIC_FORM_SEGMENT, publicFormPath } from '@quill/shared';

export { PUBLIC_FORM_SEGMENT, publicFormPath } from '@quill/shared';

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

/**
 * Every public form is `noindex, follow`. A form is a customer's page living on
 * our domain: a question and a submit button, thin to a search engine and never
 * what a searcher wants. Indexed by the thousand, those pages would sit under
 * dforms.ai beside the blog and drag the whole domain down. Forms reach people
 * through links, QR codes and embeds, never through Google. `follow` stays on so
 * the "Made with" badge still passes its link to the landing.
 */
export const PUBLIC_FORM_ROBOTS = { index: false, follow: true } as const;
