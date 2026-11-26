import { getMessages } from '@quill/shared';
import { adminApi } from '@/lib/admin-api';
import { getLocale } from '@/lib/locale';
import { PLAYBOOK_TAB_PARAM, tabFromParam, visibleTabs } from '@/lib/playbooks';
import { PlaybooksGallery } from '@/components/playbooks/playbooks-gallery';

export const dynamic = 'force-dynamic';

/**
 * Playbooks: the free guides every person in dForms can read, whatever their
 * role or workspace. The list and each one's state ("New", read, not read)
 * come from `GET /v1/me/playbooks`, read here BEFORE the gallery records this
 * visit (it does so from the client, once on screen), so the marks the visit
 * clears still show this once. `?category=` opens a tab; the tabs then switch
 * on the client without a round trip.
 */
export default async function PlaybooksPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [locale, params, list] = await Promise.all([getLocale(), searchParams, adminApi.playbooks()]);
  const m = getMessages(locale).admin.playbooks;
  const tabs = visibleTabs(list.categories);
  return (
    <PlaybooksGallery
      cards={list.playbooks}
      tabs={tabs}
      initialTab={tabFromParam(params[PLAYBOOK_TAB_PARAM], tabs)}
      newCount={list.newCount}
      now={Date.now()}
      locale={locale}
      m={m}
    />
  );
}
