'use server';

import { unstable_rethrow } from 'next/navigation';
import { ANNOUNCEMENT_EVENTS, type AnnouncementEvent } from '@quill/shared';
import { adminApi } from '@/lib/admin-api';

/**
 * Report what the person did with an in-app announcement: it was on screen
 * (`seen`), they closed its card (`dismissed`), or they reached its route
 * (`clicked`). The API stores it against the person, which is what keeps the
 * card from coming back in the next session or the next browser.
 *
 * No revalidation: the card and the badge already reflect the action on the
 * client, and the next server render reads the stored state anyway.
 */
export async function recordAnnouncementAction(id: string, event: AnnouncementEvent): Promise<{ ok: boolean }> {
  if (!(ANNOUNCEMENT_EVENTS as readonly string[]).includes(event)) return { ok: false };
  try {
    await adminApi.recordAnnouncement(id, event);
    return { ok: true };
  } catch (e) {
    unstable_rethrow(e);
    return { ok: false };
  }
}
