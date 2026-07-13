'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { LOCALE_COOKIE } from '@/lib/locale';

/** Persist the admin-UI language and re-render every admin route in the new locale. */
export async function setLocaleAction(locale: string): Promise<void> {
  const value = locale === 'es' ? 'es' : 'en';
  const jar = await cookies();
  jar.set(LOCALE_COOKIE, value, {
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
    sameSite: 'lax',
  });
  revalidatePath('/admin', 'layout');
}
