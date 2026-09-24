'use client';

import { useEffect, useId, useMemo, useState } from 'react';
import { contactKeyReadiness, type ContactKeyReadiness, type FormConfig } from '@quill/engine';
import type { FormSpamProtection, FormTracking } from '@quill/types';
import { getMessages, type Locale } from '@quill/shared';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { awaitPendingDestinationWrite } from '@/lib/connect-sync';
import { IntegrationsEditor, type QuestionMeta } from '../../integrations/integrations-editor';
import { loadConnectIntegrationsAction, type ConnectIntegrationsData } from './connect-actions';
import { ConnectEmailsSection } from './connect-emails-section';
import { Field, PanelSection, TextField } from './fields';
import type { EditorMessages } from './messages';

/**
 * The editor's Connect tab (Typeform parity): Spam protection (the human check
 * before the final submit, `config.spamProtection`, staged with the draft like
 * Tracking), per-form Integrations (webhook +
 * HubSpot mapping, the existing IntegrationsEditor embedded as-is), Tracking &
 * Pixels (writes `config.tracking` through the editor's autosave/publish flow),
 * and Emails (per-form template overrides — form → account → stock precedence,
 * persisted via /v1/forms/:id/notifications, independent of the form config).
 *
 * Data/persistence split (why the two saves can't clobber each other):
 * - Tracking edits mutate the editor's config state → debounced autosave →
 *   PUT /v1/forms/:id stores an UNPUBLISHED DRAFT; Publish applies it live.
 * - Integrations save inside IntegrationsEditor keeps its existing server
 *   action → PUT /v1/forms/:id/destinations, a PARTIAL live-config write.
 *   Server-side, drafts never stage `destinations` (saveDraftConfig strips the
 *   key) and publish carries the live destinations over the draft — so the
 *   editor's autosave and the integrations save write DISJOINT keys.
 * - Because destinations live only in the LIVE config, this panel fetches them
 *   fresh (server action) on every tab activation instead of trusting the
 *   editor's config snapshot.
 */
export function ConnectPanel({
  formId,
  config,
  onTrackingChange,
  onSpamProtectionChange,
  captchaAvailable = false,
  m,
  locale,
}: {
  formId: string;
  /** The LIVE editor config state — questions and tracking read from here. */
  config: FormConfig;
  onTrackingChange: (tracking: FormTracking | undefined) => void;
  onSpamProtectionChange: (spamProtection: FormSpamProtection | undefined) => void;
  /**
   * Whether this DEPLOYMENT can run the human check (`/v1/me`). Reported by the
   * API, never read from the dashboard's env: two copies of the switch that
   * disagreed would offer a check the API then ignores.
   */
  captchaAvailable?: boolean;
  m: EditorMessages;
  locale: string;
}) {
  const mc = m.connect;
  const loc: Locale = locale === 'es' ? 'es' : 'en';
  // The shared catalog is a plain typed object (already used by client
  // components, e.g. publish-button) — safe to resolve in the browser.
  const im = useMemo(() => getMessages(loc).admin.integrations, [loc]);

  // "Map questions" rows come from the LIVE editor state so a question added a
  // second ago is mappable immediately (no refetch). `message` steps collect no
  // answer, so they are excluded — mirrors the old integrations page.
  const questions: QuestionMeta[] = useMemo(
    () =>
      config.steps
        .filter((s) => s.type !== 'message')
        .map((s) => ({ key: s.key, label: s.question?.trim() || s.key, type: s.type })),
    [config.steps],
  );



  const spamProtection = readSpamProtection(config);
  // Partials are held only where the check actually runs: the owner's switch
  // AND a deployment with keys. Anywhere else the integrations below behave,
  // and are described, exactly as they always were.
  const partialsHeld = captchaAvailable && spamProtection?.captcha === true;

  return (
    <div data-testid="connect-panel" className="mx-auto flex w-full max-w-[900px] flex-col gap-4">
      <SpamProtectionSection
        value={spamProtection}
        available={captchaAvailable}
        onChange={onSpamProtectionChange}
        mc={mc}
      />
      <IntegrationsSection
        formId={formId}
        questions={questions}
        config={config}
        partialsHeld={partialsHeld}
        mc={mc}
        im={im}
        locale={loc}
      />
      <TrackingSection config={config} onTrackingChange={onTrackingChange} mc={mc} />
      <ConnectEmailsSection formId={formId} m={mc} locale={locale} />
    </div>
  );
}

