'use client';

import { useCallback, useRef, useState } from 'react';
import { BrandMark } from '@/components/brand/brand';
import { AnchoredMenu } from '@/components/ui/anchored-menu';
import { CALENDARS_URL, PLATFORM_URL, suiteHref } from '@/lib/suite';

/**
 * App-switcher — the discreet door to the wider Dapta suite (design-parity with
 * Dapta Calendars). An Atlassian-style grid affordance next to the product
 * wordmark that opens a small menu:
 *   • Dapta Agents (→ platform, new tab)  • Dapta Calendars (new tab)  • Forms (current)
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
        <p className="px-2 py-1 text-2xs font-semibold uppercase tracking-wide text-faint">
          {m.eyebrow}
        </p>

        {/* Dapta Agents — the platform (external, new tab). First, per Felipe.
            Same name and destination as the rail's own "Dapta Agents" item: one
            door, two handles, so it never reads as two different products. */}
        {PLATFORM_URL ? (
          <a
            role="menuitem"
            tabIndex={-1}
            href={suiteHref(PLATFORM_URL, 'app_switcher')}
            target="_blank"
            rel="noopener noreferrer"
            onClick={close}
            className="flex items-center gap-2.5 rounded-sm px-2 py-2 text-sm transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            {/* Tiled, not bare. `dapta-mark.png` is fixed white artwork, so on the
                light popover it was white-on-white — the row read as a label with
                no logo. `bg-brand-ink` is the one ground that does not flip with
                the theme (see `--brand-ink`), which is what a mark that cannot
                change colour requires.
                Every row in this menu uses the SAME tile. Once one mark needs a
                constant dark ground they all do: a menu that mixes a black tile
                and a white one reads as two design systems sharing a popover, and
                the odd one out looks like a bug rather than a brand. */}
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-brand-ink">
              <img
                src="/dapta-mark.png"
                alt=""
                width={18}
                height={18}
                className="h-[18px] w-[18px] object-contain"
              />
            </span>
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
            href={suiteHref(CALENDARS_URL, 'app_switcher')}
            target="_blank"
            rel="noopener noreferrer"
            onClick={close}
            className="flex items-center gap-2.5 rounded-sm px-2 py-2 text-sm transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            <span
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-brand-ink text-xs font-semibold text-brand-ink-foreground"
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
          {/* The same 24px `bg-brand-ink` tile as the rows above. It used to be
              `bg-background`, which on the light theme made this the one pale tile
              in a menu of dark ones.
              The mark takes `text-brand-ink-foreground`, NOT `text-foreground`:
              only its stem is `currentColor` (the arms are a fixed lime), so on a
              constant dark tile a theme-following foreground would erase the stem
              in light mode and leave the arms floating. */}
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-brand-ink">
            <BrandMark className="h-3.5 w-auto text-brand-ink-foreground" />
          </span>
          <span className="flex-1 truncate">{PRODUCT_NAME}</span>
          <i aria-hidden className="pi pi-check text-primary" style={{ fontSize: 14 }} />
        </span>
      </AnchoredMenu>
    </>
  );
}
