import { getMessages } from '@slate/shared';
import { adminApi } from '@/lib/admin-api';
import { getLocale } from '@/lib/locale';
import { CreateTeamForm } from './create-team-form';

export const dynamic = 'force-dynamic';

export default async function NewTeamPage() {
  const [me, locale] = await Promise.all([adminApi.me(), getLocale()]);
  const m = getMessages(locale).admin.teams;
  const tz = me?.timeZone ?? 'America/New_York';

  return (
    <div className="mx-auto max-w-[1520px] px-8 pb-10">
      <CreateTeamForm
        messages={m}
        defaultTimeZone={tz}
        accountCode={me?.accountCode ?? ''}
        backHref="/admin/teams"
        backLabel={m.title}
        heading={m.createTitle}
      />
    </div>
  );
}
