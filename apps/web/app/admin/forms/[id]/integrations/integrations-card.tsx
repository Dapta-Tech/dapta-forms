'use client';

import type React from 'react';
import type { FormsMessages } from '@quill/shared';
import { Switch } from '@/components/ui/switch';
import { ProviderLogo, type LogoProvider } from '@/components/ui/provider-logo';

type Msgs = FormsMessages['admin']['integrations'];

/**
 * The shell every integration on the Connect tab is drawn in: header, optional
 * provider logo and badge, an on/off switch, and the settings below it.
 *
 * Lives apart from `integrations-editor` because it is presentational and
 * hook-free, so a test can call it as a plain function and walk the element
 * tree — the editor's own components use hooks and need a real renderer.
 */
export function Card({
  title,
  desc,
  enabled,
  onToggle,
  m,
  badge,
  logo,
  notice,
  children,
}: {
  title: string;
  desc: string;
  enabled: boolean;
  onToggle: (v: boolean) => void;
  m: Msgs;
  badge?: string;
  /** The provider this card configures, when it is a named third party. */
  logo?: LogoProvider;
  /**
   * Rendered under the header and OUTSIDE the `enabled` gate, unlike `children`.
   * For what is true of the STORED config whether or not the card is switched
   * on — above all, a warning about what saving this card will destroy. A card
   * toggled off is where such a warning matters most: flipping the switch is
   * itself an edit, and the autosave it triggers is what does the destroying.
   */
  notice?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            {logo ? <ProviderLogo provider={logo} size={20} /> : null}
            <h2 className="text-lg font-semibold">{title}</h2>
            {badge ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-primary-edge/40 bg-primary/10 px-2 py-0.5 text-xs font-medium text-foreground">
                <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-primary-edge" />
                {badge}
              </span>
            ) : null}
          </div>
          <p className="mt-0.5 text-sm text-muted-foreground">{desc}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="text-xs text-muted-foreground">{enabled ? m.enabled : m.disabled}</span>
          <Switch checked={enabled} onCheckedChange={onToggle} aria-label={title} />
        </div>
      </div>
      {notice}
      {enabled ? <div className="mt-5 flex flex-col gap-4">{children}</div> : null}
    </section>
  );
}
