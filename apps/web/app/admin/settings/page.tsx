import { redirect } from 'next/navigation';

// Settings hub defaults to General (matches the old app's '' → general redirect).
export default function SettingsIndex() {
  redirect('/admin/settings/general');
}
