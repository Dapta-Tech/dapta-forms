import { getMessages } from '@quill/shared';
import { BrandMark } from '@/components/brand/brand';
import { signupHref } from '@/lib/growth';

/**
 * "Made with Dapta Forms" — the growth-loop attribution on every public
 * surface (R11). A discreet centered footer pill: semantic tokens only, so it
 * follows dark/light and any host branding without competing with it. Renders
 * only when the deployment configures NEXT_PUBLIC_SIGNUP_URL, and never when
 * NEXT_PUBLIC_HIDE_BADGE is set (open-core: forks aren't forced to carry
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
  const m = getMessages(locale).growth;
  return (
    <footer className="flex justify-center px-6 pb-8 pt-4">
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-primary hover:text-foreground"
      >
        {/* The product's own mark, not the parent Dapta D — the copy next to it
            reads "Made with Dapta Forms". Ink is currentColor, so it picks up the
            pill's muted foreground and stays legible on any host background. */}
        <BrandMark className="h-3.5 w-auto shrink-0" />
        <span>{m.madeWith}</span>
        <span className="sr-only">(opens in a new tab)</span>
      </a>
    </footer>
  );
}
