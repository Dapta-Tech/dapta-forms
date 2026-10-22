import { redirect } from 'next/navigation';

/**
 * The old API keys page. Keys are no longer created from the dashboard and the
 * existing ones are listed on the MCP page, under the connector guide, so the
 * address (in skill zips and bookmarks) lands there.
 */
export default function DeveloperKeysRedirect() {
  redirect('/admin/developers/connect');
}
