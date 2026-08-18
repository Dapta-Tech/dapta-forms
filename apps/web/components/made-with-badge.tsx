import { getMessages } from '@quill/shared';
import { BrandMark } from '@/components/brand/brand';
import { signupHref } from '@/lib/growth';

/**
 * "Made with Dapta Forms" — the growth-loop attribution on every public surface (R11).
 *
 * The copy names the PRODUCT, and so does the mark: this is `BrandMark`, the
 * Forms `F`, never `PlatformMark`. A pill signs itself with the mark that
 * matches the name written beside it; the two halves used to argue (the F next
 * to "Powered by Dapta", then the d), and each swap was a release on its own.
 * Where it sends the reader is a deployment fact — `NEXT_PUBLIC_LANDING_URL`
 * with `NEXT_PUBLIC_SIGNUP_URL` as the opt-in — never a domain in this file
 * (see `signupHref`). Dapta's image points it at the Forms landing, so a
 * stranger who just answered someone's form lands on a page written for a
 * stranger, tagged `utm_medium=form-button`.
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
  const href = signupHref('form-button', accountCode);
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
        {/* The stem is currentColor, so it picks up the pill's foreground and
            stays legible on any host background; only the lime arms are literal.
            Unlabelled on purpose — the visible text right beside it already
            names the destination, so a title here would read it out twice. */}
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
