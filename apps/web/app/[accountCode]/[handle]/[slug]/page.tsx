import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
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
}: {
  params: Promise<{ accountCode: string; slug: string; lang?: string }>;
}): Promise<Metadata> {
  const { accountCode, slug } = await params;
  const form = await getPublicForm(accountCode, slug);
  if (!form) return {};
  const locale = await publicLocale();
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

// Public form page. The Server Component fetches the published config; the
// interactive multi-step flow is a client island (FormRenderer).
export default async function PublicFormPage({
  params,
  searchParams,
}: {
  params: Promise<{ accountCode: string; handle: string; slug: string }>;
  searchParams: Promise<{ lang?: string; embed?: string }>;
}) {
  const { accountCode, slug } = await params;
  const { lang, embed } = await searchParams;
  const locale = await publicLocale(lang);
  // Embedded render (?embed=1): same form, sized by its content instead of the
  // viewport, reporting its height to the host page's embed.js (iframe embeds).
  const embedded = embed === '1';

  const form = await getPublicForm(accountCode, slug);
  if (!form) notFound();

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
      <div className={embedded ? 'pf-embed-root' : undefined}>
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
