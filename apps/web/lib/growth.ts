/**
 * Growth-loop env binding — the only place the web app reads the badge/CTA
 * configuration. Pure logic lives in @slate/shared (tested there).
 *
 * Like the app-switcher's platform URL, the destination comes only from the
 * deployment: NEXT_PUBLIC_SIGNUP_URL unset → no badge, no CTA (a bare fork
 * carries no Dapta branding); NEXT_PUBLIC_HIDE_BADGE turns them off even when
 * a destination is configured.
 *
 * NEXT_PUBLIC_* are referenced as full static property accesses so Next can
 * inline them into the client bundle too (the confirmation CTA lives in the
 * BookingFlow client island).
 */
import { badgeHidden, buildSignupUrl, type SignupMedium } from '@slate/shared';

/** Signup destination + UTM tags, or null when the growth loop is off. */
export function signupHref(medium: SignupMedium, accountCode?: string | null): string | null {
  if (badgeHidden(process.env.NEXT_PUBLIC_HIDE_BADGE)) return null;
  return buildSignupUrl({ baseUrl: process.env.NEXT_PUBLIC_SIGNUP_URL, medium, accountCode });
}
