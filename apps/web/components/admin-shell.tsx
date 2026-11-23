'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type TransitionEvent as ReactTransitionEvent,
} from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  isNavItemActive,
  type AnnouncementCopy,
  type AnnouncementRailItem,
  type AnnouncementVideo,
  type FormsMessages,
} from '@quill/shared';
import { AppSwitcher } from '@/components/app-switcher';
import { BrandMark, BrandWordmark } from '@/components/brand/brand';
import { ProfileMenu } from '@/components/profile-menu';
import { ThemeToggle } from '@/components/theme-toggle';
import { WorkspaceSwitcher } from '@/components/workspace-switcher';
import { McpLogos } from '@/components/mcp-logos';
import { IntegrationLogos } from '@/components/integration-logos';
import {
  announcementShownThisSession,
  captureAnnouncementClicked,
  captureAnnouncementSeen,
  isAnnouncementFollowed,
  markAnnouncementFollowed,
  markAnnouncementSurface,
  reportAnnouncement,
  subscribeAnnouncements,
  takeAnnouncementSurface,
} from '@/components/announcement/announcement-client';
import { AnnouncementModal } from '@/components/announcement/announcement-modal';
import { ReferralShareModal, fillReferral } from '@/components/referral/referral-share-modal';
import { ReferralBanner } from '@/components/referral/referral-banner';
import { ReferralDialogContext } from '@/components/referral/referral-dialog-context';
import type { ReferralSurface } from '@/components/referral/use-referral-copy';
import type { Workspace } from '@/lib/admin-api';
import { PLATFORM_URL, suiteHref } from '@/lib/suite';
import type { ThemePref } from '@/lib/theme';

type ChromeMessages = FormsMessages['admin']['chrome'];

/** Design-parity admin shell — a direct port of Dapta Calendars' AppShell so the
 *  two products read as one family: a flush 240px sidebar (bg-popover, right
 *  border, never a floating card), a flat icon+label nav, a bottom user footer,
 *  a desktop collapse rail (cookie-persisted, no FOUC), and a <768px off-canvas
 *  drawer with a hamburger top bar. Tokens only; R22 press/hover; R27/R28. */

type IconName =
  | 'home'
  | 'forms'
  | 'submissions'
  | 'analytics'
  | 'integrations'
  | 'mcp'
  | 'tools'
  | 'docs'
  | 'agents'
  | 'referral';

interface NavItem {
  key: keyof ChromeMessages['nav'];
  href: string;
  icon: IconName;
  /** Active when the path matches any of these (prefix) in addition to href. */
  match?: string[];
  /** Leaves the app: plain anchor in a new tab, never `aria-current`. */
  external?: true;
  /**
   * The href comes from the localized catalog instead of `href` (the docs
   * site has one page per language). `NavLinks` resolves it from `docsHref`.
   */
  localizedHref?: 'docsHref';
  /**
   * Set apart from the rest of the list: a green-tinted row that reads as an
   * invitation, not just a page. Only "Connect your agent" uses it.
   */
  prominent?: true;
}



// Forms information architecture: Home, Forms, Submissions, Analytics,
// Integrations. Submissions/Analytics/Integrations are per-form surfaces
// reached through a form picker at their global route. Everything about the
// ACCOUNT (workspaces, brand kit, notifications, public page) lives behind the
// profile button at the bottom of the rail, under /admin/account, the same
// place Dapta's admin panel keeps it, so no rail item is active on those pages.
//
// "Connect your agent" follows Integrations: the guide that connects an AI app
// to the dForms MCP server (served by the API at `/mcp`) with the person's
// account. Its own prominent item rather than a corner of Account settings or
// a page under an "MCP" group, so it is found without being looked for: a
// green-tinted row whose icon is the rotating Claude, ChatGPT and Cursor logos
// (`McpLogos`) and that breathes a soft glow until you are on it. Then
// "Tools": what an agent can do in dForms, in plain words. Keyed `developers`
// and under `/admin/developers` because skill zips already handed out those
// addresses.
//
// Then "Docs": the product documentation, always present, in the reader's
// language (the URL lives in the message catalog, see `docsHref`). External
// like the platform door below, and tagged the same way.
//
// Last, and only on a deployment that has a platform: "Sales AI Agents", the door
// to the wider platform. It sits IN the nav rather than in a separate block so
// the rail reads as one list, and it takes the external-link affordance so it
// is never mistaken for a page of this app. Same open-core gate as the
// app-switcher's first row: with NEXT_PUBLIC_PLATFORM_URL unset a fork's rail
// carries no dead item. Same helper too, so both doors tag themselves alike
// (`utm_source=forms`, medium = the piece of chrome clicked).
const NAV: NavItem[] = [
  { key: 'home', href: '/admin', icon: 'home' },
  { key: 'forms', href: '/admin/forms', icon: 'forms' },
  { key: 'submissions', href: '/admin/submissions', icon: 'submissions' },
  { key: 'analytics', href: '/admin/analytics', icon: 'analytics' },
  { key: 'integrations', href: '/admin/integrations', icon: 'integrations' },
  {
    key: 'developers',
    href: '/admin/developers/connect',
    icon: 'mcp',
    match: ['/admin/developers/connect', '/admin/developers/keys'],
    prominent: true,
  },
  { key: 'tools', href: '/admin/developers/tools', icon: 'tools' },
  { key: 'docs', href: '', icon: 'docs', external: true, localizedHref: 'docsHref' },
  ...(PLATFORM_URL
    ? [{ key: 'agents', href: suiteHref(PLATFORM_URL, 'sidebar'), icon: 'agents', external: true } as const]
    : []),
];

