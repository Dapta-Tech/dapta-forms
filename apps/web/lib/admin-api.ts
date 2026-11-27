/**
 * Server-side admin API client. Every host call carries the current session's
 * identity: `Authorization: Bearer <jwt>` for the workos provider, `x-quill-email`
 * for the local dev provider. A `401` throws an ApiError the /admin gate turns
 * into a redirect to /login.
 */
import { cache } from 'react';
import { cookies, headers as requestHeaders } from 'next/headers';
import { redirect } from 'next/navigation';
import type {
  AnalyticsResponse,
  BrandKit,
  FormConfig,
  LinkPage,
  LinkPageFormRef,
  LinkPageSummary,
  FormDestination,
  GoHighLevelFieldsResponse,
  MemberProfile,
  SubmissionFile,
  SubmissionsPage,
  SubmissionView,
} from '@quill/types';
import type { SubmissionFacets, SubmissionsSummary, SummaryAnswer } from '@quill/engine';
import type {
  AnnouncementBannerLogo,
  AnnouncementCopyKey,
  AnnouncementEvent,
  AnnouncementRailItem,
  AnnouncementVideo,
} from '@quill/shared';
import { serverApiUrl } from './api-url';
import { getSession, clearSession, authProvider, getWorkspace } from './auth-session';
import { analyticsSessionHeaders } from './analytics-session';
import { browserIdHeaders } from './browser-id';
import { resolveProductAnalytics } from './product-analytics';
import { RETURN_PATH_HEADER, playbookReturnPath, withNextPath } from './return-path';

const API_URL = serverApiUrl;

/** An API error that carries the HTTP status + error code. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
    /** The parsed error body, for refusals that carry more than a code (409 STALE carries the current row). */
    readonly body?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Per-call options. `workspace` names the workspace to act in INSTEAD of the
 * one in the cookie — the account-settings pages manage a workspace by id
 * without switching into it. The API re-checks membership either way.
 */
export interface ReqOptions {
  workspace?: string;
}

async function req<T>(method: string, path: string, body?: unknown, opts: ReqOptions = {}): Promise<T> {
  const session = await getSession();
  // Which workspace, asked separately from who — and read from its own cookie,
  // because the local provider serves developers who have no session at all.
  // The API re-checks membership against the database; this authorizes nothing.
  const cookieWorkspace = await getWorkspace();
  const workspace = opts.workspace ?? cookieWorkspace;
  const headers: Record<string, string> = {};
  if (body) headers['content-type'] = 'application/json';
  if (session?.provider === 'workos') headers['authorization'] = `Bearer ${session.accessToken}`;
  else if (session?.provider === 'local') headers['x-quill-email'] = session.email;
  if (workspace) headers['x-quill-workspace'] = workspace;
  // Lets the events this call emits link to the session recording it came from.
  const jar = await cookies();
  Object.assign(headers, analyticsSessionHeaders(jar, resolveProductAnalytics()));
  // This browser's first-party id (lib/browser-id.ts): `/v1/me` records it for
  // the referral program, and a first sign-in's invite credit checks it.
  Object.assign(headers, browserIdHeaders(jar));

  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: Object.keys(headers).length ? headers : undefined,
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  });
  if (res.status === 401) {
    // Workos: leave the cookie alone. A render cannot write cookies (`set()`
    // and `delete()` both throw here), so the token exchange happens in the
    // /api/auth/refresh route handler: it trades the refresh token for a new
    // access token and returns to /admin, or hands off to the logout route
    // when the refresh token itself is dead. Deleting the cookie first would
    // hand both routes a null session (see `signOutAction`'s read-then-clear
    // note).
    // On a playbook page the destination rides along (`proxy.ts` names it), so
    // the link of an email survives an expired or missing session.
    if (authProvider() === 'workos') {
      const next = playbookReturnPath((await requestHeaders()).get(RETURN_PATH_HEADER));
      redirect(withNextPath('/api/auth/refresh', next));
    }
    try {
      await clearSession();
    } catch {
      /* cookies are immutable during render — the redirect still fires */
    }
    redirect('/login');
  }
  // The stored workspace is no longer ours — the membership was revoked, or the
  // account is gone. Self-heal rather than leaving every page 403ing with no way
  // back, which is what being removed from a workspace would otherwise feel like.
  //
  // Via a ROUTE HANDLER, not a `setWorkspace(null)` here: this code runs inside
  // a Server Component render, where `cookies().set()` throws. Clearing it here
  // and redirecting anyway produced an infinite loop — the dead workspace was
  // re-sent on every hop. The handler owns its response, so the delete lands.
  //
  // Only for the COOKIE's workspace. A 403 on an explicit `opts.workspace` means
  // "you cannot manage that one" and is the caller's to show; resetting the
  // cookie for it would throw the person out of the workspace they ARE in.
  if (res.status === 403 && cookieWorkspace && (opts.workspace === undefined || opts.workspace === cookieWorkspace)) {
    const j = (await res.clone().json().catch(() => ({}))) as { error?: string };
    if (j.error === 'WORKSPACE_FORBIDDEN') redirect('/api/workspace/reset');
  }
  if (!res.ok) {
    const j = (await res.json().catch(() => ({}))) as { message?: string; error?: string } & Record<string, unknown>;
    throw new ApiError(res.status, j.message ?? j.error ?? `${method} ${path} → ${res.status}`, j.error, j);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json().catch(() => ({}))) as T;
}

export type AccountRole = 'owner' | 'admin' | 'member';
export type MemberStatus = 'active' | 'invited' | 'disabled';

/** One account the signed-in person can act in. */
export interface Workspace {
  accountId: string;
  /**
   * The Dapta identity service's workspace id, null for an account that was
   * never projected from one. Account settings URLs carry THIS id when there is
   * one, so a link copied from the Dapta app and one copied from here name the
   * same workspace the same way; the API itself always takes `accountId`.
   */
  workspaceId: string | null;
  accountCode: string;
  accountName: string;
  memberId: string;
  role: AccountRole;
  /** `invited` until they first open it — shown as pending in the switcher. */
  status: MemberStatus;
  /** Active members in that workspace. */
  memberCount: number;
  /** `'staff'` when the person is in it by access grant (deployment staff), not by membership. */
  accessGrant: 'staff' | null;
}

/**
 * One row of the type-to-find search: a workspace of the caller's own list, or
 * (staff only) one of the estate they never opened here (`accountId` null:
 * enter it with `enterEstateWorkspace`).
 */
export interface WorkspaceSearchRow {
  workspaceId: string | null;
  accountId: string | null;
  name: string;
  role: AccountRole;
  status: MemberStatus;
  accessGrant: 'staff' | null;
  memberCount: number;
  localExists?: boolean;
  /** Staff rows matched by something other than the name: the email or form name that did. */
  hint?: { kind: 'email' | 'form'; value: string } | null;
}

export interface WorkspaceSearchResponse {
  rows: WorkspaceSearchRow[];
  /** Whether the caller is staff of the deployment (the estate is searchable). */
  staff: boolean;
  total: number;
  totalPages: number;
  page: number;
}

