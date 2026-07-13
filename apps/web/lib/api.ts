/**
 * Server-side API client. The web app talks to the Slate API over HTTP (never
 * imports @slate/db or the engine directly) so the deployment stays decoupled.
 */
import { cache } from 'react';
import type { AvailabilityResponse, BookingView, PublicProfile } from '@slate/types';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

async function getJson<T>(path: string): Promise<T | null> {
  const res = await fetch(`${API_URL}${path}`, { cache: 'no-store' });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`API ${path} failed: ${res.status}`);
  return (await res.json()) as T;
}

// cache(): generateMetadata and the page share one profile fetch per request.
export const getProfile = cache(
  (accountCode: string, handle: string): Promise<PublicProfile | null> =>
    getJson<PublicProfile>(
      `/v1/profiles/${encodeURIComponent(accountCode)}/${encodeURIComponent(handle)}`,
    ),
);

export interface TeamProfile {
  account: { code: string; name: string };
  team: { slug: string; name: string; logoUrl: string | null; timeZone: string };
  eventTypes: Array<{ slug: string; title: string; description: string | null; lengthMinutes: number }>;
}

// cache(): generateMetadata and the page share one team-profile fetch per request.
export const getTeamProfile = cache(
  (accountCode: string, teamSlug: string): Promise<TeamProfile | null> =>
    getJson<TeamProfile>(
      `/v1/public/teams/${encodeURIComponent(accountCode)}/${encodeURIComponent(teamSlug)}`,
    ),
);

export function getTeamAvailability(params: {
  accountCode: string;
  teamSlug: string;
  slug: string;
  from: string;
  to: string;
}): Promise<AvailabilityResponse | null> {
  const qs = new URLSearchParams({ slug: params.slug, from: params.from, to: params.to });
  return getJson<AvailabilityResponse>(
    `/v1/public/teams/${encodeURIComponent(params.accountCode)}/${encodeURIComponent(params.teamSlug)}/availability?${qs}`,
  );
}

export async function postTeamBooking(
  accountCode: string,
  teamSlug: string,
  body: unknown,
): Promise<BookResult> {
  const res = await fetch(
    `${API_URL}/v1/public/teams/${encodeURIComponent(accountCode)}/${encodeURIComponent(teamSlug)}/bookings`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
    },
  );
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (res.status === 201) return { ok: true, status: 201, booking: json as unknown as BookingView };
  return { ok: false, status: res.status, error: (json.error as string) ?? 'ERROR', message: (json.message as string) ?? 'Failed' };
}

export function getAvailability(params: {
  accountCode: string;
  handle: string;
  slug: string;
  from: string;
  to: string;
  timeZone?: string;
}): Promise<AvailabilityResponse | null> {
  const qs = new URLSearchParams({
    accountCode: params.accountCode,
    handle: params.handle,
    slug: params.slug,
    from: params.from,
    to: params.to,
  });
  if (params.timeZone) qs.set('timeZone', params.timeZone);
  return getJson<AvailabilityResponse>(`/v1/availability?${qs.toString()}`);
}

export interface BookResult {
  ok: boolean;
  /** The HTTP status — surfaced so the UI can handle 409 (taken) / 410 (expired). */
  status: number;
  booking?: BookingView;
  error?: string;
  message?: string;
}

export interface ReserveResult {
  ok: boolean;
  status: number;
  reservationUid?: string;
  expiresAt?: string;
  message?: string;
}

/** Create a soft hold on a slot (public reserve→confirm two-step). */
export async function postReservation(body: {
  accountCode: string;
  handle: string;
  slug: string;
  startUtc: string;
}): Promise<ReserveResult> {
  const res = await fetch(`${API_URL}/v1/reservations`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (res.status === 201)
    return {
      ok: true,
      status: 201,
      reservationUid: json.reservationUid as string,
      expiresAt: json.expiresAt as string,
    };
  return { ok: false, status: res.status, message: (json.message as string) ?? 'Could not hold the time.' };
}

export function getManageView(uid: string, token: string): Promise<BookingView | null> {
  return getJson<BookingView>(`/v1/bookings/${encodeURIComponent(uid)}?token=${encodeURIComponent(token)}`);
}

export async function postManage(
  uid: string,
  token: string,
  action: 'cancel' | 'reschedule',
  body: Record<string, unknown>,
): Promise<{ ok: boolean; message?: string; manageUrl?: string }> {
  const res = await fetch(
    `${API_URL}/v1/bookings/${encodeURIComponent(uid)}/${action}?token=${encodeURIComponent(token)}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
    },
  );
  if (res.ok) {
    // A real reschedule ROTATES the manage token (single-active-token invariant),
    // so the token just used is now dead. Surface the fresh manageUrl so the
    // client can adopt the new token for any further cancel/reschedule.
    const j = (await res.json().catch(() => ({}))) as { manageUrl?: string };
    return { ok: true, manageUrl: j.manageUrl };
  }
  const j = (await res.json().catch(() => ({}))) as { message?: string };
  return { ok: false, message: j.message ?? 'Something went wrong.' };
}

export async function postBooking(body: unknown): Promise<BookResult> {
  const res = await fetch(`${API_URL}/v1/bookings`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (res.status === 201) return { ok: true, status: 201, booking: json as unknown as BookingView };
  return {
    ok: false,
    status: res.status,
    error: (json.error as string) ?? 'ERROR',
    message: (json.message as string) ?? 'Something went wrong.',
  };
}
