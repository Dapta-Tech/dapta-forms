/**
 * The browser half of in-app announcements: reporting to the API, and the
 * product-analytics events.
 *
 * Three events, each carrying the announcement id and where it happened:
 * `forms_announcement_seen` (once per browser session and surface, so a
 * dashboard left open does not count every navigation), `_dismissed` (the
 * card's close button) and `_clicked` (the announcement's route reached, by
 * the card's button, the rail item or on one's own).
 */
import type { AnnouncementEvent } from '@quill/shared';
import { recordAnnouncementAction } from '@/app/admin/announcement-actions';
import { callAction } from '@/lib/call-action';
import { captureEvent } from '@/lib/product-analytics';

/** Where the person met the announcement. `page`: they reached its route some other way. */
export type AnnouncementSurface = 'card' | 'rail' | 'page';

/** Store what the person did. Fire and forget: the card and badge already show it. */
export function reportAnnouncement(id: string, event: AnnouncementEvent): void {
  void callAction(() => recordAnnouncementAction(id, event));
}

/**
 * What this page load already knows, kept for as long as the tab lives. The
 * server's answer can be older than it: Back restores Home from the router's
 * cache with the card it had, and the layout is not re-rendered on client
 * navigation. Both surfaces read this before showing anything.
 */
const seenThisLoad = new Set<string>();
const cardClosed = new Set<string>();
const followed = new Set<string>();
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((l) => l());

/** One `seen` per announcement per load of the dashboard, whichever surface reports it first. */
export function reportAnnouncementSeen(id: string): void {
  if (seenThisLoad.has(id) || followed.has(id)) return;
  seenThisLoad.add(id);
  reportAnnouncement(id, 'seen');
}

export function markAnnouncementCardClosed(id: string): void {
  cardClosed.add(id);
  changed();
}

export function markAnnouncementFollowed(id: string): void {
  followed.add(id);
  changed();
}

/** Whether the card must stay hidden on this load: closed, or its route already reached. */
export function isAnnouncementCardClosed(id: string): boolean {
  return cardClosed.has(id) || followed.has(id);
}

export function isAnnouncementFollowed(id: string): boolean {
  return followed.has(id);
}

/** For `useSyncExternalStore`. */
export function subscribeAnnouncements(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Tests only: a fresh load. */
export function resetAnnouncementLoad(): void {
  seenThisLoad.clear();
  cardClosed.clear();
  followed.clear();
  pendingSurface = null;
}

/** `forms_announcement_seen`, at most once per browser session for this id and surface. */
export function captureAnnouncementSeen(id: string, surface: AnnouncementSurface): void {
  const key = `forms.announcement.seen:${id}:${surface}`;
  try {
    if (window.sessionStorage.getItem(key)) return;
    window.sessionStorage.setItem(key, '1');
  } catch {
    // Storage blocked: capture anyway, an extra event is better than none.
  }
  captureEvent('announcement_seen', { announcement_id: id, surface });
}

export function captureAnnouncement(
  event: 'dismissed' | 'clicked',
  id: string,
  surface: AnnouncementSurface,
): void {
  captureEvent(`announcement_${event}`, { announcement_id: id, surface });
}

/**
 * Which control is taking the person to the announcement's route. The rail
 * (in the layout) reports the visit when the route is reached, so a click on
 * the card's button or on the rail item leaves its name here first, and the
 * visit is filed under it.
 */
let pendingSurface: AnnouncementSurface | null = null;

export function markAnnouncementSurface(surface: 'card' | 'rail'): void {
  pendingSurface = surface;
}

export function takeAnnouncementSurface(): AnnouncementSurface {
  const surface = pendingSurface ?? 'page';
  pendingSurface = null;
  return surface;
}