/** Why a webhook test delivery failed — mirrors `WebhookPingReason` in the API. */
export type WebhookPingReason =
  | 'method_not_allowed'
  | 'unsupported_media_type'
  | 'rejected_body'
  | 'unauthorized'
  | 'not_found'
  | 'rate_limited'
  | 'server_error'
  | 'redirect'
  | 'blocked'
  | 'unreachable'
  | 'unknown';

export interface WebhookPingResult {
  ok: boolean;
  reason?: WebhookPingReason;
  status?: number;
  /** The endpoint's own response body, trimmed and truncated by the API. */
  detail?: string;
  message?: string;
}

/**
 * The announcement the caller gets, as `GET /v1/me/announcement` answers it.
 * `copy` is a key into `admin.announcements.items`: the language is the web
 * app's to choose, like every other string.
 */
export interface AnnouncementView {
  id: string;
  copy: AnnouncementCopyKey;
  cta: string;
  visual: AnnouncementVideo;
  railBadge: AnnouncementRailItem | null;
  /** The Home banner's marks, or null when it has none. */
  banner: { logos: readonly AnnouncementBannerLogo[] } | null;
  /** Open the pop-up (the person has not closed or followed it). */
  modal: boolean;
  /** Show the rail badge (the person has not opened its page). */
  badge: boolean;
  /** Show the Home banner (for as long as the announcement runs). */
  showBanner: boolean;
  /** The person already reached the route: no visit left to report. */
  followed: boolean;
}

/**
 * One playbook card, as `GET /v1/me/playbooks` answers it: the catalog fields
 * (never the body) and what this person has done with it. Dates are epoch ms.
 * The category stays a plain string here on purpose: the tabs are the web
 * app's (`lib/playbooks.ts`), and a category an older build does not know
 * still lands under "All".
 */
export interface PlaybookCard {
  slug: string;
  /** The language of the text served (`es` or `en`). */
  locale: string;
  /** No version in the language asked for yet: this is the Spanish one. */
  fallback: boolean;
  category: string;
  title: string;
  summary: string;
  publishedAt: number;
  promisedBy: readonly string[];
  template: string;
  /** A root-relative path or https URL to a short loop, or null. */
  thumbnailVideo: string | null;
  /** The still shown before the loop plays, or instead of it. */
  thumbnailPoster: string | null;
  /** The person has opened it at least once. */
  seen: boolean;
  firstSeenAt: number | null;
  lastSeenAt: number | null;
  /** Published after the person's last gallery visit, and never opened. */
  isNew: boolean;
}

/** `GET /v1/me/playbooks`. */
export interface PlaybookList {
  /** The language asked for; each card says what it was served in. */
  locale: string;
  playbooks: PlaybookCard[];
  /** The tabs with at least one published playbook, in tab order. */
  categories: string[];
  galleryLastSeenAt: number | null;
  /** How many published playbooks are new to the person: the rail's "New". */
  newCount: number;
}

/** `?locale=` for a playbook read, or nothing for the API's default (the member's language). */
const playbookLocaleQuery = (locale?: string) => (locale ? `?locale=${encodeURIComponent(locale)}` : '');

/**
 * `GET /v1/me/playbooks`, deduplicated per server request and language with
 * React's `cache` (see `adminApi.playbooks`).
 */
const readPlaybooks = cache((locale?: string) => req<PlaybookList>('GET', `/v1/me/playbooks${playbookLocaleQuery(locale)}`));

/** `/v1/me.referral`. Later steps of the program add fields; unknown ones are ignored. */
export type MeReferral =
  | { enabled: false }
  | {
      enabled: true;
      link: string;
      count: number;
      goal: number;
      /**
       * The campaign is running (no end set, or before `REFERRAL_CAMPAIGN_ENDS_AT`).
       * Only the campaign-scoped surfaces key off it (the top banner); the link,
       * the count and the menu entry stay after it ends. Optional so an older API
       * that does not send it still parses.
       */
      campaignActive?: boolean;
      /**
       * Whether the top banner shows: the campaign runs, the person is below the
       * goal and not unlocked, the workspace does not pay for Dapta AI, and the
       * banner was not closed in the last 7 days. Optional for an older API,
       * which then shows no banner (`referralBannerVisible`).
       */
      bannerVisible?: boolean;
      /**
       * The person reached the goal: the badge is gone from every workspace
       * they own, for life; `true` hides the banner whatever `bannerVisible`
       * says. Optional so an older API still parses.
       */
      unlocked?: boolean;
    };

export interface Me {
  accountId: string;
  /** The workspace's display name. */
  accountName: string;
  accountCode: string;
  accountShortCode: string;
  vanitySlug: string | null;
  memberId: string;
  handle: string | null;
  displayName: string | null;
  email: string | null;
  role: AccountRole;
  status: MemberStatus;
  /**
   * Whether this person still owes the first-run wizard. Computed by the API —
   * the dashboard deliberately does NOT read the feature flag itself. Two copies
   * of the switch that disagreed would bounce every user into a wizard whose
   * endpoints refuse to serve it, with no way out.
   */
  onboardingRequired: boolean;
  /**
   * Whether this person founded the workspace (its first member, as owner). Sent
   * only while the wizard is owed: it decides the resource hub's short one.
   */
  foundingMember?: boolean;
  /** Epoch-ms the wizard was finished; null while still owed. */
  onboardingCompletedAt: number | null;
  /**
   * First-touch acquisition tags, so the browser can attach them as analytics
   * GROUP properties. Without them the onboarding funnel cannot be sliced by
   * campaign, which is most of the reason to measure it.
   */
  attribution: Record<string, string | number | null | undefined> | null;
  /**
   * What this DEPLOYMENT can do with file answers. `enabled` is false wherever
   * no bucket is configured, which is every bare fork: the builder hides the
   * question type rather than offering one that could never be answered.
   */
  uploads: { enabled: boolean; maxFileMb: number };
  /**
   * Whether this DEPLOYMENT can run spam protection's human check (it has
   * challenge keys). `false` on every bare fork: the Connect tab shows the
   * switch disabled, with the reason. Optional so an API older than this reads
   * as unavailable rather than crashing the editor.
   */
  captcha?: { available: boolean };
  /**
   * Whether this WORKSPACE's public surfaces carry the "Made with dForms"
   * attribution, as the API decides it (the setting and the paid verdict).
   * Optional so an API older than the setting reads as showing. Not
   * `attribution`, which is the signup's acquisition tags above.
   */
  attributionBadge?: { showing: boolean };
  /**
   * The referral program for this PERSON (the same in every workspace): their
   * referral link and progress, or `{ enabled: false }` while the API has the
   * program switched off. Optional so an older API reads as off. The web app
   * never reads the switch itself.
   */
  referral?: MeReferral;
  /** `'staff'` when the caller is in this workspace by access grant, not by membership. */
  accessGrant: 'staff' | null;
  /** Staff of the deployment (by email domain, identity-backed only): may search and enter the whole estate. */
  staff: boolean;
  /**
   * The language this person chose, or null when they never did. Read by the
   * login callback to seed the render-time cookie on a browser that has none;
   * pages themselves read the cookie, not this.
   */
  locale: 'en' | 'es' | null;
  /** The workspace's IANA timezone, or null while nobody has set one (UTC). */
  timezone: string | null;
}

