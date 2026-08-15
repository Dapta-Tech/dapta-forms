'use client';

import { useState, useTransition } from 'react';
import type { MemberProfile } from '@quill/types';
import type { FormsMessages } from '@quill/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/components/toast';
import { saveMyProfileAction, type ProfileSaveState } from './actions';
import { callAction, isTransportError, type TransportError } from '@/lib/call-action';

type Msgs = FormsMessages['admin']['settings'];

/**
 * Read a save attempt as a statement about PERSISTED state.
 *
 * The switch used to move on click and stay there, so a refused save left the
 * toggle — and the "View page" link beside it — describing a page the server
 * had declined to publish, or hiding one it had declined to take down. Only a
 * server verdict may move the screen: a success adopts the profile that came
 * back, a refusal keeps the last confirmed one, and a transport failure (no
 * verdict at all) settles nothing rather than promoting a hope to a fact.
 */
export function reconcileProfileSave(
  confirmed: MemberProfile | null,
  res: ProfileSaveState | TransportError,
): { profile: MemberProfile | null; saved: boolean; message: string | null } {
  // Never reached the server: the write may or may not have landed, so the only
  // honest thing on screen is the last state the server did confirm.
  if (isTransportError(res)) return { profile: confirmed, saved: false, message: null };
  if (!res.ok) return { profile: confirmed, saved: false, message: res.message ?? null };
  return { profile: res.profile, saved: true, message: null };
}

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
  // The last profile the server confirmed — what the switch and the View link
  // render. It moves only when a save comes back, never on click.
  const [saved, setSaved] = useState<MemberProfile | null>(initial);
  const [headline, setHeadline] = useState(initial?.headline ?? '');
  const [bio, setBio] = useState(initial?.bio ?? '');
  const enabled = saved?.enabled ?? false;

  function save(nextEnabled = enabled) {
    start(async () => {
      const profile: MemberProfile = {
        version: 1,
        enabled: nextEnabled,
        headline: headline.trim() || null,
        bio: bio.trim() || null,
        // Preserve what this screen does not edit yet rather than dropping it —
        // a save here must not silently wipe links or a palette set elsewhere.
        links: saved?.links,
        formSlugs: saved?.formSlugs,
        branding: saved?.branding,
      };
      const res = await callAction(() => saveMyProfileAction(profile));
      const next = reconcileProfileSave(saved, res);
      setSaved(next.profile);
      if (next.saved) success(m.publicPageSaved);
      else error(next.message ?? m.publicPageError);
    });
  }

  return (
    <section
      data-testid="public-page-settings"
      className="mb-8 rounded-xl border border-border bg-card p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold tracking-tight">{m.publicPageHeading}</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">{m.publicPageSubtitle}</p>
        </div>
        <label className="flex shrink-0 items-center gap-2 text-sm">
          <Switch
            checked={enabled}
            onCheckedChange={(v) => save(v)}
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
          <p className="mt-4 font-mono text-xs text-muted-foreground" data-testid="public-page-url">
            {publicPath}
          </p>

          <div className="mt-5 flex flex-col gap-4">
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">{m.publicPageHeadline}</span>
              <Input
                value={headline}
                maxLength={120}
                placeholder={m.publicPageHeadlinePlaceholder}
                onChange={(e) => setHeadline(e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">{m.publicPageBio}</span>
              <textarea
                value={bio}
                maxLength={600}
                rows={4}
                placeholder={m.publicPageBioPlaceholder}
                onChange={(e) => setBio(e.target.value)}
                className="rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </label>
            <div className="flex items-center gap-3">
              <Button onClick={() => save()} disabled={pending} size="sm">
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
