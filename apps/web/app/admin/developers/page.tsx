import { redirect } from 'next/navigation';

/**
 * `/admin/developers` holds no page of its own: MCP is a group in the rail
 * (Connect, API docs). The address still answers because skill zips people
 * already downloaded link to it, and it lands them on the connector guide.
 */
export default function DevelopersIndex() {
  redirect('/admin/developers/connect');
}
