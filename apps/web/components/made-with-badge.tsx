import { getMessages } from '@quill/shared';
import { BrandMark } from '@/components/brand/brand';
import { signupHref } from '@/lib/growth';

/**
 * "Powered by Dapta" — the growth-loop attribution on every public surface (R11).
 *
 * The copy names the PLATFORM, not the product: a respondent who has just filled
 * a form is a warmer lead for Dapta than for Dapta Forms, and the badge's whole
 * job is to send them somewhere. Where it sends them is `NEXT_PUBLIC_SIGNUP_URL`
 * — never a domain in this file (see `signupHref`).
 *
 * It is FORM CHROME, not a document footer. It used to render as a `<footer>`
 * AFTER the renderer in `page.tsx`, and `.pf` carries `min-height: 100dvh` —
 * so it began exactly where the first full viewport ended: below the fold on
 * every slides form, past the entire scroll on a vertical one. Effectively
 * unreachable. The renderers now place it themselves (cover footer · end of
 * `.pf__main` · end of the vertical page) so it participates in the `.pf`
 * layout and is on screen from the first paint.
 *
 * Its look lives in `public-form.css` (`.pf__attribution*`) like every other
 * rule on this surface — semantic tokens only, so it follows dark/light and any
 * host branding without competing with it. Note `.pf__badge` is the cover
 * EYEBROW; this block is `.pf__attribution`.
 *
 * Renders only when the deployment configures NEXT_PUBLIC_SIGNUP_URL, and never
 * when NEXT_PUBLIC_HIDE_BADGE is set (open-core: forks aren't forced to carry
 * Dapta branding).
 */
export function MadeWithBadge({
  locale = 'en',
  accountCode,
}: {
  locale?: string;
  accountCode?: string | null;
}) {
  const href = signupHref('badge', accountCode);
  if (!href) return null;
  const m = getMessages(locale);
  return (
    <div className="pf__attribution">
      <a
        className="pf__attribution-link"
        href={href}
        target="_blank"
        rel="noopener noreferrer"
      >
        {/* Ink is currentColor, so the mark picks up the pill's foreground and
            stays legible on any host background. */}
        <BrandMark className="pf__attribution-mark" />
        <span>{m.growth.madeWith}</span>
        {/* Localized, like every other string on this surface — this used to be
            a hardcoded English "(opens in a new tab)". Same catalog key the
            thank-you CTA uses (`renderer-shared.tsx`). */}
        <span className="sr-only"> {m.renderer.newTab}</span>
      </a>
    </div>
  );
}
