/**
 * In-app announcements: product news shown inside the dashboard, once per
 * person, without blocking anything. A card at the top of the home and,
 * optionally, a "New" mark on one rail item.
 *
 * The list lives in code on purpose: publishing an announcement is a pull
 * request, reviewed like any other change, and a fork gets exactly the
 * announcements its own repository carries (minus the `daptaOnly` ones). Who
 * has seen, closed or followed each one lives in the database, per person
 * (`announcement_state`, migration 0029), never only in the browser.
 *
 * This module is framework-free: the API decides which announcement a person
 * gets with `pickAnnouncement`, and the web app reads the same definitions to
 * render the copy and the media.
 */
import type { FormsMessages } from './i18n';

/** Which announcement's copy, by key into `admin.announcements.items`. */
export type AnnouncementCopyKey = keyof FormsMessages['admin']['announcements']['items'];

/** A rail item an announcement can mark with "New". Named by its nav key. */
export type AnnouncementRailItem = 'integrations';

/**
 * The looping animation of a card. Files live under `apps/web/public` as
 * `{src}-{light|dark}.webm`, `{src}-{light|dark}.mp4` and
 * `{src}-{light|dark}-poster.png`, so the card follows the dashboard's theme.
 * `width` and `height` are the render's, used for the aspect ratio the card
 * reserves before anything loads.
 */
export interface AnnouncementVideo {
  kind: 'video';
  src: string;
  width: number;
  height: number;
}

export interface Announcement {
  /** Stable and never reused: per-person state is keyed by it. */
  id: string;
  /** Epoch ms, inclusive. */
  startsAt: number;
  /** Epoch ms, exclusive. After it the announcement is gone for everyone. */
  endsAt: number;
  copy: AnnouncementCopyKey;
  /** An internal route. Reaching it, by the button or on one's own, completes the announcement. */
  cta: string;
  visual: AnnouncementVideo;
  /** The rail item that carries "New" while the announcement is live, or null for none. */
  railBadge: AnnouncementRailItem | null;
  /** Names Dapta or a Dapta product: never shown on a fork. */
  daptaOnly: boolean;
}

/**
 * Every announcement, oldest first. Add new ones at the end with a fresh id.
 *
 * Dates are written in Bogota time (UTC-5, no daylight saving), where the team
 * that publishes them works.
 */
export const ANNOUNCEMENTS: readonly Announcement[] = [
  {
    id: 'integrations-2026-11',
    startsAt: Date.parse('2026-11-19T00:00:00-05:00'),
    // Through December 19 included.
    endsAt: Date.parse('2026-12-20T00:00:00-05:00'),
    copy: 'integrations-2026-11',
    cta: '/admin/integrations',
    visual: { kind: 'video', src: '/announcements/announce-integrations', width: 1280, height: 720 },
    railBadge: 'integrations',
    // It names dCal, a Dapta product.
    daptaOnly: true,
  },
];

/**
 * A person who sees an announcement and does nothing stops seeing it after this
 * many sessions. Closing the card is doing something: the badge left behind
 * then waits for the visit (or the end date), whatever the count.
 */
export const ANNOUNCEMENT_MAX_SESSIONS = 5;

/**
 * Two sightings this far apart are two sessions; closer, the same one. Thirty
 * minutes of inactivity, the usual definition of a web session.
 */
export const ANNOUNCEMENT_SESSION_GAP_MS = 30 * 60 * 1000;

/** What a person did with one announcement, as stored. */
export interface AnnouncementUserState {
  announcementId: string;
  /** Distinct sessions in which the announcement was on screen. */
  sessionsSeen: number;
  lastSeenAt: number | null;
  /** The card's close button. The rail badge outlives it. */
  dismissedAt: number | null;
  /** The button, or reaching the `cta` route on one's own. Ends the announcement for this person. */
  clickedAt: number | null;
}

/** The announcement a person gets right now, and where it shows. */
export interface AnnouncementPick {
  announcement: Announcement;
  /** The home card. False once the person closed it. */
  card: boolean;
  /** The rail badge. */
  badge: boolean;
}

/** The events a person's browser reports for an announcement. */
export const ANNOUNCEMENT_EVENTS = ['seen', 'dismissed', 'clicked'] as const;
export type AnnouncementEvent = (typeof ANNOUNCEMENT_EVENTS)[number];

/** Whether the announcement is within its dates and allowed on this deployment. */
export function isAnnouncementLive(a: Announcement, now: number, opts: { dapta: boolean }): boolean {
  if (a.daptaOnly && !opts.dapta) return false;
  return now >= a.startsAt && now < a.endsAt;
}

/**
 * Has the person used up the sessions an untouched announcement gets? The
 * fifth session is still shown to its end: only a sixth would not be.
 */
export function sessionsExhausted(state: AnnouncementUserState | undefined, now: number): boolean {
  if (!state || state.sessionsSeen < ANNOUNCEMENT_MAX_SESSIONS) return false;
  const inSession = state.lastSeenAt != null && now - state.lastSeenAt < ANNOUNCEMENT_SESSION_GAP_MS;
  return !inSession;
}

/**
 * The one announcement a person gets, if any.
 *
 * Only one at a time. Among the live ones the person has not followed, the most
 * recent whose card they have not closed (and that has sessions left) wins,
 * card and badge. If every such card is closed, the most recent closed one
 * with a rail badge keeps its badge alone: closing the card does not clear it,
 * only the visit or the end date does.
 */
export function pickAnnouncement(
  list: readonly Announcement[],
  states: readonly AnnouncementUserState[],
  now: number,
  opts: { dapta: boolean },
): AnnouncementPick | null {
  const byId = new Map(states.map((s) => [s.announcementId, s]));
  const candidates = list
    .map((a, index) => ({ a, index }))
    .filter(({ a }) => isAnnouncementLive(a, now, opts))
    .filter(({ a }) => {
      const s = byId.get(a.id);
      if (s?.clickedAt) return false;
      // The cap is for the untouched: a closed card's badge outlives it.
      return Boolean(s?.dismissedAt) || !sessionsExhausted(s, now);
    })
    // Most recent first; for the same start, the one added later.
    .sort((x, y) => y.a.startsAt - x.a.startsAt || y.index - x.index)
    .map(({ a }) => a);

  const withCard = candidates.find((a) => !byId.get(a.id)?.dismissedAt);
  if (withCard) return { announcement: withCard, card: true, badge: withCard.railBadge !== null };
  const withBadge = candidates.find((a) => a.railBadge !== null);
  if (withBadge) return { announcement: withBadge, card: false, badge: true };
  return null;
}

/** The announcement with this id, or undefined. */
export function findAnnouncement(id: string, list: readonly Announcement[] = ANNOUNCEMENTS): Announcement | undefined {
  return list.find((a) => a.id === id);
}

/**
 * Whether a product name identifies Dapta's own build. The product is dForms;
 * `Dapta Forms` is its name before the rename, still passed by older pipelines.
 */
export function isDaptaProductName(name: string | undefined | null): boolean {
  return name === 'dForms' || name === 'Dapta Forms';
}
