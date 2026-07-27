import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getPublicForm } from '@/lib/api';
import { publicLocale } from '@/lib/locale';
import { getMessages, t } from '@quill/shared';
import { MadeWithBadge } from '@/components/made-with-badge';
import { resolveFormLayout } from '@quill/engine';
import { resolveTracking } from '@/components/tracking/resolve-tracking';
import { TrackingScripts } from '@/components/tracking/tracking-scripts';
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
  const description =
    form.config.cover?.subheadline ?? t(getMessages(locale).growth.seoForm, { name: form.name });
  return {
    title: form.name,
    description,
    openGraph: { title: form.name, description, type: 'website' },
    twitter: { card: 'summary', title: form.name, description },
  };
}

// Public form page. The Server Component fetches the published config; the
// interactive multi-step flow is a client island (FormRenderer).
export default async function PublicFormPage({
  params,
  searchParams,
}: {
  params: Promise<{ accountCode: string; handle: string; slug: string }>;
  searchParams: Promise<{ lang?: string }>;
}) {
  const { accountCode, slug } = await params;
  const { lang } = await searchParams;
  const locale = await publicLocale(lang);

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
      <Renderer
        accountCode={accountCode}
        slug={slug}
        name={form.name}
        config={form.config}
        locale={locale}
      />
      <MadeWithBadge locale={locale} accountCode={accountCode} />
    </>
  );
}