const NAV_COLLAPSED_KEY = 'forms.nav.collapsed';

/** Hover intent for the editor's peek rail. Opening is quick: the 64px strip is
 *  a deliberate target, not somewhere a pointer crosses on its way elsewhere.
 *  Closing is slower and re-checked, so a diagonal exit towards a menu that was
 *  opened FROM the rail does not snap the rail shut mid-travel. */
const PEEK_OPEN_MS = 120;
const PEEK_CLOSE_MS = 160;

// Dapta's icon system is PrimeIcons (pi pi-*) — the same set Calendars + the
// production admin panel use. Sized at the design-system's 20px sidebar icon.
// Two exceptions, same 20px: MCP's icon is the rotating AI app logos, and
// Integrations' is the rotating marks of the services it connects (HubSpot,
// Salesforce, HighLevel, Google Sheets, Calendly, dCal, Dapta). Integrations
// keeps a plain row, not the green tint: one invitation in the rail reads as
// one, and two stacked green rows would read as neither.
type AnimatedIcon = 'mcp' | 'integrations';
const ANIMATED_ICONS: ReadonlySet<IconName> = new Set<AnimatedIcon>(['mcp', 'integrations']);

const PI_BY_NAME: Record<Exclude<IconName, AnimatedIcon>, string> = {
  home: 'pi-home',
  forms: 'pi-file-edit',
  submissions: 'pi-inbox',
  analytics: 'pi-chart-bar',
  tools: 'pi-sparkles',
  docs: 'pi-book',
  agents: 'pi-bot',
  referral: 'pi-gift',
};

function Icon({ name, className, paused }: { name: IconName; className?: string; paused?: boolean }) {
  if (name === 'mcp') return <McpLogos size={20} paused={paused} />;
  if (name === 'integrations') return <IntegrationLogos size={20} paused={paused} />;
  return (
    <i
      aria-hidden
      className={`pi ${PI_BY_NAME[name]}${className ? ` ${className}` : ''}`}
      style={{ fontSize: 20 }}
    />
  );
}

/**
 * The look of one rail row: the page you are on, or any other.
 */
function navRowClass(collapsed: boolean, state: 'active' | 'idle') {
  return [
    'relative flex items-center gap-3 rounded-md text-sm transition-colors active:scale-[0.99]',
    collapsed ? 'mx-auto h-11 w-11 justify-center gap-0 px-0' : 'min-h-[44px] w-full px-3 py-2.5 text-left',
    state === 'active'
      ? 'bg-muted font-medium text-foreground'
      : 'text-muted-foreground hover:bg-muted hover:text-foreground',
    // The `bg-muted` wash alone cannot mark "you are here": on paper it
    // is 1.18:1 against the card behind it, well under the 3:1 WCAG
    // 1.4.11 asks of a state indicator, and a grey chip on white can
    // never reach it. The wash still does the scanning work; this 2px
    // accent bar does the identifying, at 3.3:1 on light and 14:1 on
    // dark. Two signals, so neither has to carry the whole job.
    state === 'active' &&
      'before:absolute before:inset-y-1.5 before:left-0 before:w-0.5 before:rounded-full before:bg-primary-edge before:content-[""]',
  ]
    .filter(Boolean)
    .join(' ');
}

/** Whether the viewport is at least `px` wide, read after mount (false on the server). */
function useMinWidth(px: number): boolean {
  const [wide, setWide] = useState(false);
  useEffect(() => {
    let query: MediaQueryList;
    try {
      query = window.matchMedia(`(min-width: ${px}px)`);
    } catch {
      return;
    }
    const sync = () => setWide(query.matches);
    sync();
    query.addEventListener?.('change', sync);
    return () => query.removeEventListener?.('change', sync);
  }, [px]);
  return wide;
}

/** The "New" mark one rail item carries while an announcement points at it. */
interface NavBadge {
  /** The visible pill: "New". */
  label: string;
  /** Read after the item's name: ", new", so the link is "Integrations, new". */
  sr: string;
}

/**
 * The icon, with the badge's dot when the rail is collapsed to 64px: there is
 * no room for the pill there, and the dot sits on the icon's corner without
 * moving it. Without a badge the icon is returned exactly as before.
 */
function BadgedIcon({ badge, collapsed, children }: { badge?: NavBadge | null; collapsed: boolean; children: ReactNode }) {
  if (!badge || !collapsed) return <>{children}</>;
  return (
    <span className="relative inline-flex">
      {children}
      <span
        aria-hidden
        data-testid="nav-badge-dot"
        className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-signal ring-2 ring-sidebar"
      />
    </span>
  );
}

/**
 * The pill after the label in the open rail and the drawer, and the words a
 * screen reader hears in either state. The pill itself is hidden from the
 * accessibility tree so "new" is announced once, in lower case, as part of the
 * name.
 */
