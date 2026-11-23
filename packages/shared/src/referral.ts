/**
 * Referral program: a person's referral link and the ways to share it.
 *
 * Pure and string-built (no URL/URLSearchParams), like `growth.ts`: this
 * package stays lib-ES2022-only. The API builds the link (it owns the switch
 * and the base URL), the web app builds the share links from it, and the
 * referral emails will reuse the same share links.
 */

/** Referrals a person needs for the referral unlock. */
export const REFERRAL_GOAL = 5;

/** The query parameter a referral link carries its code in. */
export const REFERRAL_QUERY_KEY = 'ref';

const HTTP_URL = /^https?:\/\/\S+$/i;

/**
 * Where referral links point: the landing when the deployment has one (it is
 * written for a stranger, like the growth badge's target), else the app. Null
 * when neither is an http(s) URL, and the program cannot run then.
 */
export function referralLinkBase(opts: { landingUrl?: string | null; appUrl?: string | null }): string | null {
  const landing = (opts.landingUrl ?? '').trim();
  if (HTTP_URL.test(landing)) return landing;
  const app = (opts.appUrl ?? '').trim();
  return HTTP_URL.test(app) ? app : null;
}

/**
 * A person's referral link: `<base>/?ref=<code>`. A bare origin gets its root
 * slash, a path is kept as written (a trailing slash survives), an existing
 * query is kept and a fragment dropped. Null without a usable base.
 */
export function buildReferralLink(base: string | null | undefined, code: string): string | null {
  const trimmed = (base ?? '').trim();
  if (!HTTP_URL.test(trimmed)) return null;
  const hashAt = trimmed.indexOf('#');
  let path = hashAt === -1 ? trimmed : trimmed.slice(0, hashAt);
  if (/^https?:\/\/[^/?#]+$/i.test(path)) path += '/';
  const pair = `${REFERRAL_QUERY_KEY}=${encodeURIComponent(code)}`;
  return `${path}${path.includes('?') ? '&' : '?'}${pair}`;
}

/** The channels a referral link can be shared through from the app. */
export type ReferralShareChannel = 'whatsapp' | 'email' | 'x';

/** The prefilled messages, in the reader's language. `{link}` is the referral link. */
export interface ReferralShareText {
  whatsapp: string;
  emailSubject: string;
  emailBody: string;
  x: string;
}

/** Fill `{link}` in a share message. */
export function fillReferralText(template: string, link: string): string {
  return template.split('{link}').join(link);
}

/**
 * One link per share channel, each opening the app or site with the message
 * already written: WhatsApp's click-to-chat, a `mailto:` with subject and
 * body, and X's post intent. X gets the link in `url` too, so it renders the
 * card and counts the characters right.
 */
export function referralShareLinks(link: string, text: ReferralShareText): Record<ReferralShareChannel, string> {
  const enc = encodeURIComponent;
  const x = fillReferralText(text.x, '').trim();
  return {
    whatsapp: `https://wa.me/?text=${enc(fillReferralText(text.whatsapp, link))}`,
    email: `mailto:?subject=${enc(text.emailSubject)}&body=${enc(fillReferralText(text.emailBody, link))}`,
    x: `https://x.com/intent/post?text=${enc(x)}&url=${enc(link)}`,
  };
}
