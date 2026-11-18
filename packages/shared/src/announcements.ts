/**
 * In-app announcements: product news shown inside the dashboard. Three
 * surfaces, each optional per announcement:
 *
 *   - a pop-up (modal) over the dashboard, once per person: closing it, or
 *     following its button, ends it for good;
 *   - a "New" mark on one rail item, until the person opens that item's page;
 *   - a banner in the Home's top row, beside the agents banner, for as long as
 *     the announcement runs, whatever the person did with the pop-up.
 *
 * The list lives in code on purpose: publishing an announcement is a pull
 * request, reviewed like any other change, and a fork gets exactly the
 * announcements its own repository carries (minus the `daptaOnly` ones). What
 * each person did with each one lives in the database (`announcement_state`,
 * migration 0029), never only in the browser.
 *
 * This module is framework-free: the API decides what a person gets with
 * `pickAnnouncement`, and the web app reads the same definitions to render the
 * copy and the media.
 */
import type { FormsMessages } from './i18n';

/** Which announcement's copy, by key into `admin.announcements.items`. */
export type AnnouncementCopyKey = keyof FormsMessages['admin']['announcements']['items'];

/** A rail item an announcement can mark with "New". Named by its nav key. */
export type AnnouncementRailItem = 'integrations';

/**
 * The marks a Home banner rotates through, by the names the web app's
 * integration logos use (`components/integration-logos.tsx`).
 */
export type AnnouncementBannerLogo = 'gohighlevel' | 'salesforce' | 'google-sheets' | 'hubspot' | 'calendly' | 'dcal';

/**
 * The looping animation of the pop-up. Files live under `apps/web/public` as
 * `{src}-{light|dark}.webm`, `{src}-{light|dark}.mp4` and
 * `{src}-{light|dark}-poster.png`, so it follows the dashboard's theme.
 * `width` and `height` are the render's, used for the aspect ratio the pop-up
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
  /** The rail item that carries "New" until its page is opened, or null for none. */
  railBadge: AnnouncementRailItem | null;
  /** The Home banner's rotating marks, or null for no banner. */
  banner: { logos: readonly AnnouncementBannerLogo[] } | null;
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
    banner: { logos: ['gohighlevel', 'salesforce', 'google-sheets', 'hubspot', 'calendly', 'dcal'] },
    // It names dCal, a Dapta product.
    daptaOnly: true,
  },
];

/** What a person did with one announcement, as stored. */
export interface AnnouncementUserState {
  announcementId: string;
  /** The first time the pop-up was on screen for them. */
  seenAt: number | null;
  /** The pop-up was closed (X, Escape, outside click or its button). Never shown again. */
  dismissedAt: number | null;
  /** The person reached the `cta` route, by the button, the rail or on their own. Ends the badge. */
  clickedAt: number | null;
}

/** The announcement a person gets right now, and where it shows. */
export interface AnnouncementPick {
  announcement: Announcement;
  /** The pop-up: until the person closes or follows it. */
  modal: boolean;
  /** The rail badge: until the person opens its page. */
  badge: boolean;
  /** The Home banner: for as long as the announcement runs. */
  banner: boolean;
  /** The person already reached its route: nothing left to report about it. */
  followed: boolean;
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
 * The one announcement a person gets, if any, and its surfaces.
 *
 * One at a time, newest first. The newest live one whose pop-up the person
 * has neither closed nor followed wins, with every surface it has. If every
 * pop-up is done, the newest one whose badge still waits for its page visit
 * shows its badge (and its banner). If every badge is done too, the newest
 * live one keeps its banner alone: the banner runs for as long as the
 * announcement does.
 */
export function pickAnnouncement(
  list: readonly Announcement[],
  states: readonly AnnouncementUserState[],
  now: number,
  opts: { dapta: boolean },
): AnnouncementPick | null {
  const byId = new Map(states.map((s) => [s.announcementId, s]));
  const live = list
    .map((a, index) => ({ a, index }))
    .filter(({ a }) => isAnnouncementLive(a, now, opts))
    // Most recent first; for the same start, the one added later.
    .sort((x, y) => y.a.startsAt - x.a.startsAt || y.index - x.index)
    .map(({ a }) => a);
  const followed = (a: Announcement) => Boolean(byId.get(a.id)?.clickedAt);
  const closed = (a: Announcement) => followed(a) || Boolean(byId.get(a.id)?.dismissedAt);
  const surfaces = (a: Announcement, modal: boolean): AnnouncementPick => ({
    announcement: a,
    modal,
    badge: a.railBadge !== null && !followed(a),
    banner: a.banner !== null,
    followed: followed(a),
  });

  const withModal = live.find((a) => !closed(a));
  if (withModal) return surfaces(withModal, true);
  const withBadge = live.find((a) => a.railBadge !== null && !followed(a));
  if (withBadge) return surfaces(withBadge, false);
  const withBanner = live.find((a) => a.banner !== null);
  if (withBanner) return surfaces(withBanner, false);
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
