'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { MemberProfile } from '@quill/types';
import type { FormsMessages } from '@quill/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/components/toast';
import { saveMyProfileAction } from './actions';
import { callAction, isTransportError } from '@/lib/call-action';

type Msgs = FormsMessages['admin']['settings'];

/** What the server render found: the page, or why it cannot be edited. */
export type PublicPageLoad =
  | { status: 'ok'; profile: MemberProfile | null; revision: number }
  | { status: 'failed' }
  | { status: 'unsupported' };

/** The stored page and the revision it was read at — the only editable baseline. */
interface Authoritative {
  profile: MemberProfile | null;
  revision: number;
}

/**
 * Every state this section can be in. `reconciling` and `unresolved` are the
 * ones worth naming: a save whose answer never arrived is not a success and not
 * a failure, and until it is settled nothing may be written and no on/off state
 * may be claimed.
 */
type Phase =
  | { kind: 'ready' }
  | { kind: 'blocked'; reason: 'load' | 'capability' }
  | { kind: 'reconciling' }
  | { kind: 'unresolved' };

/** What the fence Route Handler answers. */
type FenceResponse =
  | { status: 'ok'; profile: MemberProfile | null; revision: number }
  | { status: 'conflict'; profile: MemberProfile | null; revision: number }
  | { status: 'unauthorized' | 'not_found' | 'unsupported' | 'unknown' | 'failed' };

const RECONCILE_URL = '/api/settings/public-page/reconcile';

/**
 * Are two stored pages the same page? Compared on normalized JSON, because the
 * server re-parses the blob on every write: key order, and absent optional
 * keys, are not a change the member made.
 */
export function sameStoredProfile(a: MemberProfile | null, b: MemberProfile | null): boolean {
  const norm = (p: MemberProfile | null): string =>
    p == null
      ? 'null'
      : JSON.stringify(
          Object.fromEntries(
            Object.entries(p as Record<string, unknown>)
              .filter(([, v]) => v !== undefined)
              .sort(([x], [y]) => x.localeCompare(y)),
          ),
        );
  return norm(a) === norm(b);
}

/**
 * Read a settled fence as a statement about the ambiguous save.
 *
 * The fence won  -> that save never landed and never can: nothing was applied.
 * The fence lost -> something else got there first. We adopt what came back but
 *   never claim authorship: "changed" and "unchanged" get different copy, and
 *   neither of them is "Saved".
 */
export function readFenceOutcome(
  baseline: MemberProfile | null,
  result: { status: 'ok' | 'conflict'; profile: MemberProfile | null; revision: number },
): { adopt: Authoritative; notice: 'not-applied' | 'latest-loaded' | 'no-op-advance' } {
  const adopt = { profile: result.profile, revision: result.revision };
  if (result.status === 'ok') return { adopt, notice: 'not-applied' };
  return {
    adopt,
    notice: sameStoredProfile(baseline, result.profile) ? 'no-op-advance' : 'latest-loaded',
  };
}

/**
 * The public member page editor.
 *
 * Deliberately off until switched on. The column and the route now exist for
 * every member, so defaulting this to enabled would publish a page about each
 * teammate the moment the migration ran — the switch is what makes it a
 * decision rather than a side-effect. Turning it off again removes the page
 * entirely; it goes straight back to the 404 it was.
 *
 * The switch and the "View page" link render ONLY from `authoritative`: state
 * the server said it stores, at a revision. The headline and bio being typed
 * live separately and are never thrown away by a reconciliation.
 */
