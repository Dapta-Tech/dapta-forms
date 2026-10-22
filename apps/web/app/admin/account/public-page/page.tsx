import { getMessages } from '@quill/shared';
import { adminApi } from '@/lib/admin-api';
import { getLocale } from '@/lib/locale';
import { LinkPageEditor } from './link-page-editor';
import '../../../[accountCode]/[handle]/[slug]/public-form.css';

export const dynamic = 'force-dynamic';

/**
 * Account settings, Public page: the WORKSPACE link page at `/{accountCode}`
 * (logo, name, bio, an ordered column of forms and links, social icons). It
 * replaced the per-member page that used to live here; those URLs redirect to
 * the workspace page now.
 *
 * Any member of the workspace edits it, so nothing here is admin-gated. The
 * public form stylesheet is loaded because the preview renders the public
 * page's own component.
 */
export default async function PublicPagePage() {
  const locale = await getLocale();
  const messages = getMessages(locale);
  const view = await adminApi.linkPage();

  return (
    <div data-testid="account-public-page">
      <LinkPageEditor
        initial={view}
        m={messages.admin.linkPage}
        networks={messages.linkPage.social}
        locale={locale}
      />
    </div>
  );
}