// A flat "Deliveries that did not land" list used to sit here, between the
// integrations and Tracking. It mixed every outbox kind and, on a form with a
// broken endpoint, its retries pushed the rest of the tab off the screen — the
// diagnosis was louder than everything it was diagnosing. Each integration card
// now carries its own collapsible history instead (`DeliveryHistory`), so a
// webhook's failures are read next to the URL that produced them.

// --- Integrations (embeds the existing IntegrationsEditor) -------------------

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: ConnectIntegrationsData };

function IntegrationsSection({
  formId,
  questions,
  config,
  partialsHeld,
  mc,
  im,
  locale,
}: {
  formId: string;
  questions: QuestionMeta[];
  /** The LIVE editor config — readiness is derived here, next to the fetched
   *  connection state, so both halves of the answer come from one place. */
  config: FormConfig;
  /** Spam protection holds this form's partial deliveries (see ConnectPanel). */
  partialsHeld: boolean;
  mc: EditorMessages['connect'];
  im: ReturnType<typeof getMessages>['admin']['integrations'];
  locale: Locale;
}) {
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  // Whether this form can key a CRM contact at all. Derived from the LIVE
  // config so adding an email question unblocks the mapping immediately, and
  // crossed with the account's connections because a scheduler only yields an
  // address while its provider is connected — the config alone cannot answer
  // "will this sync". While the fetch is in flight, assume connected: a
  // transient "not connected" warning would be worse than a late one.
  const readiness: ContactKeyReadiness = useMemo(
    () =>
      contactKeyReadiness(config, {
        scheduler: state.status !== 'ready' || state.data.calendlyConnected,
      }),
    [config, state],
  );

  // Fetch on tab activation (the panel mounts only while the Connect tab is
  // active, so re-entering the tab always shows the latest saved destinations).
  // First wait for any write the previous mount flushed on its way out, so this
  // read cannot overtake it and load a config that is about to be overwritten
  // (V4-05 race).
  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    awaitPendingDestinationWrite(formId)
      .then(() => loadConnectIntegrationsAction(formId, locale))
      .then((res) => {
        if (cancelled) return;
        setState(res.ok ? { status: 'ready', data: res.data } : { status: 'error', message: res.message });
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'error', message: mc.integrationsLoadError });
      });
    return () => {
      cancelled = true;
    };
    // mc is a stable catalog subtree (not a dep); attempt re-arms Retry.
  }, [formId, locale, attempt]);

  return (
    <section data-testid="connect-integrations" className="flex flex-col gap-3">
      <div className="min-w-0">
        <h3 className="text-sm font-semibold text-foreground">{mc.integrationsTitle}</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">{mc.integrationsSubtitle}</p>
      </div>
      {state.status === 'loading' ? (
        <div aria-hidden className="flex flex-col gap-4">
          <div className="h-36 animate-pulse rounded-lg border border-border bg-muted" />
          <div className="h-36 animate-pulse rounded-lg border border-border bg-muted" />
        </div>
      ) : state.status === 'error' ? (
        <div className="flex flex-col items-start gap-3 rounded-xl border border-border bg-card p-5">
          <p className="text-sm text-muted-foreground" role="alert">
            {state.message || mc.integrationsLoadError}
          </p>
          <Button variant="outline" size="sm" onClick={() => setAttempt((n) => n + 1)}>
            <i aria-hidden className="pi pi-refresh" style={{ fontSize: 12 }} />
            {mc.retry}
          </Button>
        </div>
      ) : (
        <IntegrationsEditor
          id={formId}
          initialDestinations={state.data.destinations}
          hubspot={state.data.hubspot}
          hubspotConnected={state.data.hubspotConnected}
          questions={questions}
          readiness={readiness}
          partialsHeld={partialsHeld}
          messages={im}
          locale={locale}
        />
      )}
    </section>
  );
}

// --- Spam protection (the human check before the final submit) --------------

/** The engine's FormConfig omits additive keys; `spamProtection` round-trips like `tracking`. */
const readSpamProtection = (config: FormConfig): FormSpamProtection | null | undefined =>
  (config as FormConfig & { spamProtection?: FormSpamProtection | null }).spamProtection;

/**
 * The owner's switch for spam protection, and its mode.
 *
 * Writes through the editor's DRAFT (like Tracking): nothing reaches the live
 * form until Publish. Off is stored as ABSENT, never `{ captcha: false }`, so a
 * form switched on and back off keeps the exact config shape of every form
 * before this existed; the mode resets with it, to the recommended Automatic.
 *
 * On a deployment without challenge keys the switch cannot be turned on, and
 * says why. A switch already saved on there (a copied or imported form) says it
 * is not active here and can still be turned off: the API ignores it anyway,
 * but the owner should be able to clean it up.
 */
