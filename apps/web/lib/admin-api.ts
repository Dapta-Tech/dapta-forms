/**
 * Server-side admin API client. Every host call carries the current session's
 * identity (AUTH-WEB-CONTRACT §1): `Authorization: Bearer <jwt>` for the workos
 * provider, `x-slate-email` for the local dev provider. The API reads whichever
 * its configured provider expects and ignores the other. A `401` throws an
 * ApiError the /admin gate turns into a redirect to /login.
 */
import { redirect } from 'next/navigation';
import { getSession, clearSession, authProvider } from './auth-session';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

/** An API error that carries the HTTP status + error code so callers can drive
 *  status-specific UX (409 slot-taken, 410 gone, 400 validation, …). */
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
  else if (session?.provider === 'local') headers['x-slate-email'] = session.email;

  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: Object.keys(headers).length ? headers : undefined,
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  });
  if (res.status === 401) {
    // Global 401 guard (AUTH-WEB-CONTRACT §4): the session is invalid → clear it
    // (best-effort: allowed in an action, a no-op during render) and bounce to
    // login. In an action, wrap the caller's catch with `unstable_rethrow` so
    // this redirect isn't swallowed.
    try {
      await clearSession();
    } catch {
      /* cookies are immutable during render — the redirect still fires */
    }
    redirect(authProvider() === 'workos' ? '/api/auth/logout' : '/login');
  }
  if (!res.ok) {
    const j = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
    // Surface the HTTP status (was discarded) so the UI can handle 409/410/400.
    throw new ApiError(res.status, j.message ?? j.error ?? `${method} ${path} → ${res.status}`, j.error);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json().catch(() => ({}))) as T;
}

export interface Me {
  accountId: string;
  /** The CANONICAL public code (vanity slug when claimed, else the short code). */
  accountCode: string;
  /** The immutable short code — a permanent alias while a vanity is set. */
  accountShortCode: string;
  vanitySlug: string | null;
  memberId: string;
  handle: string | null;
  displayName: string | null;
  email: string | null;
  timeZone: string | null;
  locale: string | null;
  /** Account-level role + status — the FE gates admin-only surfaces on these. */
  role: AccountRole;
  status: MemberStatus;
}

export type AccountRole = 'owner' | 'admin' | 'member';
export type MemberStatus = 'active' | 'invited' | 'disabled';

/** A workspace member as returned by the (admin-only) roster endpoint. */
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

