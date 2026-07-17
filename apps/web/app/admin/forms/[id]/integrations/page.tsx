import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

/**
 * Per-form integrations moved into the editor's Connect tab (Typeform parity).
 * This route survives as a permanent redirect so old links/bookmarks keep
 * working. The IntegrationsEditor + auto-map modules co-located here are still
 * the live implementation — the Connect tab imports them.
 */
export default async function IntegrationsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/admin/forms/${id}/edit?tab=connect`);
}