/**
 * One screen's worth of onboarding answers. Every field optional because this is
 * PATCHed as the person advances — a half-filled body is the normal case, not a
 * degenerate one.
 */
export interface OnboardingProgress {
  role?: string | null;
  industry?: string | null;
  useCase?: string | null;
  crm?: string | null;
  leadVolume?: string | null;
  leadSource?: string | null;
  phone?: string | null;
  template?: string | null;
  lastStep?: string | null;
  /** The path that shortened the wizard (`hub`); absent on the ordinary one. */
  flow?: 'hub';
}

/**
 * The completion body. The answers ride along with the template rather than
 * being left to the last PATCH to deliver in time — see `onboardingCompleteSchema`
 * in @quill/types, which is the contract this mirrors.
 */
export interface OnboardingComplete {
  template: string;
  role?: string | null;
  industry?: string | null;
  useCase?: string | null;
  crm?: string | null;
  leadVolume?: string | null;
  leadSource?: string | null;
  phone?: string | null;
  /**
   * Which screens this person was shown. The server needs it to record WHY the
   * unasked ones are empty — a Dapta account's null industry is a pointer at
   * Dapta, not a gap in our data.
   */
  cohort?: string;
  /** What the wizard rendered in, so the created form is named to match. */
  locale?: string;
  /** Set together for a signup from the resource hub: the API emails the playbook. */
  flow?: 'hub';
  playbook?: string;
  playbookLocale?: 'es' | 'en';
}

export interface FormSummary {
  id: string;
  name: string;
  slug: string;
  /** Epoch-ms of the last brand-kit apply; null when never applied or reverted. */
  brandAppliedAt: number | null;
  /** The folder the form is filed in; null = unfiled. */
  folderId: string | null;
  /**
   * Whether edits are waiting to be published. Optional because the web app
   * and the API deploy separately: an API that predates the field answers
   * without it, and the list then shows no status rather than a wrong one.
   */
  hasDraft?: boolean;
  createdAt: number;
  updatedAt: number;
}

/** A form folder: flat, named only, unique per workspace without regard to case. */
export interface Folder {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
}

/** GET /v1/link-page (the default page) and GET /v1/link-pages/:id: a page and everything its editor's preview needs. */
export interface LinkPageEditorView {
  /** Which page; null on `/v1/link-page` while the workspace has none. */
  id: string | null;
  slug: string | null;
  name: string | null;
  isDefault: boolean;
  accountCode: string;
  accountName: string;
  page: LinkPage | null;
  forms: LinkPageFormRef[];
  brandKit: BrandKit | null;
  publicUrl: string | null;
  live: boolean;
}

/** GET /v1/link-pages: every page of the workspace, the default first. */
export interface LinkPagesListView {
  accountCode: string;
  max: number;
  pages: Array<LinkPageSummary & { publicUrl: string | null }>;
}

/** GET/PUT /v1/branding — the workspace brand kit (null = none saved yet). */
export interface BrandingResponse {
  config: BrandKit | null;
  updatedAt: number | null;
}
export type { BrandKit };

