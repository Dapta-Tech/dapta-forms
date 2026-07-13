/**
 * Server-side admin API client. Every host call carries the current session's
 * identity: `Authorization: Bearer <jwt>` for the workos provider, `x-quill-email`
 * for the local dev provider. A `401` throws an ApiError the /admin gate turns
 * into a redirect to /login.
 */
import { redirect } from 'next/navigation';
import type { FormConfig } from '@quill/types';
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
  config: FormConfig;
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

export const isAdminRole = (role: AccountRole): boolean => role === 'owner' || role === 'admin';

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
  deleteForm: (id: string) => req<void>('DELETE', `/v1/forms/${id}`),
  listSubmissions: (id: string) => req<Submission[]>('GET', `/v1/forms/${id}/submissions`),

  // Members (workspace roster — admin/owner only)
  listMembers: () => req<AccountMember[]>('GET', '/v1/members'),
  inviteMember: (b: { email: string; role?: 'admin' | 'member' }) =>
    req<AccountMember>('POST', '/v1/members', b),
  updateMember: (id: string, b: { role?: AccountRole; status?: MemberStatus }) =>
    req<AccountMember>('PATCH', `/v1/members/${id}`, b),
  removeMember: (id: string) => req<{ ok: boolean }>('DELETE', `/v1/members/${id}`),
};
