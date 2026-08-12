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

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const session = await getSession();
  // Which workspace, asked separately from who — and read from its own cookie,
  // because the local provider serves developers who have no session at all.
  // The API re-checks membership against the database; this authorizes nothing.
  const workspace = await getWorkspace();
  const headers: Record<string, string> = {};
  if (body) headers['content-type'] = 'application/json';
  if (session?.provider === 'workos') headers['authorization'] = `Bearer ${session.accessToken}`;
  else if (session?.provider === 'local') headers['x-quill-email'] = session.email;
  if (workspace) headers['x-quill-workspace'] = workspace;

  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: Object.keys(headers).length ? headers : undefined,
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  });
  if (res.status === 401) {
    try {
      await clearSession();
    } catch {
      /* cookies are immutable during render — the redirect still fires */
    }
    redirect(authProvider() === 'workos' ? '/api/auth/logout' : '/login');
  }
  // The stored workspace is no longer ours — the membership was revoked, or the
  // account is gone. Self-heal rather than leaving every page 403ing with no way
  // back, which is what being removed from a workspace would otherwise feel like.
  //
  // Via a ROUTE HANDLER, not a `setWorkspace(null)` here: this code runs inside
  // a Server Component render, where `cookies().set()` throws. Clearing it here
  // and redirecting anyway produced an infinite loop — the dead workspace was
  // re-sent on every hop. The handler owns its response, so the delete lands.
  if (res.status === 403 && workspace) {
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
/** One side-effect that never landed, as the admin surfaces it. */
export interface FailedDelivery {
  id: string;
  kind: string;
  /** `failed` = retries exhausted; `skipped` = a permanent gap, never retried. */
  status: 'failed' | 'skipped';
  lastError: string | null;
  attempts: number;
  createdAt: number;
  updatedAt: number;
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
  /** Deliveries for this form that ended without landing (the failure log). */
  formDeliveries: (id: string) =>
    req<{ items: FailedDelivery[] }>('GET', `/v1/forms/${id}/deliveries`),
  /** Calendly event types for the scheduler step's picker (per-account token). */
  calendlyEventTypes: () =>
    req<CalendlyEventTypesResponse>('GET', '/v1/integrations/calendly/event-types'),
  /** Partial write: replaces ONLY the config's `destinations` key server-side. */
  updateFormDestinations: (id: string, destinations: FormDestination[]) =>
    req<FormDetail>('PUT', `/v1/forms/${id}/destinations`, { destinations }),

  // Account-level integration connections (paste-token model; admin/owner writes)
  /** This account's connections (token-free) + whether server encryption is available. */
  listIntegrations: () => req<IntegrationsResponse>('GET', '/v1/integrations'),
  /** The caller's own public page config (raw blob or null). */
  myProfile: () => req<{ handle: string | null; profile: MemberProfile | null }>('GET', '/v1/me/profile'),
  /** Replace the caller's own public page; null removes it. */
  saveMyProfile: (profile: MemberProfile | null) =>
    req<{ ok: boolean }>('PUT', '/v1/me/profile', { profile }),
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