function BadgeTail({ badge, collapsed }: { badge?: NavBadge | null; collapsed: boolean }) {
  if (!badge) return null;
  return (
    <>
      {!collapsed ? (
        <span
          aria-hidden
          data-testid="nav-badge"
          className="ml-auto shrink-0 rounded-full bg-signal/15 px-2 py-0.5 text-2xs font-semibold leading-4 text-signal-ink"
        >
          {badge.label}
        </span>
      ) : null}
      <span className="sr-only">{badge.sr}</span>
    </>
  );
}

/**
 * A rail link whose icon is a set of rotating logos ("Connect your agent",
 * "Integrations"). The logos hold still while the pointer is on the row, so
 * the mark someone is looking at does not change under them (see
 * `useLogoRotation`).
 */
function LogosLink({
  icon,
  href,
  label,
  collapsed,
  active,
  testId,
  prominent,
  className,
  onNavigate,
  badge,
}: {
  icon: IconName;
  href: string;
  label: string;
  collapsed: boolean;
  active: boolean;
  testId: string;
  prominent?: true;
  className: string;
  onNavigate?: () => void;
  badge?: NavBadge | null;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <Link
      href={href}
      onClick={onNavigate}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      title={collapsed ? `${label}${badge ? badge.sr : ''}` : undefined}
      aria-current={active ? 'page' : undefined}
      data-testid={testId}
      data-prominent={prominent || undefined}
      data-badge={badge ? 'new' : undefined}
      className={className}
    >
      <BadgedIcon badge={badge} collapsed={collapsed}>
        <Icon name={icon} paused={hovered} />
      </BadgedIcon>
      <span className={collapsed ? 'sr-only' : ''}>{label}</span>
      <BadgeTail badge={badge} collapsed={collapsed} />
    </Link>
  );
}

function NavLinks({
  collapsed,
  nav,
  docsHref,
  newTab,
  onNavigate,
  badgeItem = null,
  badge,
  referral = null,
  referralM,
  onReferral,
}: {
  collapsed: boolean;
  nav: ChromeMessages['nav'];
  /** The localized documentation URL, already UTM-tagged by the caller. */
  docsHref: string;
  /** "(opens in a new tab)" — read out after an external item's label. */
  newTab: string;
  onNavigate?: () => void;
  /** The item an announcement marks "New", or null. */
  badgeItem?: AnnouncementRailItem | null;
  badge: NavBadge;
  /** The referral program's entry, or null while the program is off. */
  referral?: ShellReferral | null;
  referralM: ChromeMessages['referral'];
  /** Opens the share modal. */
  onReferral?: () => void;
}) {
  const pathname = usePathname();
  return (
    <ul className="flex flex-col gap-1">
      {NAV.map((item) => {
        const href = item.localizedHref ? docsHref : item.href;
        const label = nav[item.key];
        const itemBadge = badgeItem !== null && item.key === badgeItem ? badge : null;
        // A click on the marked item is how the visit gets filed as the rail's.
        const navigate = itemBadge
          ? () => {
              markAnnouncementSurface('rail');
              onNavigate?.();
            }
          : onNavigate;
        // An external item is never "here": its href is another origin, so the
        // prefix rule could not match anyway, but the intent should not depend
        // on that accident.
        const active = !item.external && isNavItemActive(pathname, href, item.match);
        const className = [
          navRowClass(collapsed, active ? 'active' : 'idle'),
          item.prominent &&
            (active
              ? 'bg-signal/15 ring-1 ring-inset ring-signal/50'
              : 'rail-pulse bg-signal/[0.08] font-medium text-foreground ring-1 ring-inset ring-signal/30 hover:bg-signal/15'),
        ]
          .filter(Boolean)
          .join(' ');
        // Label stays in the a11y tree when collapsed (sr-only) so the
        // icon-only link keeps a discernible name (WCAG 4.1.2).
        const body = (
          <>
            <BadgedIcon badge={itemBadge} collapsed={collapsed}>
              <Icon name={item.icon} />
            </BadgedIcon>
            <span className={collapsed ? 'sr-only' : ''}>{label}</span>
          </>
        );
        if (ANIMATED_ICONS.has(item.icon) && !item.external) {
          return (
            <li key={item.key}>
              <LogosLink
                icon={item.icon}
                href={href}
                label={label}
                collapsed={collapsed}
                active={active}
                testId={`nav-${item.key}`}
                prominent={item.prominent}
                className={className}
                onNavigate={navigate}
                badge={itemBadge}
              />
            </li>
          );
        }
        return (
          <li key={item.key}>
            {item.external ? (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                onClick={onNavigate}
                title={collapsed ? label : undefined}
                data-testid={`nav-${item.key}`}
                className={className}
              >
                {body}
                {/* The same trailing arrow the app-switcher rows carry, so
                    "leaves the app" reads the same wherever it appears. Hidden
                    on the 64px rail, where the 44px tile is the icon alone. */}
                {!collapsed ? (
                  <i
                    aria-hidden
                    className="pi pi-external-link ml-auto text-muted-foreground"
                    style={{ fontSize: 13 }}
                  />
                ) : null}
                <span className="sr-only"> {newTab}</span>
              </a>
            ) : (
              <Link
                href={href}
                onClick={navigate}
                title={collapsed ? `${label}${itemBadge ? itemBadge.sr : ''}` : undefined}
                aria-current={active ? 'page' : undefined}
                data-badge={itemBadge ? 'new' : undefined}
                className={className}
              >
                {body}
                <BadgeTail badge={itemBadge} collapsed={collapsed} />
              </Link>
            )}
          </li>
        );
      })}
      {referral ? (
        <li>
          <ReferralNavEntry referral={referral} m={referralM} collapsed={collapsed} onOpen={onReferral} />
        </li>
      ) : null}
    </ul>
  );
}

