/**
 * Server-side admin API client. Every host call carries the current session's
 * identity: `Authorization: Bearer <jwt>` for the workos provider, `x-quill-email`
 * for the local dev provider. A `401` throws an ApiError the /admin gate turns
 * into a redirect to /login.
 */
import { redirect } from 'next/navigation';
import type {
  AnalyticsResponse,
  BrandKit,
  FormConfig,
  FormDestination,
  MemberProfile,
  SubmissionsPage,
} from '@quill/types';
import { serverApiUrl } from './api-url';
import { getSession, clearSession, authProvider, getWorkspace } from './auth-session';

const API_URL = serverApiUrl;

/** An API error that carries the HTTP status + error code. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * The identity headers one API call carries. Factored out of `req` so the
 * revision-guarded profile calls can send exactly the same identity WITHOUT
 * `req`'s redirect-to-login behaviour, which only makes sense while rendering a
 * page — a Route Handler answering a background reconciliation must return
 * JSON, not login HTML with a 200.
 *
 * Always returns headers, even when there is no session: the `local` provider
 * serves developers who have none, and the API — not this function — is the
 * authority on whether a caller is authenticated. An unauthenticated call comes
 * back 401 from the API and is reported as such.
 */
export async function apiIdentityHeaders(): Promise<Record<string, string>> {
  const session = await getSession();
  // Which workspace, asked separately from who — and read from its own cookie,
  // because the local provider serves developers who have no session at all.
  // The API re-checks membership against the database; this authorizes nothing.
  const workspace = await getWorkspace();
  const headers: Record<string, string> = {};
  if (session?.provider === 'workos') headers['authorization'] = `Bearer ${session.accessToken}`;
  else if (session?.provider === 'local') headers['x-quill-email'] = session.email;
  if (workspace) headers['x-quill-workspace'] = workspace;
  return headers;
}

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { ...(await apiIdentityHeaders()) };
  if (body) headers['content-type'] = 'application/json';

  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: Object.keys(headers).length ? headers : undefined,
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  });
  if (res.status === 401) {
    // Workos: leave the cookie alone. /api/auth/logout reads the session id off
    // it to revoke upstream and then clears it itself — deleting it here first
    // hands that route a null session and silently skips the single-logout (see
    // `signOutAction`). This path only appeared to work because `delete()` throws
    // during a Server Component render; from a Server Action it lands and breaks.
    if (authProvider() === 'workos') redirect('/api/auth/logout');
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
  if (res.status === 403 && headers['x-quill-workspace']) {
    const j = (await res.clone().json().catch(() => ({}))) as { error?: string };
    if (j.error === 'WORKSPACE_FORBIDDEN') redirect('/api/workspace/reset');
  }
  if (!res.ok) {
    const j = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
    throw new ApiError(res.status, j.message ?? j.error ?? `${method} ${path} → ${res.status}`, j.error);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json().catch(() => ({}))) as T;
}

export type AccountRole = 'owner' | 'admin' | 'member';
export type MemberStatus = 'active' | 'invited' | 'disabled';

