import type { Metadata } from 'next';
import { notFound, permanentRedirect } from 'next/navigation';
import { getMessages, publicFormPath, t } from '@quill/shared';
import { getPublicForm, getPublicLinkPageBySlug } from '@/lib/api';
import { publicLocale } from '@/lib/locale';
import {
  linkPageOgPath,
  linkPagePublicPath,
  plausibleAccountCode,
  plausiblePageSlug,
} from '@/lib/public-page';
import { LinkPageView } from '@/components/link-page/link-page-view';
import { LinkPageTracker } from '@/components/link-page/link-page-tracker';
import '../../[handle]/[slug]/public-form.css';

export const dynamic = 'force-dynamic';

/**
 * One of a workspace's other link pages: `/{accountCode}/p/{pageSlug}`.
 *
 * `p` is a static segment, like `f` for forms, so it wins over the dynamic
 * `[handle]/[slug]` form route at this depth and never collides with it. One
 * thing used to live at this exact address: a form linked through a member
 * whose handle was `p` (`/{accountCode}/p/{formSlug}`). Such a link still
 * works: when no page has that slug and a form does, it goes to the form's
 * own URL.
 *
 * - A retired page slug goes to the page's current one (the API answers the
 *   page with its current `pageSlug`).
 * - The default page goes to `/{accountCode}`, its one address.
 * - Off or missing: a 404, like the default page.
 *
 * The redirects are `permanentRedirect`, the same way a renamed form slug is
 * handled: Next 16 has started streaming by the time a page can redirect, so
 * browsers get it as a client redirect, and the canonical tag below names the
 * right URL for everything that does not run scripts. The query string rides
 * along, so a campaign's UTMs survive.
 */
type Query = Record<string, string | string[] | undefined>;
type Params = { params: Promise<{ accountCode: string; pageSlug: string }>; searchParams: Promise<Query> };

function searchSuffix(query: Query): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (Array.isArray(value)) for (const one of value) params.append(key, one);
    else if (value !== undefined) params.append(key, value);
  }
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

async function load(accountCode: string, pageSlug: string) {
  if (!plausibleAccountCode(accountCode) || !plausiblePageSlug(pageSlug)) return null;
  return getPublicLinkPageBySlug(accountCode, pageSlug);
}

const langOf = (query: Query) => (typeof query.lang === 'string' ? query.lang : undefined);

export async function generateMetadata({ params, searchParams }: Params): Promise<Metadata> {
  const { accountCode, pageSlug } = await params;
  const page = await load(accountCode, pageSlug);
  if (!page) return { title: 'Not found', robots: { index: false, follow: false } };
  const m = getMessages(await publicLocale(langOf(await searchParams)));
  const description = page.bio ?? t(m.linkPage.seoDescription, { name: page.name });
  const own = { slug: page.pageSlug ?? pageSlug, isDefault: page.isDefault === true };
  const images = [
    { url: linkPageOgPath(page.accountCode, own.isDefault ? null : own.slug), width: 1200, height: 630, alt: page.name },
  ];
  return {
    title: page.name,
    description,
    alternates: { canonical: linkPagePublicPath(page.accountCode, own) },
    robots: { index: true, follow: true },
    openGraph: { title: page.name, description, type: 'website', images },
    twitter: { card: 'summary_large_image', title: page.name, description, images },
  };
}

export default async function WorkspaceExtraLinkPage({ params, searchParams }: Params) {
  const { accountCode, pageSlug } = await params;
  const query = await searchParams;
  const page = await load(accountCode, pageSlug);
  if (!page) {
    // An old form link through a member whose handle was `p`.
    const form = plausibleAccountCode(accountCode) ? await getPublicForm(accountCode, pageSlug) : null;
    if (form) permanentRedirect(`${publicFormPath(accountCode, form.slug)}${searchSuffix(query)}`);
    notFound();
  }
  if (page.isDefault) permanentRedirect(`${linkPagePublicPath(accountCode, { slug: '', isDefault: true })}${searchSuffix(query)}`);
  const current = page.pageSlug ?? pageSlug;
  if (current !== pageSlug) {
    permanentRedirect(`${linkPagePublicPath(accountCode, { slug: current, isDefault: false })}${searchSuffix(query)}`);
  }
  const locale = await publicLocale(langOf(query));
  return (
    <>
      <LinkPageView page={page} locale={locale} />
      <LinkPageTracker accountCode={page.accountCode} pageSlug={current} />
    </>
  );
}