/**
 * The referral program's rail row: a button (it opens the share modal, it is
 * not a page) with the person's progress as a pill after the label. The pill
 * is hidden from the accessibility tree and its words are read instead, so the
 * row's name is "Invite friends, 0 of 5 joined". Collapsed to 64px, the icon
 * alone, with the same words as its tooltip.
 */
function ReferralNavEntry({
  referral,
  m,
  collapsed,
  onOpen,
}: {
  referral: ShellReferral;
  m: ChromeMessages['referral'];
  collapsed: boolean;
  onOpen?: () => void;
}) {
  const values = { count: referral.count, goal: referral.goal };
  const sr = fillReferral(m.progressSr, values);
  return (
    <button
      type="button"
      onClick={onOpen}
      title={collapsed ? `${m.nav}${sr}` : undefined}
      aria-haspopup="dialog"
      data-testid="nav-referral"
      className={navRowClass(collapsed, 'idle')}
    >
      <Icon name="referral" />
      <span className={collapsed ? 'sr-only' : ''}>{m.nav}</span>
      {!collapsed ? (
        <span
          aria-hidden
          data-testid="nav-referral-progress"
          className="ml-auto shrink-0 rounded-full bg-signal/15 px-2 py-0.5 text-2xs font-semibold leading-4 tabular-nums text-signal-ink"
        >
          {fillReferral(m.progress, values)}
        </span>
      ) : null}
      <span className="sr-only">{sr}</span>
    </button>
  );
}

/**
 * The in-app announcement the layout read for this person, the parts the rail
 * needs: which item gets "New", and the route whose visit ends it.
 */
export interface ShellAnnouncement {
  id: string;
  cta: string;
  railBadge: AnnouncementRailItem | null;
  /** Whether the badge shows (false for an announcement without one, or once its page was opened). */
  badge: boolean;
  /** Whether the pop-up is due (the person has not closed or followed it). */
  modal: boolean;
  /** The person reached the route on an earlier load: nothing to report on a visit. */
  followed: boolean;
  /** The pop-up's copy in the reader's language; null when this build has none for it. */
  copy: AnnouncementCopy | null;
  /** The pop-up's close button name. */
  closeLabel: string;
  visual: AnnouncementVideo;
}

/** The referral program's entry, from `/v1/me.referral` while it is on. */
export interface ShellReferral {
  link: string;
  count: number;
  goal: number;
  /** The badge's localized label (`growth.madeWith`), for the dialog's pill. */
  badgeLabel: string;
  /**
   * The top banner, while the API shows it (`referralBannerVisible`), with the
   * badge's localized label (`growth.madeWith`) for its replica of the pill.
   * Absent or null: no banner.
   */
  banner?: { badgeLabel: string } | null;
}

export interface ShellUser {
  displayName: string | null;
  email: string | null;
}