/** One account the signed-in person can act in. */
export interface Workspace {
  accountId: string;
  accountCode: string;
  accountName: string;
  memberId: string;
  role: AccountRole;
  /** `invited` until they first open it — shown as pending in the switcher. */
  status: MemberStatus;
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

export interface Me {
  accountId: string;
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
  /** Epoch-ms the wizard was finished; null while still owed. */
  onboardingCompletedAt: number | null;
  /**
   * First-touch acquisition tags, so the browser can attach them as analytics
   * GROUP properties. Without them the onboarding funnel cannot be sliced by
   * campaign, which is most of the reason to measure it.
   */
  attribution: Record<string, string | number | null | undefined> | null;
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
}

export interface FormSummary {
  id: string;
  name: string;
  slug: string;
  /** Epoch-ms of the last brand-kit apply; null when never applied or reverted. */
  brandAppliedAt: number | null;
  createdAt: number;
  updatedAt: number;
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

export type { AnalyticsResponse, SubmissionsPage } from '@quill/types';

export interface SubmissionsQuery {
  status?: 'all' | 'completed' | 'partial';
  from?: number;
  to?: number;
  limit?: number;
  offset?: number;
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
export type DeliveryKind = 'webhook' | 'email' | 'hubspot' | 'booking_sync' | 'analytics' | 'dapta_sync';

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

/** Account-level integration providers (paste-token connections). */
export type IntegrationProvider = 'hubspot' | 'calendly';

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
}

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

/** The event-type-picker response: disabled (no token) or the cached list. */
export type CalendlyEventTypesResponse =
  | { enabled: false; reason: string }
  | { enabled: true; cached: boolean; eventTypes: CalendlyEventType[] };

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
}

/** One email's stored values at one layer (account baseline or form override). */
export interface NotificationLayer {
  enabled: boolean;
  subject: string | null;
  body: string | null;
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

export const adminApi = {
  me: () => req<Me>('GET', '/v1/me'),

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
  createForm: (b: { name: string; slug?: string; config?: unknown }) =>
    req<FormDetail>('POST', '/v1/forms', b),
  updateForm: (id: string, b: { name?: string; slug?: string; config?: unknown }) =>
    req<FormDetail>('PUT', `/v1/forms/${id}`, b),
  duplicateForm: (id: string) => req<FormDetail>('POST', `/v1/forms/${id}/duplicate`),
  /** Publish the pending draft config (no-op when no draft is pending). */
  publishForm: (id: string) => req<FormDetail>('POST', `/v1/forms/${id}/publish`),
  deleteForm: (id: string) => req<void>('DELETE', `/v1/forms/${id}`),

  // Workspace brand kit (reads open to members; writes + apply/revert admin/owner)
  getBranding: () => req<BrandingResponse>('GET', '/v1/branding'),
  saveBranding: (config: BrandKit) => req<BrandingResponse>('PUT', '/v1/branding', config),
  /** Snapshot-apply the kit to the given forms (live config + pending draft). */
  applyBranding: (formIds: string[]) =>
    req<{ applied: string[] }>('POST', '/v1/branding/apply', { formIds }),
  /** Undo the last apply on the given forms (one level of undo). */
  revertBranding: (formIds: string[]) =>
    req<{ reverted: string[] }>('POST', '/v1/branding/revert', { formIds }),

  // Analytics + submissions (this track)
  getAnalytics: (id: string, range: { from?: number; to?: number } = {}) =>
    req<AnalyticsResponse>('GET', `/v1/forms/${id}/analytics${qs(range)}`),
  listSubmissions: (id: string, q: SubmissionsQuery = {}) =>
    req<SubmissionsPage>('GET', `/v1/forms/${id}/submissions${qs({ ...q })}`),
  deleteSubmission: (id: string) => req<void>('DELETE', `/v1/submissions/${id}`),

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
    req<FormDetail>('PUT', `/v1/forms/${id}/destinations`, { destinations }),

  // Account-level integration connections (paste-token model; admin/owner writes)
  /** This account's connections (token-free) + whether server encryption is available. */
  listIntegrations: () => req<IntegrationsResponse>('GET', '/v1/integrations'),
  /** Every webhook across this account's forms, read-only (secrets never selected). */
  listAccountWebhooks: () => req<AccountWebhooksResponse>('GET', '/v1/integrations/webhooks'),
  /**
   * The caller's own public page, with the revision to write against. `revision`
   * is absent when the API predates the compare-and-set contract — that is the
   * capability signal, and a client without it must not write.
   */
  myProfile: () =>
    req<{ handle: string | null; profile: MemberProfile | null; revision?: number }>(
      'GET',
      '/v1/me/profile',
    ),
  /** Every workspace the caller can enter, for the switcher. */
  listWorkspaces: () => req<Workspace[]>('GET', '/v1/workspaces'),
  /** Send one sample delivery to a form's webhook (admin-only, SSRF-guarded server-side). */
  pingWebhook: (id: string) =>
    req<WebhookPingResult>('POST', `/v1/forms/${id}/destinations/webhook/ping`),
  /** Validate + encrypt-store a pasted provider token; returns the token-free status. */
  connectIntegration: (provider: IntegrationProvider, token: string) =>
    req<IntegrationStatus>('POST', `/v1/integrations/${provider}/connect`, { token }),
  /** Disconnect a provider for this account (idempotent → 204). */
  disconnectIntegration: (provider: IntegrationProvider) =>
    req<void>('DELETE', `/v1/integrations/${provider}`),

  // Members (workspace roster — admin/owner only)
  listMembers: () => req<AccountMember[]>('GET', '/v1/members'),
  inviteMember: (b: { email: string; role?: 'admin' | 'member' }) =>
    req<AccountMember>('POST', '/v1/members', b),
  updateMember: (id: string, b: { role?: AccountRole; status?: MemberStatus }) =>
    req<AccountMember>('PATCH', `/v1/members/${id}`, b),
  removeMember: (id: string) => req<{ ok: boolean }>('DELETE', `/v1/members/${id}`),

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


// --- Public page writes (v2: compare-and-set + fence) ------------------------

/**
 * How long a server-side profile call may run before we abort it.
 *
 * Strictly shorter than the 15s ceiling `callAction` puts on a Server Action, so
 * the ambiguity is decided HERE, in one place we control, instead of the action
 * being killed from outside while this fetch is still open.
 *
 * Aborting proves nothing about the API: the request may already have been
 * received and committed. That is exactly why an aborted write is reported as
 * `unknown` and settled by the fence, never reported as a failure.
 */
export const PROFILE_CALL_TIMEOUT_MS = 8_000;

/** The stored public page and the revision behind it. */
export interface ProfileState {
  profile: MemberProfile | null;
  revision: number;
}

/**
 * Outcome of a revision-guarded profile call, as the web sees it.
 * `unknown` is the honest answer to an aborted or dropped call: the write may
 * have landed. `unsupported` means this API cannot guard writes at all.
 */
export type ProfileCallResult =
  | { status: 'ok'; profile: MemberProfile | null; revision: number }
  | { status: 'conflict'; profile: MemberProfile | null; revision: number }
  | { status: 'unsupported' }
  | { status: 'unauthorized' }
  | { status: 'not_found' }
  | { status: 'unknown' }
  | { status: 'failed'; message?: string };

const numericRevision = (v: unknown): number | null =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : null;

/**
 * One revision-guarded call to the API, with no redirect behaviour: every
 * outcome comes back as a value so both a Server Action and a Route Handler can
 * branch on it.
 */
async function profileCall(
  method: 'PUT' | 'POST',
  path: string,
  body: Record<string, unknown>,
  opts?: { signal?: AbortSignal },
): Promise<ProfileCallResult> {
  const identity = await apiIdentityHeaders();
  const budget = AbortSignal.timeout(PROFILE_CALL_TIMEOUT_MS);
  const signal = opts?.signal ? AbortSignal.any([opts.signal, budget]) : budget;

  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      headers: { ...identity, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
      signal,
    });
  } catch {
    // Aborted, dropped, or refused before an answer: the write may still be
    // running server-side. Do not call this a failure.
    return { status: 'unknown' };
  }

