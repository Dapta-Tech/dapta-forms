import { getMessages } from '@slate/shared';
import { adminApi } from '@/lib/admin-api';
import { getLocale } from '@/lib/locale';
import { LanguageSwitcher } from '@/components/language-switcher';
import { GeneralForm } from './general-form';

export const dynamic = 'force-dynamic';

export default async function GeneralSettings() {
  const me = await adminApi.me();
  const profile = me?.handle
    ? await adminApi.profile(me.accountCode, me.handle)
    : null;
  const locale = await getLocale();
  const m = getMessages(locale).admin;

  return (
    <div className="flex max-w-2xl flex-col gap-8">
      <GeneralForm
        displayName={me?.displayName ?? ''}
        handle={me?.handle ?? ''}
        accountCode={me?.accountCode ?? ''}
        timeZone={(profile?.member as { timeZone?: string })?.timeZone ?? 'UTC'}
        messages={m.settingsGeneral}
      />
      <div className="border-t border-border pt-6">
        <LanguageSwitcher locale={locale} label={m.common.language} />
      </div>
    </div>
  );
}
