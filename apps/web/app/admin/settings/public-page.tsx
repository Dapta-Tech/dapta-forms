'use client';

import { useState, useTransition } from 'react';
import type { MemberProfile } from '@quill/types';
import type { FormsMessages } from '@quill/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/components/toast';
import { saveMyProfileAction, myProfileAction, type ProfileSaveState } from './actions';
import {
  callAction,
  callActionWithRetry,
  isTransportError,
  type TransportError,
} from '@/lib/call-action';

type Msgs = FormsMessages['admin']['settings'];

/**
 * What a save attempt proves about the STORED profile.
 *
 * `saved` is the server's own copy. `rejected` means the server refused and
 * stored nothing. `unknown` is the dangerous one: the call never produced a
 * verdict, and a client-side timeout does not abort the PUT — the write may
 * have landed. Neither the value that was sent nor the one held before it is
 * evidence of what is stored, so this outcome carries no profile at all.
 */
export type SaveVerdict =
  | { status: 'saved'; profile: MemberProfile | null }
  | { status: 'rejected'; message: string | null }
  | { status: 'unknown' };

export function readSaveVerdict(res: ProfileSaveState | TransportError): SaveVerdict {
  if (isTransportError(res)) return { status: 'unknown' };
  if (!res.ok) return { status: 'rejected', message: res.message ?? null };
  return { status: 'saved', profile: res.profile };
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
  // The last profile the server told us it stores — what the switch and the
  // View link render. It moves only when the server answers, never on click.
  const [saved, setSaved] = useState<MemberProfile | null>(initial);
  // `false` while a save's outcome is unknown: the screen has no authority to
  // show a state or to write one, so it shows neither until the reread lands.
  const [settled, setSettled] = useState(true);
  const [headline, setHeadline] = useState(initial?.headline ?? '');
  const [bio, setBio] = useState(initial?.bio ?? '');
  const enabled = saved?.enabled ?? false;

  /** Ask the server what it stores. The only way out of an unknown state. */
  function reread() {
    start(async () => {
      // A read is idempotent, so a few in-place attempts are safe and spare the
      // member a reload to escape a blocked section.
      const res = await callActionWithRetry(() => myProfileAction());
      if (isTransportError(res) || !res.ok) {
        // Still nothing authoritative: stay blocked rather than guess.
        error(m.publicPageError);
        return;
      }
      setSaved(res.profile);
      setSettled(true);
    });
  }

  function save(nextEnabled = enabled) {
    // Blocked while the stored state is unknown: any payload built here would
    // carry a pre-save value over whatever the server ended up storing.
    if (!settled) return;
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
      const verdict = readSaveVerdict(await callAction(() => saveMyProfileAction(profile)));
      if (verdict.status === 'unknown') {
        setSettled(false);
        error(m.publicPageError);
        reread();
        return;
      }
      if (verdict.status === 'rejected') {
        error(verdict.message ?? m.publicPageError);
        return;
      }
      setSaved(verdict.profile);
      success(m.publicPageSaved);
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
          {settled ? (
            <>
              <Switch
                checked={enabled}
                onCheckedChange={(v) => save(v)}
                disabled={pending || !publicPath}
                aria-label={m.publicPageEnable}
              />
              {m.publicPageEnable}
            </>
          ) : (
            // Nothing is known about the stored page: no toggle to click, and
            // no on/off claim to read, until the reread answers.
            <span aria-live="polite" className="text-muted-foreground">
              {m.publicPageSaving}
            </span>
          )}
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
              <Button onClick={() => save()} disabled={pending || !settled} size="sm">
                {pending ? m.publicPageSaving : m.publicPageSave}
              </Button>
              {settled && enabled ? (
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