export function PublicPageSettings({
  publicPath,
  load,
  m,
}: {
  /** The URL this page will live at, or null when the member has no handle. */
  publicPath: string | null;
  load: PublicPageLoad;
  m: Msgs;
}) {
  const { success, error } = useToast();
  const router = useRouter();
  const [pending, start] = useTransition();

  const [authoritative, setAuthoritative] = useState<Authoritative | null>(
    load.status === 'ok' ? { profile: load.profile, revision: load.revision } : null,
  );
  const [phase, setPhase] = useState<Phase>(
    load.status === 'ok'
      ? { kind: 'ready' }
      : { kind: 'blocked', reason: load.status === 'failed' ? 'load' : 'capability' },
  );
  /** The revision the ambiguous save expected. Every retry re-uses THIS one. */
  const [ambiguous, setAmbiguous] = useState<{
    revision: number;
    baseline: MemberProfile | null;
  } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // The member's own text, kept apart from stored state so adopting an
  // authoritative profile never deletes what they are in the middle of writing.
  const [headline, setHeadline] = useState(load.status === 'ok' ? (load.profile?.headline ?? '') : '');
  const [bio, setBio] = useState(load.status === 'ok' ? (load.profile?.bio ?? '') : '');

  // A refresh after a settled save re-renders this page with newer stored state.
  // Adopt it only when it is actually newer, so a remount cannot walk the
  // reconciled revision backwards.
  useEffect(() => {
    if (load.status !== 'ok') return;
    setAuthoritative((prev) =>
      prev && prev.revision >= load.revision
        ? prev
        : { profile: load.profile, revision: load.revision },
    );
  }, [load]);

  const settled = phase.kind === 'ready';
  const canWrite = settled && !pending && !!publicPath && authoritative !== null;
  const enabled = settled ? (authoritative?.profile?.enabled ?? false) : false;

  function adopt(next: Authoritative, message: string) {
    setAuthoritative(next);
    setAmbiguous(null);
    setPhase({ kind: 'ready' });
    setNotice(message);
    // The server already revalidated; pull the fresh render so a later remount
    // starts from the state we just reconciled to.
    router.refresh();
  }

  /**
   * Settle the ambiguous save with the ORIGINAL expected revision, off the
   * Server Action queue. Repeating this is safe: the first fence spends that
   * revision, so every repeat conflicts instead of advancing the counter again.
   */
  function reconcile(pin: { revision: number; baseline: MemberProfile | null }) {
    setPhase({ kind: 'reconciling' });
    setNotice(m.publicPageReconciling);
    void (async () => {
      let result: FenceResponse;
      try {
        const res = await fetch(RECONCILE_URL, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ expectedRevision: pin.revision }),
          cache: 'no-store',
        });
        result = (await res.json()) as FenceResponse;
      } catch {
        result = { status: 'unknown' };
      }

      if (result.status === 'ok' || result.status === 'conflict') {
        const outcome = readFenceOutcome(pin.baseline, result);
        adopt(
          outcome.adopt,
          outcome.notice === 'not-applied'
            ? m.publicPageTimedOutNotApplied
            : outcome.notice === 'no-op-advance'
              ? m.publicPageNoOpAdvance
              : m.publicPageLatestLoaded,
        );
        return;
      }
      // Still undecided — including an expired session, which comes back as a
      // JSON status rather than a login page. Editing stays off.
      setPhase({ kind: 'unresolved' });
      setNotice(m.publicPageUnresolved);
    })();
  }

  function save(nextEnabled = enabled) {
    if (!canWrite || !authoritative) return;
    const baseline = authoritative;
    start(async () => {
      const profile: MemberProfile = {
        version: 1,
        enabled: nextEnabled,
        headline: headline.trim() || null,
        bio: bio.trim() || null,
        // Preserve what this screen does not edit yet rather than dropping it —
        // a save here must not silently wipe links or a palette set elsewhere.
        links: baseline.profile?.links,
        formSlugs: baseline.profile?.formSlugs,
        branding: baseline.profile?.branding,
      };
      const res = await callAction(() => saveMyProfileAction(profile, baseline.revision));

      // A transport failure and a server "unknown" mean the same thing: the
      // write may have landed. Neither may be announced either way.
      if (isTransportError(res) || res.status === 'unknown') {
        const pin = { revision: baseline.revision, baseline: baseline.profile };
        setAmbiguous(pin);
        reconcile(pin);
        return;
      }
      if (res.status === 'ok') {
        setAuthoritative({ profile: res.profile, revision: res.revision });
        setNotice(null);
        success(m.publicPageSaved);
        return;
      }
      if (res.status === 'conflict') {
        // Somebody else's write won. Adopt what is stored — including the fields
        // this screen only carries — while the draft text stays untouched.
        setAuthoritative({ profile: res.profile, revision: res.revision });
        setNotice(m.publicPageChangedElsewhere);
        error(m.publicPageChangedElsewhere);
        return;
      }
      if (res.status === 'unsupported') {
        setPhase({ kind: 'blocked', reason: 'capability' });
        setNotice(m.publicPageUnsupported);
        return;
      }
      error(m.publicPageError);
    });
  }

  const blockedMessage =
    phase.kind === 'blocked'
      ? phase.reason === 'load'
        ? m.publicPageLoadFailed
        : m.publicPageUnsupported
      : null;

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
                disabled={!canWrite}
                aria-label={m.publicPageEnable}
              />
              {m.publicPageEnable}
            </>
          ) : (
            // Nothing authoritative to show: no toggle to click and no on/off
            // claim to read until the state is known again.
            <span
              data-testid="public-page-status"
              aria-live="polite"
              className="text-muted-foreground"
            >
              {phase.kind === 'reconciling'
                ? m.publicPageReconciling
                : (blockedMessage ?? m.publicPageUnresolved)}
            </span>
          )}
        </label>
      </div>

      {notice ? (
        <p data-testid="public-page-notice" className="mt-3 text-sm text-muted-foreground">
          {notice}
        </p>
      ) : null}

      {phase.kind === 'unresolved' || phase.kind === 'blocked' ? (
        <div className="mt-3 flex items-center gap-3">
          {ambiguous ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              data-testid="public-page-check-again"
              onClick={() => reconcile(ambiguous)}
            >
              {m.publicPageCheckAgain}
            </Button>
          ) : null}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            data-testid="public-page-reload"
            onClick={() => router.refresh()}
          >
            {m.publicPageReload}
          </Button>
        </div>
      ) : null}

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
                disabled={!settled}
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
                disabled={!settled}
                className="rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
              />
            </label>
            <div className="flex items-center gap-3">
              <Button onClick={() => save()} disabled={!canWrite} size="sm">
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
