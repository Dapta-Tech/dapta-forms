'use client';

import { useCallback, useRef, useState } from 'react';
import { BrandMark } from '@/components/brand/brand';
import { AnchoredMenu } from '@/components/ui/anchored-menu';

/**
 * App-switcher — the discreet door to the wider Dapta suite (design-parity with
 * Dapta Calendars). An Atlassian-style grid affordance next to the product
 * wordmark that opens a small menu:
 *   • Dapta AI (→ platform, new tab)  • Dapta Calendars (new tab)  • Forms (current)
 *
 * Growth-loop only — hidden entirely when NEITHER suite URL is configured
 * (white-label / self-host builds), so the switcher never dead-ends on a lone
 * "current" row. Tokens only; WAI-ARIA menu-button pattern (Escape / outside
 * click dismiss, focus first item on open).
 */

interface SwitcherMessages {
  trigger: string;
  menuLabel: string;
  eyebrow: string;
  dapta: string;
  calendars: string;
  opensNewTab: string;
}

const PRODUCT_NAME = process.env.NEXT_PUBLIC_PRODUCT_NAME || 'Forms';
const PLATFORM_URL = process.env.NEXT_PUBLIC_PLATFORM_URL || '';
const CALENDARS_URL = process.env.NEXT_PUBLIC_CALENDARS_URL || '';

/** A suite URL carrying app-switcher UTM tags (best-effort). */
function suiteHref(base: string): string {
  try {
    const url = new URL(base);
    url.searchParams.set('utm_source', 'forms');
    url.searchParams.set('utm_medium', 'app_switcher');
    return url.toString();
  } catch {
    return base;
  }
}

export function AppSwitcher({ messages: m }: { messages: SwitcherMessages }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);

  // No sibling product configured → the switcher would only show "current"; hide it.
  const hasSuite = PLATFORM_URL.length > 0 || CALENDARS_URL.length > 0;

  if (!hasSuite) return null;

  return (
    <>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={m.trigger}
        title={m.trigger}
        ref={triggerRef}
        data-testid="app-switcher-trigger"
        onClick={() => setOpen((o) => !o)}
        className="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:scale-[0.98]"
      >
        <i aria-hidden className="pi pi-th-large" style={{ fontSize: 18 }} />
      </button>

      {/* Portalled to document.body — inside the rail it is both clipped by the
          rail's overflow and buried under `<main>`'s stacking context. */}
      <AnchoredMenu
        anchorRef={triggerRef}
        open={open}
        onClose={close}
        label={m.menuLabel}
        width={240}
        autoFocus
        className="p-1.5"
        testId="app-switcher-menu"
      >
        <p className="px-2 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {m.eyebrow}
        </p>

        {/* Dapta AI — the platform (external, new tab). First, per Felipe. */}
        {PLATFORM_URL ? (
          <a
            role="menuitem"
            tabIndex={-1}
            href={suiteHref(PLATFORM_URL)}
            target="_blank"
            rel="noopener noreferrer"
            onClick={close}
            className="flex items-center gap-2.5 rounded-sm px-2 py-2 text-sm transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            <img
              src="/dapta-mark.png"
              alt=""
              width={24}
              height={24}
              className="h-6 w-6 shrink-0 rounded-md object-contain"
            />
            <span className="flex-1 truncate">{m.dapta}</span>
            <i aria-hidden className="pi pi-external-link text-muted-foreground" style={{ fontSize: 13 }} />
            <span className="sr-only">{m.opensNewTab}</span>
          </a>
        ) : null}

        {/* Dapta Calendars — the sibling sidecar (external, new tab). */}
        {CALENDARS_URL ? (
          <a
            role="menuitem"
            tabIndex={-1}
            href={suiteHref(CALENDARS_URL)}
            target="_blank"
            rel="noopener noreferrer"
            onClick={close}
            className="flex items-center gap-2.5 rounded-sm px-2 py-2 text-sm transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            <span
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-secondary text-xs font-semibold text-secondary-foreground"
              aria-hidden
            >
              <i className="pi pi-calendar" style={{ fontSize: 13 }} />
            </span>
            <span className="flex-1 truncate">{m.calendars}</span>
            <i aria-hidden className="pi pi-external-link text-muted-foreground" style={{ fontSize: 13 }} />
            <span className="sr-only">{m.opensNewTab}</span>
          </a>
        ) : null}

        {/* Current product */}
        <span
          role="menuitem"
          tabIndex={-1}
          aria-current="true"
          className="flex items-center gap-2.5 rounded-sm bg-muted px-2 py-2 text-sm font-medium"
        >
          {/* A 24px tile, matching the two sibling rows above — the row already
              carries bg-muted as the current-item highlight, so the tile takes
              the plain background to stay legible against it. */}
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-background">
            <BrandMark className="h-3.5 w-auto text-foreground" />
          </span>
          <span className="flex-1 truncate">{PRODUCT_NAME}</span>
          <i aria-hidden className="pi pi-check text-primary" style={{ fontSize: 14 }} />
        </span>
      </AnchoredMenu>
    </>
  );
}
