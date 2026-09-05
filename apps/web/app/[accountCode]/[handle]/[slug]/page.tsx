import type { Metadata } from 'next';
import { notFound, permanentRedirect } from 'next/navigation';
import { getPublicForm } from '@/lib/api';
import { publicLocale } from '@/lib/locale';
import { getMessages, t } from '@quill/shared';
import { resolveFormLayout, publicTitle } from '@quill/engine';
import { resolveTracking } from '@/components/tracking/resolve-tracking';
import { TrackingScripts } from '@/components/tracking/tracking-scripts';
import { EmbedHeightReporter } from '@/components/public/embed-height-reporter';
import { FormRenderer } from './form-renderer';
import { VerticalFormRenderer } from './vertical-form-renderer';

/**
 * SEO/OG metadata for the public form — the form name as the title and a
 * localized description (the form's cover subheadline when present, else a
 * templated fallback). `noindex` support is deferred to a later phase.
 */
export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ accountCode: string; handle: string; slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<Metadata> {
  const { accountCode, handle, slug } = await params;
  const form = await getPublicForm(accountCode, slug);
  if (!form) return {};
  const query = await searchParams;
  const lang = typeof query.lang === 'string' ? query.lang : undefined;
  // NOTE: this function deliberately does NOT redirect, even though it runs
  // before the page and looks like the earlier, better place to do it. Next 16
  // has already begun streaming by the time either one resolves, so a redirect
  // thrown here comes out exactly as soft as the one in the page body: an RSC
  // payload plus a `<meta http-equiv="refresh">`, answered with 200. It would
  // buy nothing, and it would cost the tag below, because throwing means never
  // returning metadata at all. So the redirect stays in the page (for people,
  // whose browsers follow it) and this function keeps naming the canonical URL
  // (for everything that does not run scripts).
  // The same rule as the page body: ?lang, then the form's language, then
  // the browser. The description must agree with the page it describes.
  const locale = await publicLocale(lang, form.config.language ?? null);
  // The author-set public title wins over the private dashboard name.
  const title = publicTitle(form.config, form.name);
  const description =
    form.config.cover?.subheadline ?? t(getMessages(locale).growth.seoForm, { name: title });

  // An author-supplied card wins outright; otherwise the sibling
  // `opengraph-image` route renders one from the form's own branding, and Next
  // wires it up automatically when `images` is left undefined.
  const custom = form.config.branding?.ogImage?.trim();
  const images = custom ? [{ url: custom }] : undefined;

  return {
    title,
    description,
    // Emitted ONLY when the requested slug is a retired one, where it is the
    // only signal a crawler, a link checker or a social unfurler gets that the
    // URL it fetched is not the current one (the redirect beside it is
    // client-side). No query string on it: a canonical naming `?utm_source=…`
    // would ask crawlers to index a campaign's copy of the page as the original.
    //
    // NOT emitted on a normal request, which would be the obvious thing to do
    // and would be actively harmful. `handle` is decorative in a form URL: the
    // lookup below is `getPublicForm(accountCode, slug)` and nothing validates
    // the middle segment, so `/acme/anything-at-all/my-form` serves the form
    // today. A self-referential canonical would then mint a fresh "canonical"
    // URL for every spelling anyone tries, which is the opposite of the tag's
    // job. There is no value to put there instead, either: a form belongs to an
    // account, not to a member, and the builder itself composes this path from
    // whichever member is LOOKING at it. So the tag only ever corrects the one
    // segment this page can actually speak to, and forwards the rest.
    ...(form.slug === slug
      ? {}
      : { alternates: { canonical: canonicalPath(accountCode, handle, form.slug) } }),
    openGraph: { title, description, type: 'website', ...(images ? { images } : {}) },
    twitter: {
      // A generated 1200×630 card deserves the large format; only a form with
      // neither would fall back to the small one, and there is no such form.
      card: 'summary_large_image',
      title,
      description,
      ...(images ? { images } : {}),
    },
  };
}

/**
 * Re-serialize the query string for the canonical redirect, verbatim.
 *
 * Every parameter is forwarded, not a known subset, and this is the whole point
 * of the function. Dropping the query on OUR OWN redirect is precisely how the
 * platform lost campaign attribution once already: the UTMs never reached the
 * page they were pointed at, and the identity provider got the blame for weeks.
 * A renamed slug is the same trap with a fresh coat of paint, and it also
 * carries `?embed=1` (an iframe on someone else's site) and `?step=N` (a
 * half-finished form somebody bookmarked).
 *
 * Repeated keys are appended rather than collapsed: Next hands those over as an
 * array, and `?tag=a&tag=b` must arrive as it left.
 */
function searchSuffix(query: Record<string, string | string[] | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (Array.isArray(value)) for (const one of value) params.append(key, one);
    else if (value !== undefined) params.append(key, value);
  }
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

