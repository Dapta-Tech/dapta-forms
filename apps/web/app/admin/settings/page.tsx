import { redirect } from 'next/navigation';

/**
 * Settings moved behind the profile button: /admin/account (Workspaces · Brand
 * kit · Notifications · Public page). Kept as a redirect so bookmarks, the
 * e2e harness and any external link keep working.
 */
export default function SettingsRedirect(): never {
  redirect('/admin/account/workspaces');
}
