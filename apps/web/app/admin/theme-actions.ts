'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { THEME_COOKIE, isThemePref, type ThemePref } from '@/lib/theme';

/**
 * Persist the colour-scheme choice and re-render so the new scheme is server-sent.
 *
 * Revalidates the ROOT layout, not `/admin`: `data-theme` lives on `<html>`, which
 * only the root layout renders. Revalidating the admin layout would update the
 * page under the old attribute and leave the scheme unchanged until a hard reload.
 */
export async function setThemeAction(pref: ThemePref): Promise<void> {
  // Typed, and guarded anyway. A server action is a POST endpoint: the parameter
  // arrives over the wire and the compiler cannot vouch for it, so an unrecognised
  // value has to be REJECTED rather than folded into a default. It used to coerce
  // anything unknown to `dark` — a stale client bundle after a rename, or a typo,
  // silently flipped someone's pinned Light and revalidated the whole app with no
  // error anywhere to explain it. Ignoring the write leaves their choice intact.
  //
  // This is also what retires the removed `system` value with no migration: a
  // stale tab still posting it is ignored, and the cookie it already wrote reads
  // back as unrecognised, so `getThemePref` hands out the `dark` default.
  if (!isThemePref(pref)) return;
  const value: ThemePref = pref;
  const jar = await cookies();
  jar.set(THEME_COOKIE, value, {
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
    sameSite: 'lax',
  });
  revalidatePath('/', 'layout');
}