  if (res.status === 401) return { status: 'unauthorized' };
  if (res.status === 403) return { status: 'unauthorized' };
  // An API that predates this contract has no /v2 route (404) and a rolled-out
  // one has retired the /v1 shim (410). Both mean: do not write here.
  if (res.status === 404 || res.status === 410) {
    const body404 = (await res.json().catch(() => ({}))) as { error?: string };
    if (res.status === 410 || body404.error === 'NOT_FOUND') {
      return res.status === 410 ? { status: 'unsupported' } : { status: 'not_found' };
    }
    return { status: 'unsupported' };
  }

  const payload = (await res.json().catch(() => ({}))) as {
    profile?: MemberProfile | null;
    revision?: unknown;
    message?: string;
    error?: string;
  };
  const revision = numericRevision(payload.revision);

  if (res.status === 409) {
    // A conflict without authoritative state is unusable — treat it as failure
    // rather than adopting an invented revision.
    if (revision === null) return { status: 'failed', message: payload.message };
    return { status: 'conflict', profile: payload.profile ?? null, revision };
  }
  if (!res.ok) return { status: 'failed', message: payload.message ?? payload.error };
  if (revision === null) return { status: 'unsupported' };
  return { status: 'ok', profile: payload.profile ?? null, revision };
}

/** Replace the caller's public page, but only if it is still at `expectedRevision`. */
export const saveMyProfileV2 = (
  profile: MemberProfile | null,
  expectedRevision: number,
  opts?: { signal?: AbortSignal },
): Promise<ProfileCallResult> =>
  profileCall('PUT', '/v2/me/profile', { profile, expectedRevision }, opts);

/**
 * Order one ambiguous save: advance the revision without touching content.
 * Winning proves the ambiguous write never landed; losing returns the state
 * that beat it. Always called with the revision the ambiguous save expected.
 */
export const fenceMyProfileV2 = (
  expectedRevision: number,
  opts?: { signal?: AbortSignal },
): Promise<ProfileCallResult> =>
  profileCall('POST', '/v2/me/profile/fence', { expectedRevision }, opts);