export function AdminShell({
  user,
  messages,
  accountNav,
  initialCollapsed = false,
  themePref = 'light',
  workspaces = [],
  currentAccountId,
  staff = false,
  announcement = null,
  referral = null,
  children,
}: {
  user: ShellUser | null;
  /** Active-locale chrome catalog — nav + common labels + switcher. */
  messages: ChromeMessages;
  /** Labels of the account-settings entries the profile menu lists. */
  accountNav: FormsMessages['admin']['account']['nav'];
  /** Server-read cookie value → no collapse-rail FOUC on reload. */
  initialCollapsed?: boolean;
  /** Server-read colour-scheme choice, so the toggle's icon matches the paint. */
  themePref?: ThemePref;
  /** Every account the caller can enter. Fewer than two renders no switcher. */
  workspaces?: Workspace[];
  /** The account these pages are currently scoped to. */
  currentAccountId?: string;
  /** Staff of the deployment: the switcher's search reaches the whole estate. */
  staff?: boolean;
  /** The announcement this person gets, or null (see `ShellAnnouncement`). */
  announcement?: ShellAnnouncement | null;
  /** The referral program's entry, or null while the program is off. */
  referral?: ShellReferral | null;
  children: ReactNode;
}) {
  // Tagged once for both rails (desktop and drawer), like the other suite doors.
  const docsHref = suiteHref(messages.docsHref, 'sidebar');
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [referralOpen, setReferralOpen] = useState(false);
  // Where the referral dialog was opened from, for its open, copy and share events.
  const [referralSurface, setReferralSurface] = useState<ReferralSurface>('menu');
  // One door for every opener: the menu, the banner's call to action and its
  // "?", the badge switch. From the drawer, the drawer closes first: the
  // dialog belongs over the page, not over a drawer that would keep the page
  // inert under it.
  const openReferralDialog = useCallback((surface: ReferralSurface) => {
    setDrawerOpen(false);
    setReferralSurface(surface);
    setReferralOpen(true);
  }, []);
  const openReferral = () => openReferralDialog('menu');
  const drawerRef = useRef<HTMLElement>(null);
  const railRef = useRef<HTMLElement>(null);
  const [peeking, setPeeking] = useState(false);
  const peekTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The form builder wants the widest canvas → the rail RESTS collapsed on the
  // editor route (Calendars' studio parity), without touching the saved pref.
  const studio = /^\/admin\/forms\/[^/]+\/edit/.test(pathname);
  // In the studio the rail's 64px footprint is what the layout reserves, and
  // `peeking` is the only thing that widens it: the saved preference is
  // neither read nor written on that route. Everywhere else this is exactly
  // `collapsed`, so the toggle and the cookie behave as they always have.
  //
  // `peeking` starts false and `studio` is known during SSR, so the server
  // render, the hydration render and the first paint all agree on 64px. That
  // is the same no-FOUC contract the cookie buys everywhere else.
  const railCollapsed = studio ? !peeking : collapsed;

  // ── In-app announcement ──────────────────────────────────────────────────
  // The layout is not re-rendered on client navigation, so what it read at load
  // is followed here: reaching the announcement's route ends the badge at once,
  // and is stored against the person. The builder shows none of it, so a load
  // there reports nothing either. What this load learned lives in
  // announcement-client.ts, keyed by id.
  const annId = announcement?.id ?? null;
  const annCta = announcement?.cta ?? null;
  const onAnnouncementRoute = annCta !== null && isNavItemActive(pathname, annCta);
  const followedThisLoad = useSyncExternalStore(
    subscribeAnnouncements,
    () => (annId ? isAnnouncementFollowed(annId) : false),
    () => false,
  );
  // Followed on an earlier load too: the banner keeps the announcement alive
  // after that, and a later visit is not a new follow to report.
  const followed = followedThisLoad || !!announcement?.followed;
  useEffect(() => {
    if (!annId || followed || !onAnnouncementRoute) return;
    markAnnouncementFollowed(annId);
    reportAnnouncement(annId, 'clicked');
    captureAnnouncementClicked(annId, takeAnnouncementSurface());
  }, [annId, followed, onAnnouncementRoute]);
  const badgeItem =
    announcement && announcement.badge && !followed && !studio && !onAnnouncementRoute
      ? announcement.railBadge
      : null;
  // Analytics counts the badge as seen only when it is really on screen: the
  // desktop rail from 768px up, or the drawer once it is opened.
  const railOnScreen = useMinWidth(768) || drawerOpen;
  useEffect(() => {
    if (!annId || !badgeItem || !railOnScreen) return;
    captureAnnouncementSeen(annId, 'rail');
  }, [annId, badgeItem, railOnScreen]);

  // The pop-up: on the first dashboard load of a browser session where it is
  // due. Never in the builder, never on the announcement's own page (there is
  // nothing left to announce), and never over another dialog or the open
  // drawer: it waits for those to close. Onboarding never gets here, it lives
  // outside /admin (see app/admin/layout.tsx).
  const [modalOpen, setModalOpen] = useState(false);
  const modalHandled = useRef<string | null>(null);
  // Editors take the whole screen for work: the form builder and the link page
  // editor never get a pop-up over them.
  const editor = studio || /^\/admin\/account\/public-page\/[^/]+/.test(pathname);
  const modalDue =
    !!announcement?.modal && !!announcement.copy && !editor && !onAnnouncementRoute && !followed && !drawerOpen;
  // Back or a swipe can take the page somewhere it must not be shown while it
  // is up (portalled, it would stay): it leaves with the page, unreported, and
  // does not come back on this load.
  useEffect(() => {
    if (modalOpen && !modalDue) setModalOpen(false);
  }, [modalOpen, modalDue]);
  useEffect(() => {
    if (!annId || !modalDue || modalHandled.current === annId) return;
    if (announcementShownThisSession(annId)) {
      modalHandled.current = annId;
      return;
    }
    let timer: ReturnType<typeof setTimeout>;
    const tryOpen = () => {
      // Another dialog, or a full-screen surface that holds the scroll (the
      // submissions sheet opened from a notification link is a dialog without
      // aria-modal): wait for it to close.
      if (
        document.querySelector('[aria-modal="true"], [role="alertdialog"]') ||
        document.body.style.overflow === 'hidden'
      ) {
        timer = setTimeout(tryOpen, 1000);
        return;
      }
      modalHandled.current = annId;
      setModalOpen(true);
    };
    // A beat after the page settles, so it arrives over a finished page.
    timer = setTimeout(tryOpen, 350);
    return () => clearTimeout(timer);
  }, [annId, modalDue]);

  // Persist the desktop rail preference to a cookie so the SERVER renders the
  // correct width on the next load (no flash) — see AdminLayout.
  const toggleCollapse = () => {
    setCollapsed((c) => {
      const next = !c;
      try {
        localStorage.setItem(NAV_COLLAPSED_KEY, next ? '1' : '0');
        const secure = window.location.protocol === 'https:' ? '; secure' : '';
        document.cookie = `${NAV_COLLAPSED_KEY}=${next ? '1' : '0'}; path=/; max-age=31536000; samesite=lax${secure}`;
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  const cancelPeek = () => {
    if (peekTimer.current) clearTimeout(peekTimer.current);
    peekTimer.current = null;
  };

  const onRailPointerEnter = (e: ReactPointerEvent<HTMLElement>) => {
    // Touch has no hover: a tap must not smear a 240px panel over the very
    // link it is about to follow.
    if (e.pointerType !== 'mouse' && e.pointerType !== 'pen') return;
    // Mid-drag. dnd-kit's PointerSensor listens on the document rather than
    // capturing the pointer, so dragging a question past the canvas's left
    // edge really does enter the rail.
    if (e.buttons !== 0) return;
    cancelPeek();
    peekTimer.current = setTimeout(() => setPeeking(true), PEEK_OPEN_MS);
  };

  /** Focus is deliberate, so it opens with no intent delay. */
  const onRailFocus = () => {
    cancelPeek();
    setPeeking(true);
  };

  // Deferred AND self-rescheduling, for two situations that are really one:
  //   · the pointer leaves the rail to reach a menu the rail opened, whose
  //     panel is portalled to <body> (anchored-menu.tsx). Collapsing under an
  //     open panel STRANDS it: AnchoredMenu places once and re-places only on
  //     scroll/resize, never on its anchor moving, so the panel would be left
  //     pointing at where the trigger used to be.
  //   · that panel is then dismissed by a click on the canvas, after which no
  //     further pointer or focus event ever reaches the rail. The re-check
  //     closes the peek on the next tick instead of leaving it open forever.
  //
  // The marker is asked for globally rather than per-menu because on this route
  // the only AnchoredMenus in the tree ARE the rail's own menus (the other caller,
  // member-row-actions, lives under /admin/account). If one ever opens from the
  // canvas, the worst it does is hold the peek open while it is up.
  const closePeek = () => {
    cancelPeek();
    const tick = () => {
      const keep =
        !!document.querySelector('[data-anchored-menu]') ||
        !!railRef.current?.contains(document.activeElement);
      if (keep) {
        peekTimer.current = setTimeout(tick, PEEK_CLOSE_MS);
        return;
      }
      peekTimer.current = null;
      setPeeking(false);
    };
    peekTimer.current = setTimeout(tick, PEEK_CLOSE_MS);
  };

  // The width flip moves an open menu's trigger without firing a resize, and
  // resize is one of the two signals AnchoredMenu re-measures on. Hand it one.
  const onRailTransitionEnd = (e: ReactTransitionEvent<HTMLElement>) => {
    if (e.propertyName !== 'width' || e.target !== e.currentTarget) return;
    window.dispatchEvent(new Event('resize'));
  };

  useEffect(() => cancelPeek, []);

  // Leaving the editor drops the peek, and it has to be done here because
  // nothing else would: clicking a rail link navigates away with the pointer
  // and the focus both still INSIDE the rail, so neither `pointerleave` nor
  // `blur` ever fires. Off the editor route `peeking` is not read, so it would
  // sit there as a stale `true` and the next editor opened from the list would
  // start 240px wide over its own canvas, with the pointer nowhere near the
  // rail and therefore no `pointerleave` coming to close it.
  useEffect(() => {
    if (!studio) setPeeking(false);
  }, [studio]);

  // Lock body scroll + close on Escape + move focus into the drawer on open (R28).
  useEffect(() => {
    // Only while open, and put back what was there: writing '' on every mount
    // wiped the scroll lock of a surface that opened with the page (the
    // submissions sheet from a `?response=` link), which also hid it from the
    // announcement pop-up's "is something else up?" check.
    const body = document.body;
    const prevOverflow = body.style.overflow;
    if (drawerOpen) body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // WCAG 1.4.13 Dismissible, for the pointer case it is written about.
      // With the caret INSIDE the rail, Escape leaves the peek alone on
      // purpose: collapsing a rail whose focus ring is on an icon-only link
      // is worse than not dismissing.
      if (!railRef.current?.contains(document.activeElement)) setPeeking(false);
      // A dialog opened from the drawer ("New workspace") owns this Escape: it
      // closes that dialog and leaves the drawer it came from open. The dialog
      // is portalled to <body>, so it is found by `aria-modal`, not by being
      // inside the drawer (which is `role="dialog"` itself, open or not).
      if (document.querySelector('[aria-modal="true"]')) return;
      setDrawerOpen(false);
    };
    window.addEventListener('keydown', onKey);
    if (drawerOpen) drawerRef.current?.querySelector<HTMLElement>('a,button')?.focus();
    return () => {
      if (drawerOpen) body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKey);
    };
  }, [drawerOpen]);

  const brand = (
    // px-3 matches the nav links' own padding, so the wordmark's left edge lands
    // on the same column as the nav icons instead of hanging 3.5px outside it.
    <div className={`flex items-center gap-2 ${railCollapsed ? 'flex-col px-0' : 'px-3'}`}>
      {/* Inside the app the shell already says Dapta, so the rail carries the
          product wordmark alone — at ~3:1 it reads at a size where the 6:1 full
          lockup turns to mush. Collapsed to 64px, only the mark fits. */}
      {railCollapsed ? (
        <BrandMark className="h-6 w-auto text-foreground" labelled />
      ) : (
        <BrandWordmark className="h-6 w-auto text-foreground" labelled />
      )}
      <AppSwitcher messages={messages.switcher} />
      {/* Outside the editor this is the desktop preference, saved to the cookie.
          Inside it, it drives the peek and nothing else: hover is the primary
          way in, but hover is not available to a touch device wide enough to
          get the desktop rail instead of the drawer (an iPad, a touch laptop),
          and it is not available from the keyboard either. Without this button
          those two have no way to read the rail at all, which is the state the
          editor was in before: the toggle was not merely hidden here, it was
          absent from the DOM. */}
      <button
        type="button"
        onClick={
          studio
            ? () => {
                cancelPeek();
                setPeeking((p) => !p);
              }
            : toggleCollapse
        }
        data-testid="rail-toggle"
        aria-expanded={!railCollapsed}
        aria-label={railCollapsed ? messages.expand : messages.collapse}
        title={railCollapsed ? messages.expand : messages.collapse}
        className={`hidden rounded-md p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:scale-[0.98] md:inline-flex ${railCollapsed ? '' : 'ml-auto'}`}
      >
        <i aria-hidden className={`pi ${railCollapsed ? 'pi-angle-double-right' : 'pi-angle-double-left'}`} style={{ fontSize: 16 }} />
      </button>
    </div>
  );

  // The footer is two rows: the theme toggle above, the profile button last.
  // The profile button is the door to Account settings and Log out (see
  // profile-menu.tsx) — the loose "view public page" and "sign out" icons that
  // used to sit beside the toggle are gone, so the identity row no longer has
  // to share its width with a strip of 44px targets. The address gets the full
  // rail; the toggle keeps its own row so it stays a 44px hit target (R28).
  // The mobile drawer is always full-width, so its footer renders expanded
  // regardless of the DESKTOP rail state — hence a param, not the shared const.
  // `onNavigate` lets the drawer close itself when an account entry is chosen.
  const renderFooter = (footerCollapsed: boolean, onNavigate?: () => void) => (
    <div
      className={`mt-auto flex flex-col border-t border-border pt-3 ${
        footerCollapsed ? 'items-center gap-1' : 'gap-1'
      }`}
    >
      {/* Icon actions stay reachable in the collapsed rail too. */}
      <span className="flex items-center">
        <ThemeToggle pref={themePref} m={messages.theme} />
      </span>
      <ProfileMenu
        user={user}
        collapsed={footerCollapsed}
        m={messages.profileMenu}
        nav={accountNav}
        onNavigate={onNavigate}
      />
    </div>
  );

  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      {/* Mobile top bar (<768px). Inert while the drawer is open so focus can't
          escape the modal (WCAG 2.4.3 / APG modal-dialog). */}
      <header
        inert={drawerOpen || undefined}
        className="sticky top-0 z-30 flex items-center gap-2 border-b border-border bg-sidebar px-3 py-2 md:hidden"
      >
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          aria-label={messages.openNav}
          aria-expanded={drawerOpen}
          className="flex h-11 w-11 items-center justify-center rounded-md text-foreground hover:bg-muted active:scale-[0.98]"
        >
          <i aria-hidden className="pi pi-bars" style={{ fontSize: 20 }} />
        </button>
        {/* Under 360px the hamburger plus the wordmark crowds the bar, so the
            mark takes over. Done in CSS rather than JS so there is no flash on
            first paint and no resize listener. Only the visible one is display:
            block, so only one accessible name reaches the a11y tree. */}
        <BrandWordmark className="hidden h-6 w-auto text-foreground min-[360px]:block" labelled />
        <BrandMark className="h-6 w-auto text-foreground min-[360px]:hidden" labelled />
      </header>

      {/* Desktop sidebar — flush, bordered, collapsible rail.
          Pinned to the viewport (`sticky h-dvh`) rather than left to stretch
          with the page. As a plain flex item it grew to the FULL document
          height — 2834px on Settings — which dragged the `mt-auto` footer, and
          with it the account name and sign-out, ~2000px below the fold. The
          editor never showed the bug only because that route is its own
          `h-[100dvh] overflow-hidden` shell. `overflow-y-auto` keeps the rail
          usable if the nav ever outgrows a short viewport. */}
      {/* In the editor the rail leaves the flow and this spacer holds its
          column, so `<main>`'s box is identical at every peek state: the rail
          widens OVER the canvas rather than pushing it. Reflowing a
          `h-[100dvh] overflow-hidden` three-column builder every time the
          pointer passes the left edge is not something anyone could work in. */}
      {studio ? <div aria-hidden className="hidden w-[64px] shrink-0 md:block" /> : null}
      <aside
        ref={railRef}
        onPointerEnter={studio ? onRailPointerEnter : undefined}
        onPointerLeave={studio ? closePeek : undefined}
        // React's onFocus/onBlur are focusin/focusout, which bubble, so tabbing
        // into any control in the rail expands it and tabbing out collapses it.
        onFocus={studio ? onRailFocus : undefined}
        onBlur={studio ? closePeek : undefined}
        onTransitionEnd={studio ? onRailTransitionEnd : undefined}
        // `md:z-30` is load-bearing, not decoration. The rail is a stacking
        // context at `z-auto` sitting BEFORE <main> in the DOM, so overlaying
        // the canvas at auto would let every `relative` question card paint
        // over it (the bug anchored-menu.tsx exists to work around). 30 is the
        // shell-chrome tier already: above the canvas, below the pickers and
        // modals inside <main> (50) and below the rail's own portalled menus
        // (55), which therefore still win against the rail that opened them.
        //
        // The width transition needs no `motion-reduce:` variant: globals.css
        // already zeroes every transition under prefers-reduced-motion.
        //
        // The scrollbar is hidden, the scrolling is not. On a short window
        // (under ~690px collapsed, ~660px expanded) the rail overflows, and a
        // classic scrollbar drew a gray track down its right edge and took
        // 11px of a 64px column, shoving every icon left. Wheel, touch and a
        // Tab into an off-screen link still scroll it. See `.no-scrollbar`.
        className={`hidden shrink-0 flex-col gap-6 border-r border-border bg-sidebar py-4 transition-[width] no-scrollbar md:flex md:h-dvh md:overflow-y-auto ${
          studio ? 'md:fixed md:left-0 md:top-0 md:z-30' : 'md:sticky md:top-0'
        } ${railCollapsed ? 'w-[64px] px-2' : 'w-60 px-4'}`}
      >
        {brand}
        {/* Directly under the wordmark and above the nav: which tenant every
            link below belongs to, and where a new one is made. Always
            rendered: "New workspace" has to exist before there is a second
            workspace to switch to. */}
        {currentAccountId ? (
          <WorkspaceSwitcher
            workspaces={workspaces}
            currentAccountId={currentAccountId}
            collapsed={railCollapsed}
            staff={staff}
            m={messages.workspaces}
          />
        ) : null}
        <nav aria-label="Primary">
          <NavLinks
            collapsed={railCollapsed}
            nav={messages.nav}
            docsHref={docsHref}
            newTab={messages.switcher.opensNewTab}
            badgeItem={badgeItem}
            badge={messages.newBadge}
            referral={referral}
            referralM={messages.referral}
            onReferral={openReferral}
          />
        </nav>
        {renderFooter(railCollapsed)}
      </aside>

      {/* Mobile drawer + backdrop */}
      {drawerOpen ? (
        <button
          type="button"
          aria-hidden
          tabIndex={-1}
          onClick={() => setDrawerOpen(false)}
          className="fixed inset-0 z-40 bg-background/80 md:hidden"
        />
      ) : null}
      <aside
        ref={drawerRef}
        // Scrollbar hidden as on the desktop rail; the drawer still scrolls.
        className={`fixed inset-y-0 left-0 z-50 flex w-[82vw] max-w-[320px] flex-col gap-6 overflow-y-auto border-r border-border bg-sidebar p-4 transition-transform no-scrollbar md:hidden ${
          drawerOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
        role="dialog"
        aria-label="Primary"
        // Containment is `inert` on everything else, NOT aria-modal. The rail's
        // popup menus render through a portal at the end of <body> — they have
        // to, or the drawer's own overflow clips them (see anchored-menu.tsx) —
        // and aria-modal means "hide everything outside this subtree", which
        // would hide those menus from assistive tech on mobile and nowhere
        // else. While the drawer is open the header and <main> are inert and
        // the desktop rail is display:none, so the only things reachable are
        // the drawer and the menu it opened. That is the containment aria-modal
        // was there to express, minus the collateral damage.
        inert={!drawerOpen || undefined}
      >
        <div className="flex items-center gap-2 px-2">
          {/* The drawer is 82vw capped at 320px, so the wordmark always fits. */}
          <BrandWordmark className="h-6 w-auto text-foreground" labelled />
          <AppSwitcher messages={messages.switcher} />
        </div>
        {currentAccountId ? (
          <WorkspaceSwitcher
            workspaces={workspaces}
            currentAccountId={currentAccountId}
            staff={staff}
            m={messages.workspaces}
          />
        ) : null}
        <nav>
          <NavLinks
            collapsed={false}
            nav={messages.nav}
            docsHref={docsHref}
            newTab={messages.switcher.opensNewTab}
            onNavigate={() => setDrawerOpen(false)}
            badgeItem={badgeItem}
            badge={messages.newBadge}
            referral={referral}
            referralM={messages.referral}
            onReferral={openReferral}
          />
        </nav>
        {renderFooter(false, () => setDrawerOpen(false))}
      </aside>

      <main inert={drawerOpen || undefined} className="min-w-0 flex-1 bg-background">
        {/* The referral banner, at the top of the main area. Not in the form
            builder: it owns the full viewport height (`h-[100dvh]`), and a
            strip above it would push its bottom edge off screen. */}
        {referral?.banner && !studio ? (
          <ReferralBanner
            count={referral.count}
            goal={referral.goal}
            badgeLabel={referral.banner.badgeLabel}
            m={messages.referral}
            onOpen={openReferralDialog}
          />
        ) : null}
        {/* The badge switch opens the same dialog, from Brand kit or the Design panel. */}
        <ReferralDialogContext.Provider value={referral ? openReferralDialog : null}>
          {children}
        </ReferralDialogContext.Provider>
      </main>
      {announcement?.copy ? (
        <AnnouncementModal
          open={modalOpen}
          onClosed={() => setModalOpen(false)}
          id={announcement.id}
          copy={announcement.copy}
          cta={announcement.cta}
          visual={announcement.visual}
          closeLabel={announcement.closeLabel}
          theme={themePref}
        />
      ) : null}
      {referral ? (
        <ReferralShareModal
          open={referralOpen}
          onClose={() => setReferralOpen(false)}
          link={referral.link}
          count={referral.count}
          goal={referral.goal}
          badgeLabel={referral.badgeLabel}
          m={messages.referral}
          surface={referralSurface}
        />
      ) : null}
    </div>
  );
}
