import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getPublicForm } from '@/lib/api';
import { publicLocale } from '@/lib/locale';
import { MadeWithBadge } from '@/components/made-with-badge';
import { FormRenderer } from './form-renderer';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ accountCode: string; slug: string }>;
}): Promise<Metadata> {
  const { accountCode, slug } = await params;
  const form = await getPublicForm(accountCode, slug);
  if (!form) return {};
  return { title: form.name, openGraph: { title: form.name, type: 'website' } };
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

  return (
    <>
      <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center px-6 py-12">
        <FormRenderer accountCode={accountCode} slug={slug} name={form.name} config={form.config} />
      </main>
      <MadeWithBadge locale={locale} accountCode={accountCode} />
    </>
  );
}
