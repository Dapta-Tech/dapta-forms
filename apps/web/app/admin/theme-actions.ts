'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { THEME_COOKIE, type ThemePref } from '@/lib/theme';

/**
 * Persist the colour-scheme choice and re-render so the new scheme is server-sent.
 *
 * Revalidates the ROOT layout, not `/admin`: `data-theme` lives on `<html>`, which
 * only the root layout renders. Revalidating the admin layout would update the
 * page under the old attribute and leave the scheme unchanged until a hard reload.
 */
export async function setThemeAction(pref: string): Promise<void> {
  const value: ThemePref = pref === 'light' ? 'light' : pref === 'system' ? 'system' : 'dark';
  const jar = await cookies();
  jar.set(THEME_COOKIE, value, {
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
    sameSite: 'lax',
  });
  revalidatePath('/', 'layout');
}
