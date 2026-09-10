/**
 * Server-side public API client. The web app talks to the Quill API over HTTP
 * (never imports @quill/db or the engine directly) so the deployment stays
 * decoupled.
 */
import { cache } from 'react';
import type { PublicForm, PublicProfile, UploadPresignInput, UploadPresignResult } from '@quill/types';
import { serverApiUrl } from './api-url';
import { forwardedForHeader } from './forwarded-for';

const API_URL = serverApiUrl;

async function getJson<T>(path: string): Promise<T | null> {
  const res = await fetch(`${API_URL}${path}`, {
    cache: 'no-store',
    headers: await forwardedForHeader(),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`API ${path} failed: ${res.status}`);
  return (await res.json()) as T;
}

// cache(): generateMetadata and the page share one fetch per request.
export const getPublicForm = cache(
  (accountCode: string, slug: string): Promise<PublicForm | null> =>
    getJson<PublicForm>(
      `/v1/public/forms/${encodeURIComponent(accountCode)}/${encodeURIComponent(slug)}`,
    ),
);

/**
 * A member's public page, or null when they have not enabled one. A 404 is the
 * normal, expected answer here — most handles have no page — so it resolves to
 * null rather than throwing.
 */
export const getPublicProfile = cache(
  (accountCode: string, handle: string): Promise<PublicProfile | null> =>
    getJson<PublicProfile>(
      `/v1/public/profiles/${encodeURIComponent(accountCode)}/${encodeURIComponent(handle)}`,
    ),
);

export interface SubmitResult {
  ok: boolean;
  status: number;
  id?: string;
  score?: number;
  outcome?: string | null;
  message?: string;
}

/** Submit answers for a public form (partial or complete). */
export async function postSubmission(
  accountCode: string,
  slug: string,
  body: { sessionId: string; data: Record<string, unknown>; partial?: boolean; locale?: 'en' | 'es' },
): Promise<SubmitResult> {
  const res = await fetch(
    `${API_URL}/v1/public/forms/${encodeURIComponent(accountCode)}/${encodeURIComponent(slug)}/submissions`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(await forwardedForHeader()) },
      body: JSON.stringify(body),
      cache: 'no-store',
    },
  );
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (res.status === 201)
    return {
      ok: true,
      status: 201,
      id: json.id as string,
      score: json.score as number,
      outcome: (json.outcome as string | null) ?? null,
    };
  return { ok: false, status: res.status, message: (json.message as string) ?? 'Could not submit.' };
}

/** Record a funnel event (fire-and-forget from the client). */
export async function postFormEvent(
  accountCode: string,
  slug: string,
  body: { sessionId: string; type: string; stepIndex?: number | null; stepKey?: string | null },
): Promise<void> {
  await fetch(
    `${API_URL}/v1/public/forms/${encodeURIComponent(accountCode)}/${encodeURIComponent(slug)}/events`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(await forwardedForHeader()) },
      body: JSON.stringify(body),
      cache: 'no-store',
    },
  ).catch(() => undefined);
}

export type PresignResult =
  | { ok: true; upload: UploadPresignResult }
  | { ok: false; status: number; error: string; message: string };

/**
 * Ask the API to authorize one file upload.
 *
 * Server-side like every other call here, and for the same reason: it forwards
 * the visitor's own `X-Forwarded-For`, so the API's per-IP rate limit still
 * sees the visitor rather than this web server. A browser calling the API
 * directly would need the API's CORS allowlist to name every embed origin;
 * going through the server action keeps that surface at zero.
 */
export async function postUploadPresign(
  accountCode: string,
  slug: string,
  body: UploadPresignInput,
): Promise<PresignResult> {
  const res = await fetch(
    `${API_URL}/v1/public/forms/${encodeURIComponent(accountCode)}/${encodeURIComponent(slug)}/uploads`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(await forwardedForHeader()) },
      body: JSON.stringify(body),
      cache: 'no-store',
    },
  );
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (res.ok && typeof json.url === 'string') {
    return { ok: true, upload: json as unknown as UploadPresignResult };
  }
  return {
    ok: false,
    status: res.status,
    error: (json.error as string) ?? 'UPLOAD_FAILED',
    message: (json.message as string) ?? 'Could not upload that file.',
  };
}
