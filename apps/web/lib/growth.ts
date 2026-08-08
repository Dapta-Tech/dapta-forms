/**
 * Growth-loop env binding — the only place the web app reads the badge/CTA
 * configuration. Pure logic lives in @quill/shared (tested there).
 *
 * Like the app-switcher's platform URL, the destination comes only from the
 * deployment: NEXT_PUBLIC_SIGNUP_URL unset → no badge, no CTA (a bare fork
 * carries no Dapta branding); NEXT_PUBLIC_HIDE_BADGE turns them off even when
 * a destination is configured.
 *
 * NEXT_PUBLIC_* are referenced as full static property accesses so Next can
 * inline them into the client bundle too (the confirmation CTA lives in the
 * FormRenderer client island).
 */
import { badgeHidden, buildSignupUrl, growthTarget, type SignupMedium } from '@quill/shared';

/**
 * Growth destination + UTM tags, or null when the loop is off.
 *
 * NEXT_PUBLIC_SIGNUP_URL still decides WHETHER the surfaces render (the
 * open-core opt-in), while NEXT_PUBLIC_LANDING_URL decides WHERE they go — see
 * `growthTarget`. Both are read as full static property accesses so Next can
 * inline them into the client bundle: the badge and the confirmation CTA both
 * live inside the renderer's client island.
 */
export function signupHref(medium: SignupMedium, accountCode?: string | null): string | null {
  if (badgeHidden(process.env.NEXT_PUBLIC_HIDE_BADGE)) return null;
  const baseUrl = growthTarget({
    signupUrl: process.env.NEXT_PUBLIC_SIGNUP_URL,
    landingUrl: process.env.NEXT_PUBLIC_LANDING_URL,
  });
  return buildSignupUrl({ baseUrl, medium, accountCode });
}
