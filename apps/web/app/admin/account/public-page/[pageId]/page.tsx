import { notFound } from 'next/navigation';
import { getMessages } from '@quill/shared';
import { adminApi, ApiError } from '@/lib/admin-api';
import { getLocale } from '@/lib/locale';
import { LinkPageEditor } from '../link-page-editor';
import '../../../../[accountCode]/[handle]/[slug]/public-form.css';

export const dynamic = 'force-dynamic';

/**
 * Account settings, Public page, one page: the editor every workspace page
 * had before there could be several, plus the page's internal name and its
 * address. Any member of the workspace edits it. An id from another
 * workspace (or a deleted page) is a 404.
 */
export default async function LinkPageEditPage({ params }: { params: Promise<{ pageId: string }> }) {
  const { pageId } = await params;
  const locale = await getLocale();
  const messages = getMessages(locale);
  let view;
  try {
    view = await adminApi.linkPageById(pageId);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  }

  return (
    <div data-testid="account-public-page">
      <LinkPageEditor
        key={view.id ?? pageId}
        initial={view}
        m={messages.admin.linkPage}
        networks={messages.linkPage.social}
        locale={locale}
      />
    </div>
  );
}
