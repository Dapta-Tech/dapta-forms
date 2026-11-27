import { getMessages } from '@quill/shared';
import { adminApi } from '@/lib/admin-api';
import { getLocale } from '@/lib/locale';
import {
  PLAYBOOK_LANG_PARAM,
  PLAYBOOK_TAB_PARAM,
  asPlaybookLocale,
  playbookLangStorageKey,
  playbookLocaleFor,
  tabFromParam,
  visibleTabs,
} from '@/lib/playbooks';
import { PlaybooksGallery } from '@/components/playbooks/playbooks-gallery';

export const dynamic = 'force-dynamic';

/**
 * Playbooks: the free guides every person in dForms can read, whatever their
 * role or workspace. The list and each one's state ("New", read, not read)
 * come from `GET /v1/me/playbooks`, read here BEFORE the gallery records this
 * visit (it does so from the client, once on screen), so the marks the visit
 * clears still show this once. `?category=` opens a tab; the tabs then switch
 * on the client without a round trip.
 *
 * The list is read in both playbook languages (cards only, never a body), so
 * the ES / EN toggle switches on the client too. `?lang=` opens one; without
 * it the gallery opens in the platform's language and then applies the
 * person's stored choice, if any.
 */
export default async function PlaybooksPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [locale, params, es, en, me] = await Promise.all([
    getLocale(),
    searchParams,
    adminApi.playbooks('es'),
    adminApi.playbooks('en'),
    adminApi.me(),
  ]);
  const m = getMessages(locale).admin.playbooks;
  const tabs = visibleTabs(es.categories);
  return (
    <PlaybooksGallery
      cardsByLocale={{ es: es.playbooks, en: en.playbooks }}
      initialLocale={playbookLocaleFor(params[PLAYBOOK_LANG_PARAM], locale)}
      langInUrl={asPlaybookLocale(params[PLAYBOOK_LANG_PARAM]) !== null}
      storageKey={playbookLangStorageKey(me.memberId)}
      tabs={tabs}
      initialTab={tabFromParam(params[PLAYBOOK_TAB_PARAM], tabs)}
      newCount={es.newCount}
      now={Date.now()}
      locale={locale}
      m={m}
    />
  );
}
