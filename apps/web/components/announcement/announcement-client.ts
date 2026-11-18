/**
 * The browser half of in-app announcements: reporting to the API, what this
 * page load already knows, and the product-analytics events.
 *
 * Three events, each carrying the announcement id and where it happened:
 * `forms_announcement_seen` (once per browser session and surface, so a
 * dashboard left open does not count every navigation), `_dismissed` (the
 * pop-up closed, with how) and `_clicked` (the announcement's route reached,
 * by the pop-up's button, the Home banner, the rail item or on one's own).
 */
import type { AnnouncementEvent } from '@quill/shared';
import { recordAnnouncementAction } from '@/app/admin/announcement-actions';
import { callAction } from '@/lib/call-action';
import { captureEvent } from '@/lib/product-analytics';

/** Where the person met the announcement. `page`: they reached its route some other way. */
export type AnnouncementSurface = 'modal' | 'banner' | 'rail' | 'page';

/** How the pop-up was closed. */
export type AnnouncementDismissVia = 'close' | 'escape' | 'backdrop' | 'cta';

/** Store what the person did. Fire and forget: the screen already shows it. */
export function reportAnnouncement(id: string, event: AnnouncementEvent): void {
  void callAction(() => recordAnnouncementAction(id, event));
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

export function captureAnnouncementDismissed(id: string, via: AnnouncementDismissVia): void {
  captureEvent('announcement_dismissed', { announcement_id: id, surface: 'modal', via });
}

export function captureAnnouncementClicked(id: string, surface: AnnouncementSurface): void {
  captureEvent('announcement_clicked', { announcement_id: id, surface });
}

/**
 * Which control is taking the person to the announcement's route. The rail
 * (in the layout) reports the visit when the route is reached, so a click on
 * the pop-up's button, the banner's or the rail item leaves its name here
 * first, and the visit is filed under it.
 */
let pendingSurface: AnnouncementSurface | null = null;

export function markAnnouncementSurface(surface: Exclude<AnnouncementSurface, 'page'>): void {
  pendingSurface = surface;
}

export function takeAnnouncementSurface(): AnnouncementSurface {
  const surface = pendingSurface ?? 'page';
  pendingSurface = null;
  return surface;
}

/**
 * What this page load already knows, kept for as long as the tab lives. The
 * layout that read the announcement is not re-rendered on client navigation,
 * so the rail and the pop-up read this before showing anything.
 */
const followed = new Set<string>();
const listeners = new Set<() => void>();

export function markAnnouncementFollowed(id: string): void {
  followed.add(id);
  listeners.forEach((l) => l());
}

export function isAnnouncementFollowed(id: string): boolean {
  return followed.has(id);
}

/** For `useSyncExternalStore`. */
export function subscribeAnnouncements(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * The pop-up opens on the first dashboard load of a browser session where it
 * is due. Closing it ends it for good (in the database); a reload without
 * closing it does not bring it back until the next session.
 */
export function announcementShownThisSession(id: string): boolean {
  try {
    return window.sessionStorage.getItem(`forms.announcement.shown:${id}`) === '1';
  } catch {
    return false;
  }
}

export function markAnnouncementShownThisSession(id: string): void {
  try {
    window.sessionStorage.setItem(`forms.announcement.shown:${id}`, '1');
  } catch {
    // Storage blocked: the database still ends it once closed.
  }
}

/** Tests only: a fresh load. */
export function resetAnnouncementLoad(): void {
  followed.clear();
  pendingSurface = null;
}
