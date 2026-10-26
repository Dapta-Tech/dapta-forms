import { getMessages } from '@quill/shared';
import { adminApi } from '@/lib/admin-api';
import { getLocale } from '@/lib/locale';
import { LinkPagesList } from './link-pages-list';

export const dynamic = 'force-dynamic';

/**
 * Account settings, Public page: the WORKSPACE's link pages, up to 20. The
 * default one answers at `/{accountCode}` (the address the single page always
 * had), every other one at `/{accountCode}/p/{slug}`. Each row opens the
 * editor at `./[pageId]`.
 *
 * Any member of the workspace creates, edits and deletes pages, so nothing
 * here is admin-gated.
 */
export default async function PublicPagePage() {
  const locale = await getLocale();
  const messages = getMessages(locale);
  const [list, me] = await Promise.all([adminApi.linkPages(), adminApi.me()]);

  return (
    <div data-testid="account-public-page">
      <LinkPagesList
        initial={list}
        m={messages.admin.linkPages}
        qr={messages.admin.linkPage}
        locale={locale}
        timeZone={me.timezone ?? 'UTC'}
      />
    </div>
  );
}
