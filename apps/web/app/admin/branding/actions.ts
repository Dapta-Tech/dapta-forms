'use server';

import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { adminApi, ApiError, type BrandKit } from '@/lib/admin-api';

/**
 * Brand-kit actions (/admin/branding). Apply/revert rewrite form configs, so
 * every mutation revalidates the surfaces that render form branding state.
 */

export type BrandActionResult<T = undefined> =
  | { ok: true; value: T }
  | { ok: false; message?: string };

function revalidateBrandSurfaces(): void {
  revalidatePath('/admin/branding');
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
