'use client';

import { useState, useTransition } from 'react';
import type { MemberProfile } from '@quill/types';
import type { FormsMessages } from '@quill/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SettingsRow } from '@/components/ui/settings';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/components/toast';
import { saveMyProfileAction } from './actions';
import { callAction, isTransportError } from '@/lib/call-action';

type Msgs = FormsMessages['admin']['settings'];

/**
 * The public member page editor.
 *
 * Deliberately off until switched on. The column and the route now exist for
 * every member, so defaulting this to enabled would publish a page about each
 * teammate the moment the migration ran — the switch is what makes it a
 * decision rather than a side-effect. Turning it off again removes the page
 * entirely; it goes straight back to the 404 it was.
 */
export function PublicPageSettings({
  publicPath,
  initial,
  m,
}: {
  /** The URL this page will live at, or null when the member has no handle. */
  publicPath: string | null;
  initial: MemberProfile | null;
  m: Msgs;
}) {
  const { success, error } = useToast();
  const [pending, start] = useTransition();
  const [enabled, setEnabled] = useState(initial?.enabled ?? false);
  const [headline, setHeadline] = useState(initial?.headline ?? '');
  const [bio, setBio] = useState(initial?.bio ?? '');

  function save(nextEnabled = enabled) {
    start(async () => {
      const profile: MemberProfile | null = {
        version: 1,
        enabled: nextEnabled,
        headline: headline.trim() || null,
        bio: bio.trim() || null,
        // Preserve what this screen does not edit yet rather than dropping it —
        // a save here must not silently wipe links or a palette set elsewhere.
        links: initial?.links,
        formSlugs: initial?.formSlugs,
        branding: initial?.branding,
      };
      const res = await callAction(() => saveMyProfileAction(profile));
      if (res.ok) success(m.publicPageSaved);
      else error((isTransportError(res) ? null : res.message) ?? m.publicPageError);
    });
  }

  return (
    <section data-testid="public-page-settings" className="mb-10">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-xl font-semibold tracking-tight">{m.publicPageHeading}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{m.publicPageSubtitle}</p>
        </div>
        <label className="flex shrink-0 items-center gap-2 text-sm">
          <Switch
            checked={enabled}
            onCheckedChange={(v) => {
              setEnabled(v);
              save(v);
            }}
            disabled={pending || !publicPath}
            aria-label={m.publicPageEnable}
          />
          {m.publicPageEnable}
        </label>
      </div>

      {!publicPath ? (
        <p className="mt-4 text-sm text-muted-foreground">{m.publicPageNoHandle}</p>
      ) : (
        <>
          <p
            className="mt-4 inline-flex rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground"
            data-testid="public-page-url"
          >
            {publicPath}
          </p>

          <div className="mt-4 border-t border-border">
            <SettingsRow title={m.publicPageHeadline} first>
              <Input
                value={headline}
                maxLength={120}
                aria-label={m.publicPageHeadline}
                placeholder={m.publicPageHeadlinePlaceholder}
                onChange={(e) => setHeadline(e.target.value)}
              />
            </SettingsRow>
            <SettingsRow title={m.publicPageBio}>
              <textarea
                value={bio}
                maxLength={600}
                rows={4}
                aria-label={m.publicPageBio}
                placeholder={m.publicPageBioPlaceholder}
                onChange={(e) => setBio(e.target.value)}
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </SettingsRow>
            <div className="flex items-center gap-3 border-t border-border pt-6">
              <Button onClick={() => save()} disabled={pending}>
                {pending ? m.publicPageSaving : m.publicPageSave}
              </Button>
              {enabled ? (
                <a
                  href={publicPath}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
                >
                  {m.publicPageView}
                </a>
              ) : null}
            </div>
          </div>
        </>
      )}
    </section>
  );
}