/** True when the role may administer the workspace (manage members, settings). */
export const isAdminRole = (role: AccountRole): boolean => role === 'owner' || role === 'admin';
export const adminApi = {
  me: () => req<Me>('GET', '/v1/me'),
  // Vanity account slug (premium — included with the Dapta AI subscription).
  vanityStatus: () =>
    req<{ vanitySlug: string | null; shortCode: string; canClaim: boolean }>(
      'GET',
      '/v1/account/vanity',
    ),
  handleAvailable: (handle: string) =>
    req<{ handle: string; available: boolean; reason: string | null; suggestion?: string }>(
      'GET',
      `/v1/handle-available?handle=${encodeURIComponent(handle)}`,
    ),

  // Event types
  listEventTypes: () => req<EventType[]>('GET', '/v1/event-types'),
  getEventType: (id: string) => req<EventType>('GET', `/v1/event-types/${id}`),
  createEventType: (b: unknown) => req<EventType>('POST', '/v1/event-types', b),
  updateEventType: (id: string, b: unknown) => req<EventType>('PATCH', `/v1/event-types/${id}`, b),
  deleteEventType: (id: string) => req<void>('DELETE', `/v1/event-types/${id}`),

  // Schedules
  listSchedules: () => req<{ id: string; name: string; timeZone: string }[]>('GET', '/v1/schedules'),
  getSchedule: (id: string) => req<Schedule>('GET', `/v1/schedules/${id}`),
  createSchedule: (b: unknown) => req<Schedule>('POST', '/v1/schedules', b),
  updateSchedule: (id: string, b: unknown) => req<Schedule>('PATCH', `/v1/schedules/${id}`, b),
  deleteSchedule: (id: string) => req<void>('DELETE', `/v1/schedules/${id}`),

  // Teams
  listTeams: () => req<Team[]>('GET', '/v1/teams'),
  createTeam: (b: unknown) => req<Team>('POST', '/v1/teams', b),
  updateTeam: (id: string, b: unknown) => req<Team>('PATCH', `/v1/teams/${id}`, b),
  deleteTeam: (id: string) => req<{ id: string }>('DELETE', `/v1/teams/${id}`),
  teamMembers: (id: string) =>
    req<{ member_id: string; role: string; display_name: string | null; email: string | null }[]>(
      'GET',
      `/v1/teams/${id}/members`,
    ),
  addTeamMember: (id: string, b: unknown) => req('POST', `/v1/teams/${id}/members`, b),
  updateTeamMemberRole: (id: string, memberId: string, role: 'owner' | 'member') =>
    req('PATCH', `/v1/teams/${id}/members/${memberId}`, { role }),
  removeTeamMember: (id: string, memberId: string) =>
    req<void>('DELETE', `/v1/teams/${id}/members/${memberId}`),
  teamEventTypes: (id: string) => req<EventType[]>('GET', `/v1/teams/${id}/event-types`),

  // Members (workspace roster — admin/owner only)
  listMembers: () => req<AccountMember[]>('GET', '/v1/members'),
  inviteMember: (b: { email: string; role?: 'admin' | 'member' }) =>
    req<AccountMember>('POST', '/v1/members', b),
  updateMember: (id: string, b: { role?: AccountRole; status?: MemberStatus }) =>
    req<AccountMember>('PATCH', `/v1/members/${id}`, b),
  removeMember: (id: string) => req<{ ok: boolean }>('DELETE', `/v1/members/${id}`),

  // Bookings (host)
  listBookings: (q = '') =>
    req<{ items: BookingItem[] }>('GET', `/v1/host/bookings${q ? `?${q}` : ''}`),

  // Connections
  listConnections: () => req<Connection[]>('GET', '/v1/connections'),
  createConnection: (b: unknown) => req('POST', '/v1/connections', b),
  connectionToken: (provider?: string) =>
    req<{ enabled: boolean; token: string | null; connectUrl: string | null; message: string }>(
      'POST',
      '/v1/connections/token',
      { provider },
    ),
  discoverConnections: (provider: string) =>
    req<Connection[]>('POST', '/v1/connections/discover', { provider }),
  listConnectionCalendars: (id: string) =>
    req<CalendarSummary[]>('GET', `/v1/connections/${id}/calendars`),
  updateConnection: (id: string, b: unknown) => req('PATCH', `/v1/connections/${id}`, b),
  pingConnection: (id: string) =>
    req<{ ok: boolean; enabled: boolean; message: string }>('POST', `/v1/connections/${id}/ping`, {}),
  deleteConnection: (id: string) => req<void>('DELETE', `/v1/connections/${id}`),

  // API keys
  listApiKeys: () => req<ApiKeyRow[]>('GET', '/v1/api-keys'),
  createApiKey: (b: unknown) => req<{ plaintext: string; prefix: string }>('POST', '/v1/api-keys', b),
  revokeApiKey: (id: string) => req<void>('DELETE', `/v1/api-keys/${id}`),

  // Webhooks
  listWebhooks: () => req<WebhookRow[]>('GET', '/v1/webhooks'),
  createWebhook: (b: unknown) => req('POST', '/v1/webhooks', b),
  updateWebhook: (id: string, active: boolean) => req('PATCH', `/v1/webhooks/${id}`, { active }),
  pingWebhook: (id: string) =>
    req<{ ok: boolean; status?: number; message?: string }>('POST', `/v1/webhooks/${id}/ping`, {}),
  deleteWebhook: (id: string) => req<void>('DELETE', `/v1/webhooks/${id}`),

  // Branding
  profile: (code: string, handle: string) => req<Profile>('GET', `/v1/profiles/${code}/${handle}`),
  updateBranding: (b: unknown) => req('PATCH', '/v1/booking-page', b),
};

export interface EventType {
  id: string;
  memberId: string | null;
  teamId: string | null;
  slug: string;
  title: string;
  description: string | null;
  lengthMinutes: number;
  location: string | null;
  hidden: boolean;
  schedulingType: string | null;
  requiresConfirmation: boolean;
  seatsPerTimeSlot: number | null;
  bookingFields: unknown[];
  hostMemberIds: string[];
  hosts?: Array<{ memberId: string; priority: number | null; weight: number | null; isFixed: boolean }>;
  scheduleId: string | null;
}
export interface Schedule {
  id: string;
  memberId: string;
  name: string;
  timeZone: string;
  rules: Array<{ id: string; days: number[] | null; startTime: string; endTime: string; date: string | null }>;
}
export interface Team {
  id: string;
  name: string;
  slug: string | null;
  bio: string | null;
  logoUrl: string | null;
  timeZone: string;
  hideBranding: boolean;
}
export interface BookingItem {
  uid: string;
  status: string;
  title: string;
  startUtc: string;
  endUtc: string;
  hostMemberId: string | null;
}
export interface Connection {
  id: string;
  provider: string;
  externalId: string;
  primaryEmail: string | null;
  isDestination: boolean;
  checkConflicts: boolean;
  /** Persisted health from the last probe; null lastCheckAt = never checked. */
  lastCheckAt: number | null;
  lastCheckOk: boolean | null;
  lastCheckDetail: string | null;
}
export interface CalendarSummary {
  id: string;
  name: string;
  primaryEmail: string | null;
  isPrimary?: boolean;
}
export interface ApiKeyRow {
  id: string;
  name: string;
  prefix: string;
  last4: string;
  revoked_at_ms: number | null;
}
export interface WebhookRow {
  id: string;
  subscriber_url: string;
  event_triggers: unknown;
  active: number;
}
export interface Profile {
  account: { code: string; name: string };
  member: {
    handle: string;
    displayName: string | null;
    avatarUrl: string | null;
    coverUrl: string | null;
    brandColor: string | null;
    style: Record<string, unknown> | null;
  };
  eventTypes: Array<{ slug: string; title: string; lengthMinutes: number }>;
}
