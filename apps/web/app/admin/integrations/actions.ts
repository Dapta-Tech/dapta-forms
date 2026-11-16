'use server';

import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import {
  adminApi,
  ApiError,
  type IntegrationProvider,
  type IntegrationStatus,
  type SalesforceConnectError,
} from '@/lib/admin-api';

/**
 * Account-level connection actions for the global connections surface
 * (/admin/integrations). The pasted token travels client → server action → API
 * and is never returned to the browser: `connect` echoes only the token-free
 * status (label + last4). `unstable_rethrow` lets a `req()` 401→redirect escape
 * the catch (a mid-session expiry bounces to /login instead of a dead toast).
 */

export type ConnectResult =
  | { ok: true; status: IntegrationStatus }
  | { ok: false; code?: string; message?: string };

export async function connectIntegrationAction(
  provider: IntegrationProvider,
  token: string,
): Promise<ConnectResult> {
  try {
    const status = await adminApi.connectIntegration(provider, token);
    revalidatePath('/admin/integrations');
    return { ok: true, status };
  } catch (e) {
    unstable_rethrow(e);
    if (e instanceof ApiError) return { ok: false, code: e.code, message: e.message };
    return { ok: false };
  }
}

/**
 * Connect Salesforce with the three Client Credentials values. The secret
 * travels client → server action → API like a pasted token, and only the
 * token-free status comes back. A refusal carries the API's reason, so the card
 * can say which of the three things the admin has to fix.
 */
export async function connectSalesforceAction(input: {
  domain: string;
  consumerKey: string;
  consumerSecret: string;
}): Promise<{ ok: true; status: IntegrationStatus } | { ok: false; reason?: SalesforceConnectError }> {
  try {
    const status = await adminApi.connectSalesforce(input);
    revalidatePath('/admin/integrations');
    return { ok: true, status };
  } catch (e) {
    unstable_rethrow(e);
    if (e instanceof ApiError) {
      const reason = e.body?.reason;
      return { ok: false, reason: typeof reason === 'string' ? (reason as SalesforceConnectError) : undefined };
    }
    return { ok: false };
  }
}

/**
 * Start the Google Sheets consent flow and hand back the URL to send the
 * browser to.
 *
 * The navigation stays with the client on purpose: the account this flow will
 * connect rides in a signed state minted by this call, so the URL has to be
 * followed exactly as returned. A `redirect()` from here would be followed by
 * the server action's own fetch rather than by the browser.
 */
export async function startGoogleSheetsAuthAction(): Promise<
  { ok: true; authUrl: string } | { ok: false; message?: string }
> {
  try {
    const { authUrl } = await adminApi.authorizeGoogleSheets();
    return { ok: true, authUrl };
  } catch (e) {
    unstable_rethrow(e);
    if (e instanceof ApiError) return { ok: false, message: e.message };
    return { ok: false };
  }
}

export async function disconnectIntegrationAction(
  provider: IntegrationProvider,
): Promise<{ ok: boolean; message?: string }> {
  try {
    await adminApi.disconnectIntegration(provider);
    revalidatePath('/admin/integrations');
    return { ok: true };
  } catch (e) {
    unstable_rethrow(e);
    if (e instanceof ApiError) return { ok: false, message: e.message };
    return { ok: false };
  }
}
