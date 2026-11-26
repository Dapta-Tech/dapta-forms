'use server';

import { unstable_rethrow } from 'next/navigation';
import { adminApi } from '@/lib/admin-api';
import { isPlaybookSlug } from '@/lib/playbooks';

/**
 * Record a visit to the playbooks gallery. The gallery calls it once it is on
 * screen, after its own render read the list, so the marks this visit clears
 * ("New" on the cards, the count beside the title) still show this once.
 *
 * No revalidation: the rail clears its badge on the client, and the next
 * server render reads the stored visit anyway.
 */
export async function recordPlaybooksGalleryVisitAction(): Promise<{ ok: boolean }> {
  try {
    await adminApi.recordPlaybooksGalleryVisit();
    return { ok: true };
  } catch (e) {
    unstable_rethrow(e);
    return { ok: false };
  }
}

/** Record that the person opened one playbook (the reader calls it on open). */
export async function recordPlaybookSeenAction(slug: string): Promise<{ ok: boolean }> {
  if (!isPlaybookSlug(slug)) return { ok: false };
  try {
    await adminApi.recordPlaybookSeen(slug);
    return { ok: true };
  } catch (e) {
    unstable_rethrow(e);
    return { ok: false };
  }
}
