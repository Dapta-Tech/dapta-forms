import { getMessages } from '@quill/shared';
import { getLocale } from '@/lib/locale';
import { LanguageSettings } from './language-settings';

export const dynamic = 'force-dynamic';

/**
 * Account settings → Preferences: the settings that belong to the PERSON.
 *
 * No `ManagingChip` here, unlike its four neighbours. The others act on a
 * workspace and have to name which one; this page does not, and captioning it
 * with a workspace would say the opposite of what it does - your language
 * follows you into every workspace you open.
 *
 * Not admin-gated, for the same reason: the plainest member of a workspace
 * still chooses what language they read.
 */
export default async function PreferencesPage() {
  const locale = await getLocale();
  const m = getMessages(locale).admin.account.preferences;

  return <LanguageSettings locale={locale} m={m} />;
}
