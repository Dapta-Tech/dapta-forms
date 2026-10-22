import { redirect } from 'next/navigation';

/**
 * The old API docs page. The dashboard now explains what an agent can do on
 * the Tools page, in plain words; links to the old address land there.
 */
export default function DeveloperDocsRedirect() {
  redirect('/admin/developers/tools');
}