export function SpamProtectionSection({
  value,
  available,
  onChange,
  mc,
}: {
  value: FormSpamProtection | null | undefined;
  available: boolean;
  onChange: (next: FormSpamProtection | undefined) => void;
  mc: EditorMessages['connect'];
}) {
  const on = value?.captcha === true;
  // `strict` means nothing without the switch, so it is never shown on its own.
  const strict = on && value?.strict === true;
  const group = useId();
  const radio = 'mt-0.5 size-4 shrink-0 cursor-pointer accent-primary-edge disabled:cursor-not-allowed';

  return (
    <PanelSection title={mc.spamTitle}>
      <div data-testid="connect-spam" className="flex flex-col gap-3">
        <div className="flex items-start gap-3">
          <Switch
            checked={on}
            onCheckedChange={(next) => onChange(next ? { captcha: true } : undefined)}
            disabled={!available && !on}
            aria-label={mc.spamToggle}
            data-testid="spam-toggle"
            className="mt-0.5"
          />
          <div className="min-w-0">
            <p className="text-sm text-foreground">{mc.spamToggle}</p>
            <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{mc.spamHelp}</p>
          </div>
        </div>

        {!available ? (
          <p
            data-testid="spam-unavailable"
            className="rounded-md border border-border bg-muted/40 px-2.5 py-2 text-xs leading-relaxed text-muted-foreground"
          >
            {on ? mc.spamInactiveHere : mc.spamUnavailable}
          </p>
        ) : null}

        {on ? (
          <fieldset className="flex flex-col gap-2 pl-12">
            <legend className="sr-only">{mc.spamModeGroup}</legend>
            <label className="flex cursor-pointer items-start gap-2 text-sm text-foreground">
              <input
                type="radio"
                name={group}
                checked={!strict}
                disabled={!available}
                onChange={() => onChange({ captcha: true })}
                data-testid="spam-mode-auto"
                className={radio}
              />
              <span>{mc.spamModeAuto}</span>
            </label>
            <label className="flex cursor-pointer items-start gap-2 text-sm text-foreground">
              <input
                type="radio"
                name={group}
                checked={strict}
                disabled={!available}
                onChange={() => onChange({ captcha: true, strict: true })}
                data-testid="spam-mode-strict"
                className={radio}
              />
              <span>
                {mc.spamModeStrict}
                <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
                  {mc.spamModeStrictHelp}
                </span>
              </span>
            </label>
          </fieldset>
        ) : null}

        {on && available ? (
          <>
            <p data-testid="spam-partial-note" className="text-xs leading-relaxed text-muted-foreground">
              {mc.spamPartialNote}
            </p>
            {/* Same note, same place, as Tracking's: this rides the draft, while
                the integrations below save to the live form as you type. */}
            <p
              data-testid="spam-draft-note"
              className="flex items-start gap-1.5 rounded-md border border-secondary/40 bg-secondary/10 px-2.5 py-2 text-xs leading-relaxed text-foreground"
            >
              <i aria-hidden className="pi pi-info-circle mt-0.5 shrink-0 text-secondary" style={{ fontSize: 11 }} />
              {mc.spamDraftNote}
            </p>
          </>
        ) : null}
      </div>
    </PanelSection>
  );
}

// --- Tracking & pixels (feature N7 — writes config.tracking via autosave) ----

/** The engine's renderer-focused FormConfig omits additive keys; `tracking` is
 *  round-tripped by the editor (normalizeConfig passes it through untouched). */
type TrackingKey = 'gtmId' | 'metaPixelId' | 'posthogKey' | 'posthogHost' | 'hubspotTrackingId';
const TRACKING_KEYS: TrackingKey[] = [
  'gtmId',
  'metaPixelId',
  'posthogKey',
  'posthogHost',
  'hubspotTrackingId',
];

const readTracking = (config: FormConfig): FormTracking =>
  (config as FormConfig & { tracking?: FormTracking | null }).tracking ?? {};

