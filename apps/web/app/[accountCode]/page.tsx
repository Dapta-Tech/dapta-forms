import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getMessages, t } from '@quill/shared';
import { getPublicLinkPage } from '@/lib/api';
import { publicLocale } from '@/lib/locale';
import { linkPageOgPath, plausibleAccountCode } from '@/lib/public-page';
import { LinkPageView } from '@/components/link-page/link-page-view';
import { LinkPageTracker } from '@/components/link-page/link-page-tracker';
import './[handle]/[slug]/public-form.css';

export const dynamic = 'force-dynamic';

/**
 * The workspace link page: `/{accountCode}`.
 *
 * One page per workspace, built in Account settings, Public page: the
 * workspace's logo, name and bio, its chosen forms and links in one ordered
 * column, its social icons and the "Made with dForms" pill.
 *
 * A 404 until someone in the workspace publishes it: the API answers null for
 * an unknown code, a workspace with no page and a page switched off alike.
 * The member pages that used to live one level down (`/{accountCode}/{handle}`)
 * now redirect here.
 *
 * Rendered by `LinkPageView`, the same component the editor's preview uses.
 */
type Params = { params: Promise<{ accountCode: string }>; searchParams: Promise<{ lang?: string }> };

async function load(accountCode: string) {
  // Anything that cannot be a workspace code (a stray `/favicon.ico`, a
  // scanner's probe) is a 404 without a call to the API.
  if (!plausibleAccountCode(accountCode)) return null;
  return getPublicLinkPage(accountCode);
}

export async function generateMetadata({ params, searchParams }: Params): Promise<Metadata> {
  const { accountCode } = await params;
  const page = await load(accountCode);
  if (!page) return { title: 'Not found', robots: { index: false, follow: false } };
  const m = getMessages(await publicLocale((await searchParams).lang));
  const description = page.bio ?? t(m.linkPage.seoDescription, { name: page.name });
  const images = [{ url: linkPageOgPath(page.accountCode), width: 1200, height: 630, alt: page.name }];
  return {
    title: page.name,
    description,
    alternates: { canonical: `/${page.accountCode}` },
    robots: { index: true, follow: true },
    openGraph: { title: page.name, description, type: 'website', images },
    twitter: { card: 'summary_large_image', title: page.name, description, images },
  };
}

export default async function WorkspaceLinkPage({ params, searchParams }: Params) {
  const { accountCode } = await params;
  const page = await load(accountCode);
  if (!page) notFound();
  const locale = await publicLocale((await searchParams).lang);
  return (
    <>
      <LinkPageView page={page} locale={locale} />
      <LinkPageTracker accountCode={page.accountCode} />
    </>
  );
}