export interface FormDetail {
  id: string;
  accountId: string;
  name: string;
  slug: string;
  /** The LIVE (published) config — what the public renderer serves. */
  config: FormConfig;
  /** Unpublished working copy; null/absent when no draft is pending. */
  draftConfig?: FormConfig | null;
  /** Epoch-ms of the last publish; null = never published via the draft flow. */
  publishedAt?: number | null;
  /** Epoch-ms of when the version a revert would bring back went live; null = nothing to revert to. */
  previousPublishedAt?: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface Submission {
  id: string;
  formId: string;
  sessionId: string;
  data: Record<string, unknown>;
  score: number;
  startedAt: number;
  completedAt: number | null;
  partialAt: number | null;
}

export interface AccountMember {
  id: string;
  email: string | null;
  displayName: string | null;
  handle: string | null;
  avatarUrl: string | null;
  role: AccountRole;
  status: MemberStatus;
  createdAt: number;
}

/** An invitation that has not been accepted yet (lives in the identity service). */
export interface PendingInvitation {
  id: string;
  email: string;
  status: string;
  createdAt: string | null;
  expiresAt: string | null;
}

export type { AnalyticsResponse, SubmissionsPage } from '@quill/types';

/**
 * The submissions filter the API reads (see `submissions/filters.ts`, which
 * builds it from the page's URL): `from`/`to` as epoch ms or as `YYYY-MM-DD`
 * days in the workspace's zone, and the answer filters as one JSON param.
 */
export interface SubmissionsQuery {
  /** `completed` or `partial`; anything else is every response. */
  status?: string;
  from?: number | string;
  to?: number | string;
  scoreMin?: string;
  scoreMax?: string;
  /** `{"questionKey": ["value", …]}` as JSON. */
  answers?: string;
  /** Text looked for in the written answers. */
  search?: string;
  sort?: string;
  limit?: number;
  offset?: number;
}

/** A page of one question's answers, as the Summary's search lists them. */
export interface SummaryAnswersPage {
  items: SummaryAnswer[];
  total: number;
  limit: number;
  offset: number;
}

/** Build a `?a=b&…` string from defined params only. */
function qs(params: Record<string, string | number | undefined | null>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

export const isAdminRole = (role: AccountRole): boolean => role === 'owner' || role === 'admin';

/**
 * One allowed value of an enumeration property. `value` is what gets WRITTEN to
 * HubSpot, `label` is what HubSpot shows a human — routinely different, which
 * is why these are worth a picker instead of a text box.
 */
export interface HubSpotPropertyOption {
  value: string;
  label: string;
}

/** A HubSpot contact property surfaced to the mapping UI. */
export interface HubSpotProperty {
  name: string;
  label: string;
  type: string;
  /**
   * Allowed values, for enumeration properties only — ABSENT on text/number/date
   * ones (never `[]`), so `options?.length` is the whole "is this a picklist?"
   * test. Order is HubSpot's own; never re-sort it.
   */
  options?: HubSpotPropertyOption[];
}

/** The property-picker response: disabled (no server token) or the property list. */
/** What was being delivered. Mirrors `OutboxKind` in @quill/db. */
export type DeliveryKind =
  | 'webhook'
  | 'email'
  | 'hubspot'
  | 'google-sheets'
  | 'salesforce'
  | 'gohighlevel'
  | 'booking_sync'
  | 'analytics'
  | 'dapta_sync';

/**
 * How a delivery ended. `pending` covers both "not attempted yet" and "waiting
 * out a backoff between retries" — the queue does not distinguish them, and the
 * UI should not pretend it does.
 */
export type DeliveryStatus = 'pending' | 'done' | 'failed' | 'skipped';

/** One side-effect this form enqueued, as the admin surfaces it. */
export interface FormDelivery {
  id: string;
  kind: DeliveryKind;
  status: DeliveryStatus;
  /** The lifecycle moment that enqueued it (`complete`, `crm_update`, `ping`…). */
  action: string;
  lastError: string | null;
  attempts: number;
  createdAt: number;
  updatedAt: number;
  /**
   * What actually crossed the wire. `null` = NOT RECORDED — a delivery from
   * before this was captured, or a kind whose adapter has no single request to
   * report. Never "an empty body was sent", and the UI must not imply otherwise.
   */
  requestBody: string | null;
  responseStatus: number | null;
  responseBody: string | null;
}


export type HubSpotPropertiesResponse =
  | { enabled: false; reason: string }
  | { enabled: true; cached: boolean; properties: HubSpotProperty[] };

/**
 * Account-level integration providers.
 *
 * Two of them are paste-token connections. `google-sheets` is not: it is
 * connected by walking Google's consent screen, so the panel starts it through
 * `authorizeGoogleSheets` and `connectIntegration` refuses it outright (the API
 * answers 400 rather than storing a credential that would die within the hour).
 */
export type IntegrationProvider = 'hubspot' | 'calendly' | 'google-sheets' | 'salesforce' | 'gohighlevel';

/** Why a HighLevel connection was refused, or what the browser decided (see `@quill/types`). */
export type { GoHighLevelConnectError, GoHighLevelFieldsResponse } from '@quill/types';

/**
 * Why a Salesforce connection was refused (the API's `reason`), one per thing
 * the admin has to go and fix. Never Salesforce's own error text.
 */
export type SalesforceConnectError =
  | 'domain_invalid'
  | 'invalid_client'
  | 'no_run_as'
  | 'rejected'
  | 'unreachable';

/** One writable Lead field of the connected org, for the mapping editor. */
export interface SalesforceField {
  /** API name, what a mapping stores. */
  name: string;
  label: string;
  type: string;
  /** Salesforce refuses a NEW Lead without it. */
  required: boolean;
  options?: { value: string; label: string }[];
}

/** GET /v1/integrations/salesforce/fields. */
export type SalesforceFieldsResponse =
  | { enabled: false; reason: 'not_connected' | 'rejected' | 'unavailable' }
  | { enabled: true; cached: boolean; lead: SalesforceField[]; contact: string[] };

/**
 * One account-level connection's token-free status (GET /v1/integrations). The
 * token is never returned — only a display label and the last 4 chars.
 */
export interface IntegrationStatus {
  provider: IntegrationProvider;
  connected: boolean;
  last4: string | null;
  label: string | null;
  connectedAt: number;
  /** HighLevel only: the sub-account's Location ID. */
  locationId?: string | null;
  /**
   * HighLevel only: when a delivery last got a 401 or 403 for this token
   * (epoch ms). Null while it works; a successful connect clears it.
   */
  rejectedAt?: number | null;
}

/** One tab of a spreadsheet. `gid` is the `#gid=` in its URL. */
export interface SheetTab {
  title: string;
  gid: number;
}

/**
 * The tab picker's answer. `enabled: false` carries WHY, because the four
 * reasons send an author to four different places: connect Google, check the
 * link, ask whoever owns the spreadsheet for access, or try again.
 */
export type GoogleSheetsTabsResponse =
  | { enabled: true; spreadsheetTitle: string; tabs: SheetTab[] }
  | { enabled: false; reason: 'not_connected' | 'not_found' | 'forbidden' | 'unavailable' };

/** A spreadsheet created for a form in the connected Google account. */
export type GoogleSheetsCreateResponse =
  | { ok: true; spreadsheetId: string; spreadsheetTitle: string; sheetTitle: string; gid: number }
  | { ok: false; reason: 'not_connected' | 'forbidden' | 'unavailable' };

/**
 * What Google's Picker needs to open. The access token here is the one Google
 * credential that reaches a browser, because the Picker cannot run without it;
 * it reaches only the files this app created or was handed, and lasts an hour.
 */
export type GoogleSheetsPickerResponse =
  | { enabled: true; accessToken: string; apiKey: string; appId: string }
  | { enabled: false; reason: 'not_connected' | 'unavailable' };

/** What writing the header row did. `written: false` means row 1 was in use. */
export type GoogleSheetsHeaderRowResponse =
  | { ok: true; written: true }
  | { ok: true; written: false; reason: 'not_empty' }
  | { ok: false; reason: 'not_connected' | 'not_found' | 'forbidden' | 'unavailable' };

/**
 * What keeping a form's header row in line with its columns did (the API's
 * `SheetHeaderSync`). `foreign`: row 1 holds something dForms did not write,
 * and it was left exactly as it was.
 */
export type SheetHeaderSync =
  | { outcome: 'written' | 'unchanged' }
  /** A `check` found row 1 is dForms' own but out of date (nothing written). */
  | { outcome: 'stale' }
  /** Row 1 does not match: what it holds, and what would be written instead. */
  | { outcome: 'foreign'; current: string[]; headers: string[] }
  | { outcome: 'failed'; reason: 'not_connected' | 'not_found' | 'forbidden' | 'unavailable' };

/** POST /v1/forms/:id/destinations/google-sheets/header-row. */
export type FormSheetHeaderRowResponse =
  | ({ ok: true } & SheetHeaderSync)
  | { ok: false; reason: 'not_configured' };

/** GET /v1/integrations — this account's connections + server encryption availability. */
export interface IntegrationsResponse {
  encryptionAvailable: boolean;
  providers: IntegrationStatus[];
  /**
   * Providers the DEPLOYMENT supplies a token for (the `*_TOKEN` env fallback).
   * These work for every account without anyone connecting anything, which is
   * why the page has to say so — otherwise it reports "Not connected" about an
   * integration that is actively syncing.
   */
  serverProvided?: IntegrationProvider[];
  /**
   * Providers this DEPLOYMENT cannot connect at all, because configuration only
   * its operator can supply is absent (Google Sheets needs an OAuth client
   * registered with Google). The pages leave their cards out: a card whose
   * button can only fail is worse than no card.
   */
  unavailable?: IntegrationProvider[];
  /**
   * Whether an EXISTING spreadsheet can be chosen (Google's Picker needs a
   * browser key the operator supplies). False or absent, the spreadsheet card
   * offers only "create a new spreadsheet".
   */
  googlePicker?: boolean;
  /**
   * dCal on this deployment: where event types are created. Absent or null
   * when the deployment has no dCal, and then the Connections page leaves its
   * card out. Not a connection: dCal uses the author's own Dapta sign-in.
   */
  dcal?: { createEventUrl: string } | null;
}

/**
 * One webhook in the account's inventory (GET /v1/integrations/webhooks).
 *
 * Webhooks are the destination that is configured per FORM rather than connected
 * once per account, so this list is read-only: it says which form owns each one
 * and links there to change it.
 *
 * The signing secret has no field here because the server never selects it —
 * `hasSecret` is the whole of what crosses the wire, and the mask sentinel the
 * form endpoints use on read never appears.
 */
export interface AccountWebhook {
  formId: string;
  formName: string;
  /** Null on configs written before destinations carried stable ids. */
  webhookId: string | null;
  url: string;
  enabled: boolean;
  /** Already resolved server-side: absent triggers mean both phases fire. */
  firesPartial: boolean;
  firesComplete: boolean;
  /**
   * The owning form's spam protection holds partial deliveries on this
   * deployment, so a partial trigger is paused. Optional: an older API sends
   * none, which reads as "not held", exactly what it meant then.
   */
  partialsHeld?: boolean;
  hasSecret: boolean;
  /**
   * Deliveries that ended without landing, rolled up per FORM — the queue records
   * the form, not the destination, so two webhooks on one form share a figure.
   * Null when nothing failed; there is deliberately no "healthy" counterpart,
   * since a queue with no failures cannot be told from one that never ran.
   */
  failures: { count: number; lastError: string | null; lastAt: number } | null;
}

/** GET /v1/integrations/webhooks — one entry per webhook, across every form. */
export interface AccountWebhooksResponse {
  items: AccountWebhook[];
}

/**
 * One extra field an event type's booking form asks for beyond name + email.
 * `id` is Calendly's positional prefill parameter (`a1`, `a2`, …).
 */
export interface CalendlyBookingField {
  id: string;
  label: string;
  required: boolean;
}

/** A Calendly event type surfaced to the scheduler step's event-type picker. */
export interface CalendlyEventType {
  uri: string;
  name: string;
  schedulingUrl: string;
  active: boolean;
  durationMinutes: number;
  /** The event type's own custom questions (what its booking form really asks). */
  customQuestions: CalendlyBookingField[];
}

/**
 * The event-type-picker response: disabled (no token) or the cached list.
 * `connectedAs` is the Calendly user the list is scoped to (Calendly only
 * returns what that user owns or hosts).
 */
export type CalendlyEventTypesResponse =
  | { enabled: false; reason: string }
  | { enabled: true; cached: boolean; connectedAs: string | null; eventTypes: CalendlyEventType[] };

/**
 * One question a dCal event type's booking form asks, beyond the name, email
 * and notes its form always asks. `name` is the field's own name, which is
 * also its prefill parameter (`answer_<name>`): a NAME, where Calendly's ids
 * are positional.
 */
export interface DcalBookingField {
  name: string;
  label: string;
  type: string;
  required: boolean;
}

/** A dCal event type the scheduler step can embed. */
export interface DcalEventType {
  /** dCal's own event-type id (what the step stores as `eventTypeUri`). */
  id: string;
  name: string;
  /** The public booking page, already assembled by the API. */
  schedulingUrl: string;
  active: boolean;
  durationMinutes: number;
  /** Null for the author's own events; the team's name for a team event. */
  teamName: string | null;
  bookingFields: DcalBookingField[];
}

/** A workspace the author can act in, for the picker's switcher. */
export interface DcalWorkspace {
  id: string;
  name: string;
  current: boolean;
}

/**
 * Why the dCal picker has no list (mirrors `DcalUnavailableCode` in the API).
 * Absent on an answer from an API older than the code: read as `not_configured`,
 * which is what that API meant by every refusal.
 */
export type DcalUnavailableCode =
  | 'not_configured'
  | 'no_session'
  | 'session_rejected'
  | 'no_booking_page'
  | 'dcal_error';

/**
 * The dCal picker's response. Unlike the other two, "unavailable" here never
 * means "connect something": there is no credential to connect. `code` says
 * which of the reasons it is, so each gets its own sentence.
 */
export type DcalEventTypesResponse =
  | { enabled: false; reason: string; code?: DcalUnavailableCode; setupUrl?: string | null }
  | {
      enabled: true;
      cached: boolean;
      connectedAs: string | null;
      workspaces: DcalWorkspace[];
      eventTypes: DcalEventType[];
      /** dCal's event-type editor, for an author who has none yet. */
      createEventUrl: string | null;
    };

export type { FormDestination };

// --- Notifications (submission emails) ---------------------------------------

export type NotificationEmailKey = 'submission_received' | 'submission_confirmed';

/** The shipped default copy (token-bearing) for one locale. */
export interface NotificationDefault {
  subject: string;
  body: string;
}

/** One editable submission email: stored override + shipped defaults + token catalog. */
export interface NotificationSettingView {
  emailKey: NotificationEmailKey;
  enabled: boolean;
  /** Custom override; null = using the shipped default template. */
  subject: string | null;
  body: string | null;
  /**
   * The owner notice's audience. null = nothing stored (it goes to the account
   * owner); [] = stored as "the owner only". Always null on the receipt, which
   * is addressed to the respondent.
   */
  recipients: string[] | null;
  updatedAt: number | null;
  tokens: string[];
  defaults: { en: NotificationDefault; es: NotificationDefault };
}

export interface NotificationsResponse {
  settings: NotificationSettingView[];
}

/** Patch a notification email: null subject/body resets that field to default. */
export interface NotificationPatch {
  enabled?: boolean;
  subject?: string | null;
  body?: string | null;
  /**
   * Up to five distinct, valid addresses, each of which gets its own copy.
   * null restores inheritance (account list, then the owner inbox); [] pins
   * "the owner only". Rejected on `submission_confirmed`.
   */
  recipients?: string[] | null;
}

/** One email's stored values at one layer (account baseline or form override). */
export interface NotificationLayer {
  enabled: boolean;
  subject: string | null;
  body: string | null;
  /** null = this layer stores no list (inherit); [] = "the owner only". */
  recipients: string[] | null;
}

/**
 * One submission email as seen from ONE form (GET /v1/forms/:id/notifications):
 * the account-level baseline it inherits, plus the per-form override when one
 * is stored (null = following the account template). Send-time precedence is
 * form → account → stock, per field.
 */
export interface FormNotificationView {
  emailKey: NotificationEmailKey;
  account: NotificationLayer;
  override: (NotificationLayer & { updatedAt: number | null }) | null;
  tokens: string[];
  defaults: { en: NotificationDefault; es: NotificationDefault };
}

export interface FormNotificationsResponse {
  settings: FormNotificationView[];
}

/** The Brand kit row's view of the attribution switch (`GET /v1/account/attribution-badge`). */
export interface AttributionStatus {
  /** The stored choice, kept even while a lapsed subscription does not honour it. */
  hideAttribution: boolean;
  /** The workspace may turn it off now (a paying Dapta AI subscriber, or an open deployment). */
  canHide: boolean;
  /** What the public surfaces carry right now. */
  showing: boolean;
  /**
   * Whether a paid verdict (paid or not) was ever seen for the workspace, so
   * "your subscription ended" is said only where there was one. Optional: an
   * API older than the field reads as seen (the old wording).
   */
  verdictSeen?: boolean;
  /**
   * The workspace holds a referral unlock (an owner of it reached the goal):
   * the switch works, with no expiry. Optional: an older API reads as false.
   */
  referralUnlocked?: boolean;
}

export const adminApi = {
  /** Who am I, in the cookie's workspace — or in `opts.workspace` when managing another one. */
  me: (opts?: ReqOptions) => req<Me>('GET', '/v1/me', undefined, opts),

  // Onboarding (first-run wizard)
  saveOnboarding: (b: OnboardingProgress) =>
    req<{ saved: boolean; onboarding: OnboardingProgress | null }>(
      'PATCH',
      '/v1/account/onboarding',
      b,
    ),
  completeOnboarding: (b: OnboardingComplete) =>
    req<{ completed: boolean; formId: string | null }>(
      'POST',
      '/v1/account/onboarding/complete',
      b,
    ),

  vanityStatus: () =>
    req<{ vanitySlug: string | null; shortCode: string; canClaim: boolean }>('GET', '/v1/vanity'),

  // Forms
  listForms: () => req<FormSummary[]>('GET', '/v1/forms'),
  getForm: (id: string) => req<FormDetail>('GET', `/v1/forms/${id}`),
  /**
   * One uploaded file: how to download it, and whether it can be shown in
   * place. Both URLs are short-lived, minted per click and never stored.
   */
  submissionFile: (formId: string, submissionId: string, stepKey: string) =>
    req<SubmissionFile>(
      'GET',
      `/v1/forms/${formId}/submissions/${submissionId}/files/${encodeURIComponent(stepKey)}`,
    ),
  createForm: (b: { name: string; slug?: string; config?: unknown; folderId?: string | null }) =>
    req<FormDetail>('POST', '/v1/forms', b),
  updateForm: (id: string, b: { name?: string; config?: unknown; expectedUpdatedAt?: number }) =>
    req<FormDetail>('PUT', `/v1/forms/${id}`, b),
  /**
   * Rename the form's public URL. Its own endpoint, not a field on `updateForm`:
   * that one is the builder's autosave, and retiring a public slug is not
   * something a keystroke should do. Throws ApiError with `code` SLUG_TAKEN or
   * SLUG_INVALID (409) for the two ways it can be refused.
   */
  setFormSlug: (id: string, slug: string) =>
    req<FormDetail>('PUT', `/v1/forms/${id}/slug`, { slug }),
  duplicateForm: (id: string) => req<FormDetail>('POST', `/v1/forms/${id}/duplicate`),
  /** Publish the pending draft config (no-op when no draft is pending). */
  publishForm: (id: string, b?: { expectedUpdatedAt?: number }) =>
    req<FormDetail>('POST', `/v1/forms/${id}/publish`, b?.expectedUpdatedAt === undefined ? undefined : b),
  /** Put the previously published version back live; 409 NOTHING_TO_REVERT when there is none. */
  revertForm: (id: string) => req<FormDetail>('POST', `/v1/forms/${id}/revert`),
  deleteForm: (id: string) => req<void>('DELETE', `/v1/forms/${id}`),

  // Form folders
  listFolders: () => req<Folder[]>('GET', '/v1/folders'),
  createFolder: (name: string) => req<Folder>('POST', '/v1/folders', { name }),
  renameFolder: (id: string, name: string) => req<Folder>('PATCH', `/v1/folders/${id}`, { name }),
  deleteFolder: (id: string) => req<void>('DELETE', `/v1/folders/${id}`),
  /** File a form in a folder; null unfiles it. */
  setFormFolder: (id: string, folderId: string | null) =>
    req<{ id: string; folderId: string | null }>('PATCH', `/v1/forms/${id}/folder`, { folderId }),

  // Workspace brand kit (reads open to members; writes + apply/revert admin/owner)
  getBranding: () => req<BrandingResponse>('GET', '/v1/branding'),
  attributionStatus: () => req<AttributionStatus>('GET', '/v1/account/attribution-badge'),
  setAttribution: (hideAttribution: boolean) =>
    req<AttributionStatus>('PUT', '/v1/account/attribution-badge', { hideAttribution }),
  saveBranding: (config: BrandKit) => req<BrandingResponse>('PUT', '/v1/branding', config),
  /** Snapshot-apply the kit to the given forms (live config + pending draft). */
  applyBranding: (formIds: string[]) =>
    req<{ applied: string[] }>('POST', '/v1/branding/apply', { formIds }),
  /** Undo the last apply on the given forms (one level of undo). */
  revertBranding: (formIds: string[]) =>
    req<{ reverted: string[] }>('POST', '/v1/branding/revert', { formIds }),

  // Analytics + submissions (this track)
  getAnalytics: (id: string, range: { from?: number; to?: number; tz?: string } = {}) =>
    req<AnalyticsResponse>('GET', `/v1/forms/${id}/analytics${qs(range)}`),
  listSubmissions: (id: string, q: SubmissionsQuery = {}) =>
    req<SubmissionsPage>('GET', `/v1/forms/${id}/submissions${qs({ ...q })}`),
  deleteSubmission: (id: string) => req<void>('DELETE', `/v1/submissions/${id}`),
  /** One submission in full (the panel opened from the Summary). 404 when it is not this form's. */
  getSubmission: (formId: string, submissionId: string) =>
    req<SubmissionView>('GET', `/v1/forms/${formId}/submissions/${encodeURIComponent(submissionId)}`),
  /** The Summary tab: the responses matching the filter, question by question. */
  getSummary: (id: string, q: Omit<SubmissionsQuery, 'limit' | 'offset' | 'sort'> = {}) =>
    req<SubmissionsSummary>('GET', `/v1/forms/${id}/summary${qs({ ...q })}`),
  /** What the header filters offer, counted over every response of the form. */
  getSubmissionFacets: (id: string) => req<SubmissionFacets>('GET', `/v1/forms/${id}/submissions-facets`),
  /** A page of one text question's answers containing `q` (all of them when blank). */
  searchSummaryAnswers: (
    id: string,
    stepKey: string,
    q: SubmissionsQuery & { q?: string } = {},
  ) =>
    req<SummaryAnswersPage>(
      'GET',
      `/v1/forms/${id}/summary/${encodeURIComponent(stepKey)}/answers${qs({ ...q })}`,
    ),
  /** Delete a selection of one form's submissions (1 to 100 ids); only the account's own go. */
  deleteSubmissions: (formId: string, ids: string[]) =>
    req<{ deleted: number }>('POST', `/v1/forms/${formId}/submissions/bulk-delete`, { ids }),

  // Integrations
  hubspotProperties: () =>
    req<HubSpotPropertiesResponse>('GET', '/v1/integrations/hubspot/properties'),
  /**
   * This form's deliveries, newest first. With no options the API answers with
   * failures across every kind — the same list it has always answered with.
   */
  formDeliveries: (
    id: string,
    opts: { kinds?: DeliveryKind[]; statuses?: DeliveryStatus[]; limit?: number } = {},
  ) => {
    const qs = new URLSearchParams();
    if (opts.kinds?.length) qs.set('kind', opts.kinds.join(','));
    if (opts.statuses?.length) qs.set('status', opts.statuses.join(','));
    if (opts.limit !== undefined) qs.set('limit', String(opts.limit));
    const q = qs.toString();
    return req<{ items: FormDelivery[] }>('GET', `/v1/forms/${id}/deliveries${q ? `?${q}` : ''}`);
  },
  /** Calendly event types for the scheduler step's picker (per-account token). */
  calendlyEventTypes: () =>
    req<CalendlyEventTypesResponse>('GET', '/v1/integrations/calendly/event-types'),
  /** Partial write: replaces ONLY the config's `destinations` key server-side. */
  updateFormDestinations: (id: string, destinations: FormDestination[]) =>
    req<FormDetail & { formActivityError?: string; sheetHeaders?: SheetHeaderSync }>(
      'PUT',
      `/v1/forms/${id}/destinations`,
      { destinations },
    ),
  /**
   * Bring the form's spreadsheet header row in line with its STORED columns.
   * The API reads everything it needs from the form, so this sends no body.
   */
  syncFormSheetHeaders: (id: string, opts?: { replace?: boolean; check?: boolean }) =>
    req<FormSheetHeaderRowResponse>(
      'POST',
      `/v1/forms/${id}/destinations/google-sheets/header-row`,
      opts?.replace ? { replace: true } : opts?.check ? { check: true } : undefined,
    ),

  // Account-level integration connections (paste-token model; admin/owner writes)
  /** This account's connections (token-free) + whether server encryption is available. */
  listIntegrations: () => req<IntegrationsResponse>('GET', '/v1/integrations'),
  /** Every webhook across this account's forms, read-only (secrets never selected). */
  listAccountWebhooks: () => req<AccountWebhooksResponse>('GET', '/v1/integrations/webhooks'),
  /** The workspace link page, with the forms and brand kit its editor previews with. */
  linkPage: () => req<LinkPageEditorView>('GET', '/v1/link-page'),
  /** Replace the workspace link page; null removes it. Any member may. */
  saveLinkPage: (page: unknown | null) =>
    req<{ ok: boolean; page: LinkPage | null }>('PUT', '/v1/link-page', { page }),
  /** Every page of the workspace, the default first. */
  linkPages: () => req<LinkPagesListView>('GET', '/v1/link-pages'),
  /** One page and what its editor needs. */
  linkPageById: (id: string) => req<LinkPageEditorView>('GET', `/v1/link-pages/${encodeURIComponent(id)}`),
  /** Add a page. */
  createLinkPage: (body: { name?: string; slug?: string; page?: unknown }) =>
    req<LinkPageEditorView>('POST', '/v1/link-pages', body),
  /** Change a page: only the fields sent change. */
  updateLinkPage: (id: string, body: { name?: string; slug?: string; isDefault?: true; page?: unknown }) =>
    req<LinkPageEditorView>('PUT', `/v1/link-pages/${encodeURIComponent(id)}`, body),
  /** Copy a page, unpublished, under a new slug. */
  duplicateLinkPage: (id: string, body: { name?: string; slug?: string }) =>
    req<LinkPageEditorView>('POST', `/v1/link-pages/${encodeURIComponent(id)}/duplicate`, body),
  /** Delete a page that is not the default. */
  deleteLinkPage: (id: string) =>
    req<{ ok: boolean; id: string; slug: string }>('DELETE', `/v1/link-pages/${encodeURIComponent(id)}`),
  /** The caller's own public page config (raw blob or null). */
  myProfile: () => req<{ handle: string | null; profile: MemberProfile | null }>('GET', '/v1/me/profile'),
  /** Replace the caller's own public page; null removes it. */
  saveMyProfile: (profile: MemberProfile | null) =>
    req<{ ok: boolean }>('PUT', '/v1/me/profile', { profile }),
  /** Store the caller's own language. The cookie is written separately by the
   *  server action: this is the durable copy, and the one the notification
   *  emails are rendered from. */
  setMyLocale: (locale: 'en' | 'es') => req<{ ok: boolean; locale: 'en' | 'es' }>('PUT', '/v1/me/locale', { locale }),
  /** Close the referral banner for the caller, in every workspace, for 7 days. */
  dismissReferralBanner: () =>
    req<{ dismissedUntil: number | null }>('POST', '/v1/me/referral/banner/dismiss', {}),
  /** The one in-app announcement the caller gets now, or null (see `announcements.ts` in @quill/shared). */
  announcement: () =>
    req<{ announcement: AnnouncementView | null }>('GET', '/v1/me/announcement').then((r) => r.announcement ?? null),
  /** Report what the caller did with an announcement: on screen, card closed, or route reached. */
  recordAnnouncement: (id: string, event: AnnouncementEvent) =>
    req<{ ok: boolean }>('POST', `/v1/me/announcements/${encodeURIComponent(id)}`, { event }),
  /**
   * The playbooks gallery for the caller (the person, not the workspace).
   * Reading it records nothing. Read once per request: the layout (for the
   * rail's "New") and the gallery or the reader all ask for it.
   */
  playbooks: (locale?: string) => readPlaybooks(locale),
  /**
   * One playbook with its whole markdown body, in `locale` (or Spanish, with
   * `fallback`). Records nothing; a 404 for an unknown or unpublished slug.
   */
  playbook: (slug: string, locale?: string) =>
    req<{ playbook: PlaybookCard & { body: string } }>(
      'GET',
      `/v1/me/playbooks/${encodeURIComponent(slug)}${playbookLocaleQuery(locale)}`,
    ).then(
      (r) => r.playbook,
    ),
  /** Record that the caller opened a playbook (first and last open), read in `locale`. */
  recordPlaybookSeen: (slug: string, locale?: string) =>
    req<{ ok: boolean }>('POST', `/v1/me/playbooks/${encodeURIComponent(slug)}/seen${playbookLocaleQuery(locale)}`),
  /** Record a visit to the gallery: only playbooks published after it are "New" from then on. */
  recordPlaybooksGalleryVisit: () => req<{ ok: boolean }>('POST', '/v1/me/playbooks/seen'),
  /** Every workspace the caller can enter, for the switcher. */
  listWorkspaces: () => req<Workspace[]>('GET', '/v1/workspaces'),
  /** Same list after forcing a re-read from the identity service (when there is one). */
  refreshWorkspaces: () => req<Workspace[]>('POST', '/v1/workspaces/refresh'),
  /** Create a workspace with the caller as owner; returns the new local account id. */
  createWorkspace: (name: string) => req<{ accountId: string }>('POST', '/v1/workspaces', { name }),
  /** Rename the workspace the caller is acting in (admin/owner), or `opts.workspace`. */
  renameWorkspace: (name: string, opts?: ReqOptions) =>
    req<{ accountId: string; name: string }>('PATCH', '/v1/workspaces/current', { name }, opts),
  /** Set (null = UTC) or, with `onlyIfUnset`, seed the workspace's timezone. */
  setWorkspaceTimezone: (input: { timezone: string | null; onlyIfUnset?: boolean }, opts?: ReqOptions) =>
    req<{ accountId: string; timezone: string | null; applied: boolean }>(
      'PATCH',
      '/v1/workspaces/current/timezone',
      input,
      opts,
    ),
  /** Tell the API the caller is about to open this workspace (membership re-checked; remembered upstream). */
  enterWorkspace: (accountId: string) => req<{ ok: true }>('POST', `/v1/workspaces/${accountId}/enter`),
  /** Type-to-find: own workspaces filtered by name; staff also get the estate. */
  searchWorkspaces: (q: string, page = 1) =>
    req<WorkspaceSearchResponse>('GET', `/v1/workspaces/search?q=${encodeURIComponent(q)}&page=${page}`),
  /** Staff only: open an estate workspace (an access grant is minted); returns the local account id. */
  enterEstateWorkspace: (workspaceId: string) =>
    req<{ accountId: string }>('POST', `/v1/workspaces/estate/${encodeURIComponent(workspaceId)}/enter`),
  /** Send one sample delivery to a form's webhook (admin-only, SSRF-guarded server-side). */
  pingWebhook: (id: string) =>
    req<WebhookPingResult>('POST', `/v1/forms/${id}/destinations/webhook/ping`),
  /** Validate + encrypt-store a pasted provider token; returns the token-free status. */
  connectIntegration: (provider: IntegrationProvider, token: string) =>
    req<IntegrationStatus>('POST', `/v1/integrations/${provider}/connect`, { token }),
  /**
   * Start the Google Sheets consent flow: returns the Google URL to send the
   * browser to. The account this flow will connect is carried in a signed state
   * minted by this authenticated call, so the URL must be followed as-is and
   * never rebuilt by the caller.
   */
  authorizeGoogleSheets: (returnTo?: string) =>
    req<{ authUrl: string }>(
      'POST',
      '/v1/integrations/google-sheets/authorize',
      returnTo ? { returnTo } : undefined,
    ),
  /** The tabs of one spreadsheet, for the mapping editor's picker. */
  googleSheetsTabs: (spreadsheetId: string) =>
    req<GoogleSheetsTabsResponse>(
      'GET',
      `/v1/integrations/google-sheets/tabs?spreadsheetId=${encodeURIComponent(spreadsheetId)}`,
    ),
  /** Create a spreadsheet for a form, header row included, in one call. */
  googleSheetsCreate: (body: { title: string; sheetTitle: string; headers: string[] }) =>
    req<GoogleSheetsCreateResponse>('POST', '/v1/integrations/google-sheets/spreadsheets', body),
  /** What the browser needs to open Google's Picker (carries an access token). */
  googleSheetsPicker: () =>
    req<GoogleSheetsPickerResponse>('GET', '/v1/integrations/google-sheets/picker'),
  /** Write the header row of the chosen tab, once. Never overwrites a used row 1. */
  googleSheetsHeaderRow: (body: { spreadsheetId: string; sheetTitle?: string; headers: string[] }) =>
    req<GoogleSheetsHeaderRowResponse>('POST', '/v1/integrations/google-sheets/header-row', body),
  /**
   * Connect a Salesforce org with Client Credentials. The API proves the three
   * values before storing them and answers the token-free status.
   */
  connectSalesforce: (body: { domain: string; consumerKey: string; consumerSecret: string }) =>
    req<IntegrationStatus>('POST', '/v1/integrations/salesforce/connect', body),
  /** The connected org's writable Lead fields; `refresh` re-reads the org. */
  salesforceFields: (refresh = false) =>
    req<SalesforceFieldsResponse>('GET', `/v1/integrations/salesforce/fields${refresh ? '?refresh=1' : ''}`),
  /**
   * Connect (or replace the token of) a HighLevel sub-account: a Private
   * Integration token and the Location ID, or the sub-account's URL. The API
   * proves both against HighLevel before storing them.
   */
  connectGoHighLevel: (body: { token: string; locationId: string }) =>
    req<IntegrationStatus>('POST', '/v1/integrations/gohighlevel/connect', body),
  /** The standard fields and the location's mappable custom fields; `refresh` re-reads the location. */
  goHighLevelFields: (refresh = false) =>
    req<GoHighLevelFieldsResponse>('GET', `/v1/integrations/gohighlevel/fields${refresh ? '?refresh=1' : ''}`),
  /** Disconnect a provider for this account (idempotent → 204). */
  disconnectIntegration: (provider: IntegrationProvider) =>
    req<void>('DELETE', `/v1/integrations/${provider}`),

  // Members (workspace roster — admin/owner only). Every call takes `opts.workspace`
  // so Account settings can manage a workspace without switching into it.
  listMembers: (opts?: ReqOptions) => req<AccountMember[]>('GET', '/v1/members', undefined, opts),
  inviteMember: (b: { email: string; role?: 'admin' | 'member' }, opts?: ReqOptions) =>
    req<AccountMember>('POST', '/v1/members', b, opts),
  updateMember: (id: string, b: { role?: AccountRole; status?: MemberStatus }, opts?: ReqOptions) =>
    req<AccountMember>('PATCH', `/v1/members/${id}`, b, opts),
  /** Owner-only (the identity service's rule, mirrored on the local path). */
  removeMember: (id: string, opts?: ReqOptions) =>
    req<{ ok: boolean }>('DELETE', `/v1/members/${id}`, undefined, opts),
  /** Pending invitations (identity-service deployments only; empty otherwise). */
  listInvitations: (opts?: ReqOptions) =>
    req<PendingInvitation[]>('GET', '/v1/invitations', undefined, opts),
  resendInvitation: (id: string, opts?: ReqOptions) =>
    req<{ ok: true }>('POST', `/v1/invitations/${id}/resend`, undefined, opts),

  // Notifications (submission emails — admin/owner only)
  getNotifications: () => req<NotificationsResponse>('GET', '/v1/notifications'),
  updateNotification: (emailKey: NotificationEmailKey, patch: NotificationPatch) =>
    req<NotificationSettingView>('PUT', `/v1/notifications/${emailKey}`, patch),
  resetNotification: (emailKey: NotificationEmailKey) =>
    req<NotificationSettingView>('POST', `/v1/notifications/${emailKey}/reset`),

  // Per-form notification overrides (editor → Connect → Emails; admin/owner only)
  /** Both emails as seen from one form: account baseline + override (if any). */
  getFormNotifications: (id: string) =>
    req<FormNotificationsResponse>('GET', `/v1/forms/${id}/notifications`),
  /** Create/update this form's override for one email. */
  updateFormNotification: (id: string, emailKey: NotificationEmailKey, patch: NotificationPatch) =>
    req<FormNotificationView>('PUT', `/v1/forms/${id}/notifications/${emailKey}`, patch),
  /** Remove this form's override — the form inherits the account template again. */
  resetFormNotification: (id: string, emailKey: NotificationEmailKey) =>
    req<FormNotificationView>('POST', `/v1/forms/${id}/notifications/${emailKey}/reset`),

};
