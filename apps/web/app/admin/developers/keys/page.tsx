import { redirect } from 'next/navigation';

/**
 * The old API keys page. Keys are no longer created, listed or revoked from the
 * dashboard (existing ones keep working with the REST API), so the address, in
 * skill zips and bookmarks, lands on the MCP connector page instead.
 */
export default function DeveloperKeysRedirect() {
  redirect('/admin/developers/connect');
}
