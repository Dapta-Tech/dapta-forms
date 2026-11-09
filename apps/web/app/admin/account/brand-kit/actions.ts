'use server';

import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { adminApi, ApiError, type AttributionStatus, type BrandKit } from '@/lib/admin-api';

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
 * write (403 `FORBIDDEN`); both come back as `{ ok: false, code }`.
 */
export async function saveAttributionAction(
  hideAttribution: boolean,
): Promise<BrandActionResult<AttributionStatus> & { code?: string }> {
  try {
    const value = await adminApi.setAttribution(hideAttribution);
    // The admin layout hands the setting (off `/v1/me`) to the previews that
    // draw a copy of the attribution, so the whole admin tree re-reads it.
    // The public pages are dynamic and read it per request.
    revalidatePath('/admin', 'layout');
    return { ok: true, value };
  } catch (e) {
    unstable_rethrow(e);
    return {
      ok: false,
      message: e instanceof ApiError ? e.message : undefined,
      code: e instanceof ApiError ? e.code : undefined,
    };
  }
}
