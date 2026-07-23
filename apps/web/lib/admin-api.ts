/**
 * Server-side admin API client. Every host call carries the current session's
 * identity: `Authorization: Bearer <jwt>` for the workos provider, `x-quill-email`
 * for the local dev provider. A `401` throws an ApiError the /admin gate turns
 * into a redirect to /login.
 */
import { redirect } from 'next/navigation';
import type { AnalyticsResponse, FormConfig, FormDestination, SubmissionsPage } from '@quill/types';
import { getSession, clearSession, authProvider } from './auth-session';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

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
  const headers: Record<string, string> = {};
  if (body) headers['content-type'] = 'application/json';
  if (session?.provider === 'workos') headers['authorization'] = `Bearer ${session.accessToken}`;
  else if (session?.provider === 'local') headers['x-quill-email'] = session.email;

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
  if (!res.ok) {
    const j = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
    throw new ApiError(res.status, j.message ?? j.error ?? `${method} ${path} → ${res.status}`, j.error);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json().catch(() => ({}))) as T;
}

export type AccountRole = 'owner' | 'admin' | 'member';
export type MemberStatus = 'active' | 'invited' | 'disabled';

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
}

export interface FormSummary {
  id: string;
  name: string;
  slug: string;
  createdAt: number;
  updatedAt: number;
}

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

/** A HubSpot contact property surfaced to the mapping UI. */
export interface HubSpotProperty {
  name: string;
  label: string;
  type: string;
}

/** The property-picker response: disabled (no server token) or the property list. */
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
}

/** A Calendly event type surfaced to the scheduler step's event-type picker. */
export interface CalendlyEventType {
  uri: string;
  name: string;
  schedulingUrl: string;
  active: boolean;
  durationMinutes: number;
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
  vanityStatus: () =>
    req<{ vanitySlug: string | null; shortCode: string; canClaim: boolean }>('GET', '/v1/vanity'),

  // Forms
  listForms: () => req<FormSummary[]>('GET', '/v1/forms'),
  getForm: (id: string) => req<FormDetail>('GET', `/v1/forms/${id}`),
  createForm: (b: { name: string; slug?: string }) => req<FormDetail>('POST', '/v1/forms', b),
  updateForm: (id: string, b: { name?: string; slug?: string; config?: unknown }) =>
    req<FormDetail>('PUT', `/v1/forms/${id}`, b),
  duplicateForm: (id: string) => req<FormDetail>('POST', `/v1/forms/${id}/duplicate`),
  /** Publish the pending draft config (no-op when no draft is pending). */
  publishForm: (id: string) => req<FormDetail>('POST', `/v1/forms/${id}/publish`),
  deleteForm: (id: string) => req<void>('DELETE', `/v1/forms/${id}`),

  // Analytics + submissions (this track)
  getAnalytics: (id: string, range: { from?: number; to?: number } = {}) =>
    req<AnalyticsResponse>('GET', `/v1/forms/${id}/analytics${qs(range)}`),
  listSubmissions: (id: string, q: SubmissionsQuery = {}) =>
    req<SubmissionsPage>('GET', `/v1/forms/${id}/submissions${qs({ ...q })}`),
  deleteSubmission: (id: string) => req<void>('DELETE', `/v1/submissions/${id}`),

  // Integrations
  hubspotProperties: () =>
    req<HubSpotPropertiesResponse>('GET', '/v1/integrations/hubspot/properties'),
  /** Calendly event types for the scheduler step's picker (per-account token). */
  calendlyEventTypes: () =>
    req<CalendlyEventTypesResponse>('GET', '/v1/integrations/calendly/event-types'),
  /** Partial write: replaces ONLY the config's `destinations` key server-side. */
  updateFormDestinations: (id: string, destinations: FormDestination[]) =>
    req<FormDetail>('PUT', `/v1/forms/${id}/destinations`, { destinations }),

  // Account-level integration connections (paste-token model; admin/owner writes)
  /** This account's connections (token-free) + whether server encryption is available. */
  listIntegrations: () => req<IntegrationsResponse>('GET', '/v1/integrations'),
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
