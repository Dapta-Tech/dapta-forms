'use server';

import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { adminApi, ApiError, type AttributionStatus, type BrandKit } from '@/lib/admin-api';
import { DAPTA_SUBSCRIPTION_REQUIRED } from './attribution-codes';

/**
 * Brand-kit actions (/admin/account/brand-kit). Apply/revert rewrite form
 * configs, so every mutation revalidates the surfaces that render form
 * branding state.
 */

export type BrandActionResult<T = undefined> =
  | { ok: true; value: T }
  | { ok: false; message?: string };

function revalidateBrandSurfaces(): void {
  revalidatePath('/admin/account/brand-kit');
  revalidatePath('/admin');
  revalidatePath('/admin/forms');
}

export async function saveBrandKitAction(
  config: BrandKit,
): Promise<BrandActionResult<{ updatedAt: number | null }>> {
  try {
    const res = await adminApi.saveBranding(config);
    revalidateBrandSurfaces();
    return { ok: true, value: { updatedAt: res.updatedAt } };
  } catch (e) {
    unstable_rethrow(e);
    return { ok: false, message: e instanceof ApiError ? e.message : undefined };
  }
}

export async function applyBrandKitAction(
  formIds: string[],
): Promise<BrandActionResult<{ applied: string[] }>> {
  try {
    const res = await adminApi.applyBranding(formIds);
    revalidateBrandSurfaces();
    return { ok: true, value: res };
  } catch (e) {
    unstable_rethrow(e);
    return { ok: false, message: e instanceof ApiError ? e.message : undefined };
  }
}

export async function revertBrandKitAction(
  formIds: string[],
): Promise<BrandActionResult<{ reverted: string[] }>> {
  try {
    const res = await adminApi.revertBranding(formIds);
    revalidateBrandSurfaces();
    return { ok: true, value: res };
  } catch (e) {
    unstable_rethrow(e);
    return { ok: false, message: e instanceof ApiError ? e.message : undefined };
  }
}

/**
 * The "Made with dForms" switch (Brand kit). The API refuses turning it off
 * without a paid verdict (403 `DAPTA_SUBSCRIPTION_REQUIRED`) and a member's
 * write (403 `FORBIDDEN`); both come back as `{ ok: false, code }`. On the
 * first, the row's state as the server now sees it rides along as `status`
 * (the verdict may have lapsed since the page loaded), so the row can show
 * the truth instead of the stale switch.
 */
export async function saveAttributionAction(
  hideAttribution: boolean,
): Promise<BrandActionResult<AttributionStatus> & { code?: string; status?: AttributionStatus }> {
  try {
    const value = await adminApi.setAttribution(hideAttribution);
    // The admin layout hands the setting (off `/v1/me`) to the previews that
    // draw a copy of the attribution, so the whole admin tree re-reads it.
    // The public pages are dynamic and read it per request.
    revalidatePath('/admin', 'layout');
    return { ok: true, value };
  } catch (e) {
    unstable_rethrow(e);
    const code = e instanceof ApiError ? e.code : undefined;
    let status: AttributionStatus | undefined;
    if (code === DAPTA_SUBSCRIPTION_REQUIRED) {
      // Best effort: without it the row still knows the verdict is not paid.
      status = await adminApi.attributionStatus().catch((err: unknown) => {
        unstable_rethrow(err);
        return undefined;
      });
    }
    return {
      ok: false,
      message: e instanceof ApiError ? e.message : undefined,
      code,
      ...(status ? { status } : {}),
    };
  }
}
