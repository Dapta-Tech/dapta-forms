import type { EmailCtaResolver } from '@quill/notifications';
import { badgeHidden, buildSignupUrl, getMessages, growthTarget } from '@quill/shared';
import type { ServerEnv } from '@quill/config/env';

/**
 * The "try dForms" button under the notification emails, by the web badge's
 * rule (`apps/web/lib/growth.ts`): the signup URL switches it on, the landing
 * URL (when set) is where it points, the hide flag switches it off. A bare fork
 * sets none of them, so its emails carry no dForms button. The copy is the
 * shared catalog's, in the email's own language, and the link is tagged with
 * which email it sat in (`utm_medium=email-receipt | email-notice`).
 */
export function emailGrowthCta(
  env: Pick<ServerEnv, 'NEXT_PUBLIC_SIGNUP_URL' | 'NEXT_PUBLIC_LANDING_URL' | 'NEXT_PUBLIC_HIDE_BADGE'>,
): EmailCtaResolver {
  return ({ locale, medium }) => {
    if (badgeHidden(env.NEXT_PUBLIC_HIDE_BADGE)) return null;
    const baseUrl = growthTarget({ signupUrl: env.NEXT_PUBLIC_SIGNUP_URL, landingUrl: env.NEXT_PUBLIC_LANDING_URL });
    const href = buildSignupUrl({ baseUrl, medium });
    if (!href) return null;
    const m = getMessages(locale);
    return { question: m.growth.ctaQuestion, action: m.growth.emailCtaAction, href };
  };
}
