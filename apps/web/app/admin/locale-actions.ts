'use server';

import { cookies } from 'next/headers';
import { unstable_rethrow } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import type { Locale } from '@quill/shared';
import { adminApi } from '@/lib/admin-api';
import { LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE } from '@/lib/locale';

/**
 * Persist the language this person reads the product in.
 *
 * Two stores, deliberately, and the ORDER between them is the contract:
 *
 *   1. the member row, via the API. The durable copy. It survives a new browser
 *      and it is what `email-effects` reads to decide whether the account's
 *      submission notices go out in English or Spanish.
 *   2. the cookie. What every admin page actually renders from, so no page pays
 *      for a round trip and there is nothing to correct after hydration.
 *
 * The row is written FIRST and the cookie only if that succeeded. Writing the
 * cookie first would be the friendlier-looking order and the wrong one: the app
 * would flip to Spanish while the stored preference stayed English, so the next
 * browser and every notification email would silently disagree with the
 * language on screen, and nothing would ever say so. Failing before the cookie
 * keeps the visible state and the saved state the same thing, and the caller
 * gets an `ok: false` to put on screen.
 */
export async function setLocaleAction(locale: Locale): Promise<{ ok: boolean }> {
  const value: Locale = locale === 'es' ? 'es' : 'en';
  try {
    await adminApi.setMyLocale(value);
  } catch (e) {
    unstable_rethrow(e);
    return { ok: false };
  }

  const jar = await cookies();
  jar.set(LOCALE_COOKIE, value, {
    path: '/',
    maxAge: LOCALE_COOKIE_MAX_AGE,
    sameSite: 'lax',
  });
  // Every admin page reads the cookie at render time, so the whole tree is stale
  // now, not just this route.
  revalidatePath('/admin', 'layout');
  return { ok: true };
}