/**
 * Send a retired slug to the form's current URL, or return and let the caller
 * carry on. `canonical` is the slug the API reports for the form itself, which
 * differs from the requested one only when the alias ledger resolved it (the
 * author renamed the link; see migration 0017).
 *
 * `accountCode` and `handle` are forwarded exactly as they arrived. A retired
 * ACCOUNT code resolves transparently today, with no redirect anywhere, and
 * quietly rewriting it here would be a second behaviour change smuggled in
 * beside this one.
 */
function redirectToCanonical(
  route: { accountCode: string; handle: string; slug: string },
  canonical: string,
  query: Record<string, string | string[] | undefined>,
): void {
  if (canonical === route.slug) return;
  permanentRedirect(`${canonicalPath(route.accountCode, route.handle, canonical)}${searchSuffix(query)}`);
}

/**
 * Build a public form path from segments that arrived in the URL.
 *
 * `encodeURIComponent` on each of them, because Next hands over the DECODED
 * value and two of the three are effectively free text: `handle` is never
 * validated (nothing routes on it, see the note in `generateMetadata`) and
 * `accountCode` only has to resolve to some account. A `handle` of `%0d%0a`
 * therefore arrives as a real CRLF, and interpolating that straight into a
 * `Location` header makes Node reject the response with ERR_INVALID_CHAR: a
 * 500 that any visitor can trigger by editing the address bar. The slug is
 * already `[a-z0-9-]` by the time it gets here and passes through unchanged.
 */
function canonicalPath(accountCode: string, handle: string, slug: string): string {
  return `/${encodeURIComponent(accountCode)}/${encodeURIComponent(handle)}/${encodeURIComponent(slug)}`;
}

// Public form page. The Server Component fetches the published config; the
// interactive multi-step flow is a client island (FormRenderer).
export default async function PublicFormPage({
  params,
  searchParams,
}: {
  params: Promise<{ accountCode: string; handle: string; slug: string }>;
  // Typed wide, not as { lang, embed }: the redirect below has to forward
  // EVERY parameter it was given, including ones this page never reads.
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { accountCode, handle, slug } = await params;
  const query = await searchParams;
  const lang = typeof query.lang === 'string' ? query.lang : undefined;
  // Embedded render (?embed=1): same form, sized by its content instead of the
  // viewport, reporting its height to the host page's embed.js (iframe embeds).
  const embedded = query.embed === '1';

  const form = await getPublicForm(accountCode, slug);
  if (!form) notFound();
  // ?lang, then the form's own language (Auto = absent), then the browser.
  const locale = await publicLocale(lang, form.config.language ?? null);

  // Reached through a slug this form USED to answer to: the author renamed the
  // link and the alias ledger resolved the old one (see migration 0017). Move
  // the visitor onto the current URL rather than leaving the form living at two
  // addresses. Next resolves this on the client (see the note in
  // `generateMetadata`), so it moves a browser and nothing else; the canonical
  // tag is what speaks to everything else.
  redirectToCanonical({ accountCode, handle, slug }, form.slug, query);

  // Third-party tags for the PUBLIC page only (admin renders none): per-form
  // config.tracking over NEXT_PUBLIC_* env defaults; nothing configured
  // renders nothing (zero third-party requests).
  const tracking = resolveTracking(form.config.tracking);

  // The config decides the presentation: slides (the original one-question-per-
  // screen walk) or vertical (one page). Same engine, same submit contract.
  const Renderer = resolveFormLayout(form.config) === 'vertical' ? VerticalFormRenderer : FormRenderer;

  return (
    <>
      <TrackingScripts tracking={tracking} />
      {embedded ? <EmbedHeightReporter /> : null}
      {/* The wrapper class relaxes the renderers' viewport-height rules so the
          document's height IS the content's — what the reporter measures. */}
      {/* The form's OWN language, declared on its subtree.
          `<html lang>` in the root layout carries the ADMIN's choice, which a
          respondent never made and usually has no cookie for. Stamping it here
          means a Spanish form reached with `?lang=es` is announced as Spanish to
          a screen reader and offered to a translator as Spanish, whatever the
          document element says, and an author previewing their own form does not
          relabel it with their dashboard preference. */}
      <div lang={locale} className={embedded ? 'pf-embed-root' : undefined}>
        {/* The "Made with Dapta Forms" attribution is NOT a document footer:
            the renderers place it inside `.pf` themselves. As a sibling here it
            started exactly where the first `100dvh` viewport ended, so it was
            below the fold on every slides form and past the whole scroll on a
            vertical one. See `components/made-with-badge.tsx`. */}
        <Renderer
          accountCode={accountCode}
          slug={slug}
          name={publicTitle(form.config, form.name)}
          config={form.config}
          locale={locale}
        />
      </div>
    </>
  );
}
