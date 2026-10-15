import { redirect } from 'next/navigation';

/**
 * `/admin/developers` holds no page of its own any more: Developers is a group
 * in the rail (API keys, API docs). The address still answers because skill
 * zips people already downloaded link to it, and what they came for there was
 * a key.
 */
export default function DevelopersIndex() {
  redirect('/admin/developers/keys');
}