const isHttpUrl = (v: string): boolean => {
  try {
    const u = new URL(v);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
};

function TrackingSection({
  config,
  onTrackingChange,
  mc,
}: {
  config: FormConfig;
  onTrackingChange: (tracking: FormTracking | undefined) => void;
  mc: EditorMessages['connect'];
}) {
  const tracking = readTracking(config);

  // posthogHost must be a valid http(s) URL to pass the save schema, so the
  // input keeps a local draft and commits only valid (or empty) values — a
  // half-typed host never fails the WHOLE autosave (which also carries steps).
  const [hostDraft, setHostDraft] = useState<string>(() => tracking.posthogHost ?? '');
  const hostInvalid = hostDraft.trim() !== '' && !isHttpUrl(hostDraft.trim());

  /** Rebuild `config.tracking` with one key changed; blank fields are OMITTED
   *  (undefined — never empty strings) and an all-empty object becomes
   *  undefined so legacy configs stay byte-identical. */
  function commit(key: TrackingKey, raw: string) {
    const next: FormTracking = {};
    for (const k of TRACKING_KEYS) {
      const v = k === key ? raw : tracking[k];
      if (typeof v === 'string' && v.trim() !== '') next[k] = v;
    }
    onTrackingChange(Object.keys(next).length > 0 ? next : undefined);
  }

  function commitHost(raw: string) {
    setHostDraft(raw);
    const trimmed = raw.trim();
    if (trimmed === '') commit('posthogHost', '');
    else if (isHttpUrl(trimmed)) commit('posthogHost', trimmed);
    // Invalid → keep the draft local; config retains the last valid value and
    // the inline hint below flags it.
  }

  return (
    <PanelSection title={mc.trackingTitle} subtitle={mc.trackingSubtitle}>
      {/* Two persistence models live on this one tab: the Integrations section
          writes the LIVE config the moment you type, while these fields ride the
          editor's DRAFT and only reach respondents on Publish. Nothing said so,
          and a single "Changes saved automatically" line covered both — V5-QA. */}
      <p
        data-testid="tracking-draft-note"
        className="mb-3 flex items-start gap-1.5 rounded-md border border-secondary/40 bg-secondary/10 px-2.5 py-2 text-xs leading-relaxed text-foreground"
      >
        <i aria-hidden className="pi pi-info-circle mt-0.5 shrink-0 text-secondary" style={{ fontSize: 11 }} />
        {mc.trackingDraftNote}
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={mc.gtmLabel} hint={mc.gtmHelp}>
          <TextField
            data-testid="tracking-gtm"
            value={tracking.gtmId ?? ''}
            placeholder="GTM-XXXXXXX"
            maxLength={32}
            autoComplete="off"
            aria-label={mc.gtmLabel}
            onChange={(e) => commit('gtmId', e.target.value)}
          />
        </Field>
        <Field label={mc.metaLabel} hint={mc.metaHelp}>
          <TextField
            data-testid="tracking-meta"
            value={tracking.metaPixelId ?? ''}
            placeholder="123456789012345"
            maxLength={32}
            autoComplete="off"
            aria-label={mc.metaLabel}
            onChange={(e) => commit('metaPixelId', e.target.value)}
          />
        </Field>
        <Field label={mc.posthogKeyLabel} hint={mc.posthogKeyHelp}>
          <TextField
            data-testid="tracking-posthog-key"
            value={tracking.posthogKey ?? ''}
            placeholder="phc_..."
            maxLength={128}
            autoComplete="off"
            aria-label={mc.posthogKeyLabel}
            onChange={(e) => commit('posthogKey', e.target.value)}
          />
        </Field>
        <Field label={mc.posthogHostLabel} hint={mc.posthogHostHelp}>
          <TextField
            data-testid="tracking-posthog-host"
            value={hostDraft}
            placeholder="https://us.i.posthog.com"
            maxLength={256}
            autoComplete="off"
            aria-label={mc.posthogHostLabel}
            aria-invalid={hostInvalid || undefined}
            onChange={(e) => commitHost(e.target.value)}
          />
          {hostInvalid ? (
            <p className="text-xs text-destructive" role="alert">
              {mc.posthogHostInvalid}
            </p>
          ) : null}
        </Field>
        <Field label={mc.hubspotLabel} hint={mc.hubspotHelp}>
          <TextField
            data-testid="tracking-hubspot"
            value={tracking.hubspotTrackingId ?? ''}
            placeholder="12345678"
            maxLength={32}
            autoComplete="off"
            aria-label={mc.hubspotLabel}
            onChange={(e) => commit('hubspotTrackingId', e.target.value)}
          />
        </Field>
      </div>
      <p className="text-xs text-muted-foreground">
        <i aria-hidden className="pi pi-info-circle" style={{ fontSize: 11 }} /> {mc.utmNote}
      </p>
    </PanelSection>
  );
}
