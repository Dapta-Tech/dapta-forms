import { FormsLockup, FormsMark, FormsWordmark } from './forms-logo';

/**
 * Brand surfaces, with the open-core gate applied once.
 *
 * The Dapta artwork may only render on a Dapta build. Dapta's pipeline injects
 * `NEXT_PUBLIC_PRODUCT_NAME="Dapta Forms"` at build time; a bare fork keeps the
 * default `Forms` (or its own name) and gets a neutral typographic brand built
 * from whatever it called the product. That is the same principle as
 * `MadeWithBadge`: a fork is never forced to carry Dapta branding.
 *
 * Call sites use `<BrandLockup>` / `<BrandMark>` and never the raw marks, so the
 * gate cannot be forgotten on a new surface.
 */

export const PRODUCT_NAME = process.env.NEXT_PUBLIC_PRODUCT_NAME || 'Forms';

/** True only on a build that identifies itself as Dapta's own. */
export const IS_DAPTA_BRAND = PRODUCT_NAME === 'Dapta Forms';

/**
 * Full wordmark. Roughly 6:1 — size it with a height class and let width follow
 * (`h-6 w-auto`), never the other way round.
 */
export function BrandLockup({ className, labelled }: { className?: string; labelled?: boolean }) {
  if (IS_DAPTA_BRAND) {
    return <FormsLockup className={className} title={labelled ? PRODUCT_NAME : undefined} />;
  }
  return (
    <span className="flex items-center gap-2">
      <FallbackChip />
      <span className="text-sm font-semibold text-foreground">{PRODUCT_NAME}</span>
    </span>
  );
}

/**
 * `Forms.` without the company name — the in-app default.
 *
 * At ~3:1 it carries roughly twice the letter height of the full lockup for the
 * same box, which is why the app chrome uses this and not `BrandLockup`: inside
 * the product the surrounding shell already establishes that this is Dapta, so
 * the wordmark only has to say which product. The full lockup is for the
 * entrances — sign-in and the public landing — where nothing else does.
 */
export function BrandWordmark({ className, labelled }: { className?: string; labelled?: boolean }) {
  if (IS_DAPTA_BRAND) {
    return <FormsWordmark className={className} title={labelled ? PRODUCT_NAME : undefined} />;
  }
  return (
    <span className="flex items-center gap-2">
      <FallbackChip />
      <span className="text-sm font-semibold text-foreground">{PRODUCT_NAME}</span>
    </span>
  );
}

/**
 * Mark only — for anywhere the lockup will not fit: the collapsed rail, the app
 * switcher tile, the attribution badge, narrow viewports.
 */
export function BrandMark({ className, labelled }: { className?: string; labelled?: boolean }) {
  if (IS_DAPTA_BRAND) {
    return <FormsMark className={className} title={labelled ? PRODUCT_NAME : undefined} />;
  }
  return <FallbackChip />;
}

/** The pre-logo placeholder, kept as the fork fallback rather than deleted. */
function FallbackChip() {
  return (
    <span className="rounded-md bg-primary px-2 py-0.5 text-sm font-semibold text-primary-foreground">
      {PRODUCT_NAME.charAt(0)}
    </span>
  );
}
