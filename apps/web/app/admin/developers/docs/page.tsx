import Link from 'next/link';
import { getMessages } from '@quill/shared';
import { buttonVariants } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { getLocale } from '@/lib/locale';
import { publicApiUrl } from '@/lib/developer-skill/public-api-url';
import { ApiDocsView } from './api-docs-view';
import { API_KEYS_PATH, buildDocsModel, docsChrome, referenceProse } from './docs-model';

export const dynamic = 'force-dynamic';

/**
 * API docs: every route an API key may call, rendered from the typed catalog
 * (`API_REFERENCE` in `@quill/shared`) so the page cannot drift from what the
 * API allows (the API's own spec holds the catalog to `API_KEY_ALLOWED_ROUTES`).
 *
 * A server component that does the reading: the locale, the prose, and this
 * environment's public API address, from the RUNTIME environment on every
 * render (`publicApiUrl`), so one image shows each environment its own address
 * in every curl example. The view it hands the finished model to only filters,
 * highlights the section in view and copies.
 *
 * No data call: the layout already gated the session, and nothing here depends
 * on who is reading (the role marks are on the endpoints, for everyone).
 */
export default async function ApiDocsPage() {
  const locale = await getLocale();
  const admin = getMessages(locale).admin;
  const m = docsChrome(admin.apiDocs);
  const x = admin.apiDocsPage;
  const model = buildDocsModel(referenceProse(admin), publicApiUrl());

  return (
    <div className="mx-auto max-w-6xl px-6 py-10 sm:px-8">
      <PageHeader
        title={m.title}
        subtitle={m.subtitle}
        action={
          <Link href={API_KEYS_PATH} className={buttonVariants({ variant: 'outline', size: 'sm' })}>
            <i aria-hidden className="pi pi-key" style={{ fontSize: 13 }} />
            {x.keysLink}
          </Link>
        }
      />
      <ApiDocsView model={model} m={m} x={x} d={admin.developerDocs} locale={locale} />
    </div>
  );
}
