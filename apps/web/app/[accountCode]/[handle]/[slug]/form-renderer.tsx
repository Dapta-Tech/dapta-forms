'use client';

/**
 * The public form experience — a mobile-first, one-question-per-screen flow
 * driven entirely by `@quill/engine` (visibleSteps/runtimeSteps/validate/score/
 * outcome), so the client and server agree on flow, score, and outcome. It walks
 * the engine's ordered visible steps, records the funnel event stream, persists a
 * partial submission past the lead-capture threshold and a complete one at the
 * end, then resolves the outcome bucket to a redirect or a thank-you screen.
 *
 * User-visible copy comes from the form CONFIG (localizable per form); only the
 * renderer chrome (buttons, errors, thank-you) is i18n'd via @quill/shared.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  runtimeSteps,
  validateAnswerCode,
  resolveOutcome,
  resolveEnding,
  computeScore,
  partialSubmitKey,
  revealAfterKey,
  nameFields,
  isMultiSelect,
  isSafeHttpUrl,
  showClientLogos,
  type Answers,
  type AnswerValue,
  type FormStep,
  type FormOutcome,
} from '@quill/engine';
import { onAccent, getMessages } from '@quill/shared';
import type { FormConfig } from '@quill/types';
import { FormLogo } from '@/components/public/form-logo';
import { FormProgress } from '@/components/public/form-progress';
import { ClientLogosMarquee } from '@/components/public/client-logos-marquee';
import { StepInput } from '@/components/public/step-input';
import { BookingScreen } from '@/components/public/booking-screen';
import { RevealScreen } from '@/components/public/reveal-screen';
import { warmBookingEmbed, type BookingScheduledDetails } from '@/lib/booking-embed';
import { resolveSchedulerPrefill } from '@/lib/booking-prefill';
import { submitFormAction, recordEventAction, recordBookingAction } from './actions';
import {
  useSessionId,
  captureUtm,
  capturePrefill,
  schedulerToBooking,
  PhaseShell,
  DoneScreen,
} from './renderer-shared';
import './public-form.css';

type Phase = 'cover' | 'steps' | 'reveal' | 'submitting' | 'booking' | 'done';

export function FormRenderer({
  accountCode,
  slug,
  name,
  config,
  locale = 'en',
}: {
  accountCode: string;
  slug: string;
  name: string;
  config: FormConfig;
  locale?: string;
}) {
  const m = getMessages(locale).renderer;
  const sessionId = useSessionId(`quill-form-${accountCode}-${slug}`);
  const cover = config.cover && config.cover.enabled !== false ? config.cover : null;

  const [phase, setPhase] = useState<Phase>(cover ? 'cover' : 'steps');
  const [answers, setAnswers] = useState<Answers>({});
  const [index, setIndex] = useState(0);
  const [animKey, setAnimKey] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ score: number; outcome: string | null } | null>(null);
  const [booking, setBooking] = useState<{ outcome: FormOutcome; score: number } | null>(null);

  const utmRef = useRef<Record<string, string>>({});
  const redirected = useRef(false); // a deferred redirect fires exactly once
  const viewTracked = useRef(false);
  const partialSent = useRef(false);
  const advancing = useRef(false);
  const submitAfterReveal = useRef(false);
  const bookedRef = useRef(false); // one booking → one callback + one redirect
  const schedulerBooked = useRef<Set<string>>(new Set()); // one booking per scheduler step
  const lastStepViewKey = useRef<string | null>(null);
  const engineConfig = config as unknown as Parameters<typeof runtimeSteps>[0];

  // Deferred redirect (V5-B1): "show the thank-you for N ms, then leave". The
  // screen is already rendered by the time this runs, so the respondent reads
  // the message and the navigation happens under them. Guarded by a ref so a
  // re-render cannot schedule a second one, and the timer is cleared on unmount
  // so leaving early never yanks the page out from under a later screen.
  useEffect(() => {
    if (phase !== 'done' || !done || redirected.current) return;
    const outcome = resolveOutcome(engineConfig, done.score, answers);
    const ending = resolveEnding(engineConfig, outcome);
    if (!ending.redirectUrl || ending.redirectDelayMs <= 0) return;
    if (!isSafeHttpUrl(ending.redirectUrl)) return;
    const url = ending.redirectUrl;
    const timer = setTimeout(() => {
      redirected.current = true;
      window.location.href = url;
    }, ending.redirectDelayMs);
    return () => clearTimeout(timer);
  }, [phase, done, engineConfig, answers]);

  // The engine decides the ordered, visible, display-resolved steps.
  const steps = useMemo<FormStep[]>(
    () => runtimeSteps(engineConfig, answers),
    [engineConfig, answers],
  );
  const step = steps[index];
  const thresholdKey = useMemo(() => partialSubmitKey(engineConfig), [engineConfig]);
  // BACK-COMPAT ONLY: where a LEGACY form-level reveal plays
  // (revealAfterStep → triggersReveal → default-last), null when there is none.
  // The builder no longer authors this shape — it folds an existing one into a
  // real `reveal` step on open (`migrateRevealToStep`) — but a form PUBLISHED
  // before that keeps its stored config until it is re-published, so the
  // interstitial has to keep playing for it. Never remove without a config
  // migration of every published form.
  const revealKey = useMemo(() => revealAfterKey(engineConfig), [engineConfig]);

  // Accent branding (only override the local default when a color is configured).
  const primary = config.branding?.primaryColor ?? null;
  const accentVars = primary
    ? ({ ['--pf-primary']: primary, ['--pf-primary-contrast']: onAccent(primary) } as React.CSSProperties)
    : undefined;

  const err = (code: string) => m.errors[code as keyof typeof m.errors] ?? m.errors.required;

  const track = useCallback(
    // `stepIndex` is the position in THIS session's runtimeSteps (visible-step)
    // array — meaningful for "was this the first question" (Starts), but not
    // stable across sessions once show/hide/goto logic branches differently.
    // `stepKey` is the step's authored, stable identity, so the drop-off table
    // can attribute a view to the actual question shown rather than to
    // whichever config step happens to sit at that position (V5-D3).
    (type: string, stepIndex?: number, stepKey?: string) => {
      if (!sessionId) return;
      void recordEventAction(accountCode, slug, {
        sessionId,
        type,
        stepIndex: stepIndex ?? null,
        stepKey: stepKey ?? null,
      });
    },
    [accountCode, slug, sessionId],
  );

  // Capture UTM + declared-field URL prefill once on mount (client-only, so a
  // seeded visible step never causes an SSR/hydration mismatch). Hidden steps
  // ride their seeded answer into the submission; visible steps render filled.
  useEffect(() => {
    utmRef.current = captureUtm();
    const seed = capturePrefill(engineConfig.steps);
    if (Object.keys(seed).length > 0) setAnswers((a) => ({ ...seed, ...a }));
  }, []);
  useEffect(() => {
    if (!sessionId || viewTracked.current) return;
    viewTracked.current = true;
    track('view');
  }, [sessionId, track]);

  // step_view once when a step becomes current — keyed by phase+index so an
  // answer keystroke (which recomputes `step`) never re-fires the same view.
  useEffect(() => {
    if (phase !== 'steps' || !step) return;
    const key = `${phase}:${index}`;
    if (lastStepViewKey.current === key) return;
    lastStepViewKey.current = key;
    track('step_view', index, step.key);
  }, [phase, index, step, track]);

  // Clamp the index if the visible-step set shrinks (a branch closed).
  useEffect(() => {
    if (phase === 'steps' && steps.length > 0 && index >= steps.length) {
      setIndex(steps.length - 1);
    }
  }, [phase, index, steps.length]);

  function withData(a: Answers): Record<string, unknown> {
    const utm = utmRef.current;
    return Object.keys(utm).length > 0 ? { ...a, utm } : { ...a };
  }

  const finalize = useCallback(
    async (finalAnswers: Answers) => {
      setPhase('submitting');
      const res = await submitFormAction(accountCode, slug, {
        sessionId,
        data: withData(finalAnswers),
      });
      if (!res.ok) {
        setError(res.message ?? err('submit'));
        setPhase('steps');
        return;
      }
      // Await the `submit` funnel event (best-effort) BEFORE any outcome
      // redirect: a fire-and-forget request here is aborted by the immediate
      // window.location navigation, silently losing the submit event for every
      // redirect outcome. Same persist-then-navigate pattern as handleBooked.
      if (sessionId) {
        await recordEventAction(accountCode, slug, {
          sessionId,
          type: 'submit',
          stepIndex: null,
        }).catch(() => {});
      }
      const score = res.score ?? 0;
      const outcome = resolveOutcome(engineConfig, score, finalAnswers);
      // An outcome with a booking config shows the inline scheduling screen
      // INSTEAD of redirecting; the redirect happens after the visitor books.
      if (outcome?.booking) {
        setDone({ score, outcome: res.outcome ?? null }); // pre-arm the done screen for after booking
        setBooking({ outcome, score });
        setPhase('booking');
        return;
      }
      // V5-B1: the destination is the outcome's, else the form-level ending's,
      // so a form can redirect everyone (or redirect with scoring off) without
      // repeating the URL on every range.
      const ending = resolveEnding(engineConfig, outcome);
      if (ending.redirectUrl) {
        // Runtime XSS guard: only navigate to http(s). A non-http(s) protocol
        // (javascript:/data:) is ignored + logged, falling through to the
        // thank-you screen (the schema also rejects it on save — belt-and-braces).
        if (isSafeHttpUrl(ending.redirectUrl)) {
          // A delay shows the thank-you screen first, then leaves. Zero (the
          // default, and every pre-V5 config) redirects immediately as before.
          if (ending.redirectDelayMs > 0) {
            setDone({ score, outcome: res.outcome ?? null });
            setPhase('done');
            return;
          }
          window.location.href = ending.redirectUrl;
          return;
        }
        console.warn('[forms] ignored non-http(s) redirectUrl');
      }
      setDone({ score, outcome: res.outcome ?? null });
      setPhase('done');
    },
    [accountCode, slug, sessionId, engineConfig],
  );

  // Report the booked meeting to the API (best-effort), THEN redirect/finish.
  const handleBooked = useCallback(
    async (details: BookingScheduledDetails) => {
      if (bookedRef.current) return;
      bookedRef.current = true;
      const outcome = booking?.outcome ?? null;
      await recordBookingAction(accountCode, slug, {
        sessionId,
        provider: details.provider,
        ...(details.eventUri ? { eventUri: details.eventUri } : {}),
        ...(details.inviteeUri ? { inviteeUri: details.inviteeUri } : {}),
        ...(details.startTime ? { startTime: details.startTime } : {}),
      });
      if (outcome?.redirectUrl && isSafeHttpUrl(outcome.redirectUrl)) {
        window.location.href = outcome.redirectUrl;
        return;
      }
      setPhase('done'); // `done` state was set in finalize
    },
    [accountCode, slug, sessionId, booking],
  );

  const advance = useCallback(
    async (nextAnswers: Answers, completed: FormStep) => {
      if (advancing.current) return;
      advancing.current = true;
      try {
        const nextSteps = runtimeSteps(engineConfig, nextAnswers);
        const completedIdx = nextSteps.findIndex((s) => s.key === completed.key);
        const isLast = completedIdx >= 0 ? completedIdx >= nextSteps.length - 1 : index >= nextSteps.length - 1;

        track('step_complete', index, completed.key);

        // Partial submit once past the configured lead-capture threshold.
        if (thresholdKey && completed.key === thresholdKey && !partialSent.current) {
          partialSent.current = true;
          track('partial_submit', index, completed.key);
          void submitFormAction(accountCode, slug, {
            sessionId,
            data: withData(nextAnswers),
            partial: true,
          });
        }

        // Terminal (disqualify) step → finalize now, skip the reveal screen.
        if (completed.terminal) {
          await finalize(nextAnswers);
          return;
        }

        // Optional processing/reveal interstitial after this step. Position is
        // resolved by the engine (revealAfterKey): the marker's revealAfterStep
        // wins, else a legacy triggersReveal step, else the last step. When the
        // reveal step is the last VISIBLE step it becomes the pre-result
        // interstitial (submitAfterReveal); otherwise it plays then continues.
        if (revealKey && completed.key === revealKey) {
          submitAfterReveal.current = isLast;
          if (!isLast) setIndex(completedIdx + 1);
          setPhase('reveal');
          return;
        }

        if (isLast) {
          await finalize(nextAnswers);
          return;
        }

        setAnimKey((k) => k + 1);
        setError(null);
        setIndex(completedIdx >= 0 ? completedIdx + 1 : Math.min(index + 1, nextSteps.length - 1));
      } finally {
        advancing.current = false;
      }
    },
    [engineConfig, index, thresholdKey, revealKey, accountCode, slug, sessionId, finalize, track],
  );

  // A booking on a SCHEDULER step (V6): record the meeting (booking_event + the
  // CRM booking_sync outbox, best-effort), make the booked slot this step's
  // answer (satisfies a required scheduler + lands in the submission data), then
  // advance exactly like any other step. If the scheduler is the last visible
  // step — or a goto rule routes it to the ending — `advance` finalizes the
  // submission as COMPLETE. That is how "booking → submit the form" works: via
  // the same logic as every other step, not a special case.
  const handleSchedulerBooked = useCallback(
    async (schedStep: FormStep, details: BookingScheduledDetails) => {
      if (schedulerBooked.current.has(schedStep.key)) return;
      schedulerBooked.current.add(schedStep.key);
      await recordBookingAction(accountCode, slug, {
        sessionId,
        provider: details.provider,
        ...(details.eventUri ? { eventUri: details.eventUri } : {}),
        ...(details.inviteeUri ? { inviteeUri: details.inviteeUri } : {}),
        ...(details.startTime ? { startTime: details.startTime } : {}),
      }).catch(() => {});
      const next = { ...answersRef.current, [schedStep.key]: details.startTime ?? 'booked' };
      setAnswers(next);
      await advance(next, schedStep);
    },
    [accountCode, slug, sessionId, advance],
  );

  function submitCurrent() {
    if (!step) return;
    const check = validateAnswerCode(step, answers[step.key], answers);
    if (!check.ok) {
      setError(err(check.code));
      return;
    }
    setError(null);
    void advance(answers, step);
  }

  // Choice/dropdown selection: record the answer and auto-advance.
  function select(value: string) {
    if (!step) return;
    const next = { ...answers, [step.key]: value };
    setAnswers(next);
    setError(null);
    void advance(next, step);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key !== 'Enter' || !step) return;
    // Single-select choices/dropdowns auto-advance on tap; a multi-select
    // choice (checkboxes) and a textarea let Enter submit the current answer.
    if (step.type === 'textarea' || step.type === 'dropdown') return;
    if (step.type === 'multiple_choice' && !isMultiSelect(step)) return;
    // Name: hop to the second field if the first is filled and the second empty.
    if (step.type === 'name') {
      const [, second] = nameFields(step);
      if (second && !String(answers[second] ?? '').trim()) {
        const inputs = (e.currentTarget as HTMLElement).querySelectorAll<HTMLInputElement>('.pf-name-fields .pf-input');
        if (document.activeElement === inputs[0] && inputs[1]) {
          e.preventDefault();
          inputs[1].focus();
          return;
        }
      }
    }
    e.preventDefault();
    submitCurrent();
  }

  function start() {
    track('start');
    lastStepViewKey.current = null;
    setPhase('steps');
    setIndex(0);
    setAnimKey((k) => k + 1);
  }

  function back() {
    setError(null);
    if (phase === 'steps' && index > 0) {
      setAnimKey((k) => k + 1);
      setIndex((i) => i - 1);
    } else if (phase === 'steps' && index === 0 && cover) {
      setPhase('cover');
    }
  }

  // Latest finalize + answers via refs so the reveal timer arms once per
  // reveal-phase entry (not on every answers change) without a stale closure.
  const finalizeRef = useRef(finalize);
  finalizeRef.current = finalize;
  const answersRef = useRef(answers);
  answersRef.current = answers;

  // The reveal screen owns its own timer (honoring reveal.durationMs) and
  // calls back exactly once when the bar fills: continue or finalize.
  const onRevealComplete = useCallback(() => {
    if (submitAfterReveal.current) {
      submitAfterReveal.current = false;
      void finalizeRef.current(answersRef.current);
    } else {
      setAnimKey((k) => k + 1);
      setPhase('steps');
    }
  }, []);

  // Pre-warm the booking embed while the interstitial plays: when the form
  // opts in (reveal.prewarm) and the PENDING outcome (client-side score over
  // the answers so far) hands off to a scheduler, warm its origins now so the
  // embed after submit paints faster. warmBookingEmbed is idempotent + safe.
  useEffect(() => {
    if (phase !== 'reveal') return;
    if (!config.reveal?.prewarm) return;
    const a = answersRef.current;
    const pending = resolveOutcome(engineConfig, computeScore(engineConfig, a), a);
    if (pending?.booking) warmBookingEmbed(pending.booking.provider, pending.booking.url);
  }, [phase, config.reveal?.prewarm, engineConfig]);

  // --- Screens --------------------------------------------------------------

  if (phase === 'done' && done) {
    const outcome = resolveOutcome(engineConfig, done.score, answersRef.current);
    // V5-B1: outcome copy → form-level ending copy → the built-in localized copy.
    const ending = resolveEnding(engineConfig, outcome);
    return (
      <DoneScreen
        ending={ending}
        answers={answersRef.current}
        m={m}
        accountCode={accountCode}
        cover={cover}
        style={accentVars}
      />
    );
  }

  if (phase === 'booking' && booking?.outcome.booking) {
    return (
      <PhaseShell className="pf pf--booking-page" style={accentVars} cover={cover}>
        <BookingScreen
          booking={booking.outcome.booking}
          answers={answersRef.current}
          sessionId={sessionId}
          locale={locale}
          onBooked={(details) => void handleBooked(details)}
        />
      </PhaseShell>
    );
  }

  if (phase === 'reveal') {
    return (
      <PhaseShell
        className="pf pf--reveal"
        style={accentVars}
        role="status"
        aria-live="polite"
        cover={cover}
      >
        <RevealScreen
          reveal={config.reveal}
          answers={answers}
          messages={{ headline: m.revealHeadline, subtitle: m.revealSubtitle }}
          onComplete={onRevealComplete}
        />
      </PhaseShell>
    );
  }

  if (phase === 'submitting') {
    return (
      <PhaseShell
        className="pf pf--reveal"
        style={accentVars}
        role="status"
        aria-live="polite"
        cover={cover}
      >
        <div className="pf-reveal__inner">
          <div className="pf-reveal__spinner" aria-hidden="true" />
          <p className="pf-reveal__subtitle">{m.submitting}</p>
        </div>
      </PhaseShell>
    );
  }

  if (phase === 'cover' && cover) {
    const logo = cover.logo ?? config.branding?.logo ?? null;
    const logos = showClientLogos(cover) ? (cover.clientLogos ?? config.branding?.clientLogos ?? []) : [];
    return (
      <PhaseShell
        className="pf pf--cover"
        style={accentVars}
        onKeyDown={(e) => e.key === 'Enter' && start()}
        tabIndex={-1}
        cover={cover}
        isCover
      >
        <header className="pf__cover-header">
          <FormLogo src={logo} name={name} />
        </header>
        <div className="pf__cover-main">
          <div className="pf__cover-content pf-animate">
            {cover.eyebrow || cover.badge ? (
              <p className="pf__badge">{cover.eyebrow ?? cover.badge}</p>
            ) : null}
            <h1 className="pf__title">{cover.headline ?? name}</h1>
            {cover.subheadline ? <p className="pf__subheadline">{cover.subheadline}</p> : null}
            {cover.trustBadge ? <p className="pf__trust">{cover.trustBadge}</p> : null}
          </div>
          <ClientLogosMarquee logos={logos} label={m.trustedBy} />
        </div>
        <div className="pf__cover-footer">
          <button type="button" className="pf__btn" onClick={start}>
            {cover.ctaText ?? m.start}
          </button>
        </div>
      </PhaseShell>
    );
  }

  if (!step) {
    return (
      <PhaseShell className="pf" style={accentVars}>
        <div className="pf__body">
          <p className="pf__helper">{m.noSteps}</p>
        </div>
      </PhaseShell>
    );
  }

  // A REVEAL step (V5-B3) is an interstitial, not a question: it renders the
  // same processing screen the legacy form-level reveal uses, owns its own timer
  // and advances itself. Handled here rather than as a `phase` because it lives
  // in `steps`, so Back, progress, and skip-logic all treat it like any other
  // step — which is the whole point of making it a step type.
  if (step.type === 'reveal') {
    return (
      <PhaseShell
        className="pf pf--reveal"
        style={accentVars}
        role="status"
        aria-live="polite"
        cover={cover}
      >
        <RevealScreen
          reveal={step.reveal ?? { enabled: true }}
          answers={answers}
          messages={{ headline: m.revealHeadline, subtitle: m.revealSubtitle }}
          onComplete={() => {
            // Completing an interstitial is completing a step: reuse `advance`
            // so the partial-submit threshold, forward jumps and the finalize
            // path all behave exactly as they do after a real question.
            void advance(answersRef.current, step);
          }}
        />
      </PhaseShell>
    );
  }

  // A SCHEDULER step (V6): a real question in the flow (back/progress/skip-logic
  // apply) whose input is a booking. The shared BookingScreen embeds the
  // provider widget; booking it answers the step and advances via `advance`, so a
  // required scheduler blocks Continue until booked and "on booking → submit" is
  // just the last-step / goto path. Rendered here (not a `phase`) for the same
  // reason as reveal — it lives in `steps`.
  if (step.type === 'scheduler') {
    // Resolve the author's field mapping once: built-ins overlay the answers,
    // the event type's custom questions ride their exact positional ids.
    // The steps are what makes "Automatic" work: it finds the answered email /
    // phone / name QUESTION rather than hoping the form used those exact keys.
    const schedPrefill = resolveSchedulerPrefill(
      answers,
      step.scheduler?.prefillMap,
      config.steps as FormStep[],
    );
    const booking = step.scheduler
      ? schedulerToBooking(step.scheduler, schedPrefill.customAnswers)
      : null;
    const schedLogo = cover?.logo ?? config.branding?.logo ?? null;
    return (
      <PhaseShell className="pf" style={accentVars} cover={cover}>
        <header className="pf__topbar">
          <div className="pf__topbar-inner">
            {index > 0 || cover ? (
              <button type="button" className="pf__back" onClick={back} aria-label={m.back}>
                ←
              </button>
            ) : (
              <span className="pf__back pf__back--placeholder" />
            )}
            <FormLogo src={schedLogo} name={name} />
            <span className="pf__back pf__back--placeholder" />
          </div>
          <FormProgress total={steps.length} currentIndex={index} locale={locale} />
        </header>
        <div className="pf__body">
          <div className="pf__inner">
            <div className="pf__content pf-animate" key={animKey}>
              <div className="pf__question-wrap">
                <h2 className="pf__question">{step.question ?? step.key}</h2>
                {step.helper ? <p className="pf__helper">{step.helper}</p> : null}
              </div>
              <div className="pf__fields">
                {booking ? (
                  <BookingScreen
                    booking={booking}
                    answers={schedPrefill.answers}
                    extraCustomAnswers={schedPrefill.customAnswers}
                    sessionId={sessionId}
                    locale={locale}
                    hideHeader
                    onBooked={(details) => void handleSchedulerBooked(step, details)}
                  />
                ) : (
                  <p className="pf__error" role="alert" data-testid="scheduler-unconfigured">
                    {m.schedulerUnconfigured}
                  </p>
                )}
                {!step.required ? (
                  <button
                    type="button"
                    className="pf__btn pf__btn--inline"
                    onClick={() => void advance(answers, step)}
                  >
                    {m.schedulerSkip}
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </PhaseShell>
    );
  }

  // Single-select choices and dropdowns auto-advance; everything else — incl. a
  // multi-select choice (pick several, then Continue) — shows the button.
  const autoAdvances = step.type === 'dropdown' || (step.type === 'multiple_choice' && !isMultiSelect(step));
  const showContinue = !autoAdvances;
  const logo = cover?.logo ?? config.branding?.logo ?? null;

  return (
    <PhaseShell className="pf" style={accentVars} onKeyDown={onKeyDown} cover={cover}>
      <header className="pf__topbar">
        <div className="pf__topbar-inner">
          {index > 0 || cover ? (
            <button type="button" className="pf__back" onClick={back} aria-label={m.back}>
              ←
            </button>
          ) : (
            <span className="pf__back pf__back--placeholder" />
          )}
          <FormLogo src={logo} name={name} />
          <span className="pf__back pf__back--placeholder" />
        </div>
        <FormProgress total={steps.length} currentIndex={index} locale={locale} />
      </header>

      <div className="pf__body">
        <div className="pf__inner">
          <div className="pf__content pf-animate" key={animKey}>
            <div className="pf__question-wrap">
              <h2 className="pf__question">{step.question ?? step.key}</h2>
              {step.helper && step.type !== 'message' ? (
                <p className="pf__helper">{step.helper}</p>
              ) : null}
            </div>

            <div className="pf__fields">
              <StepInput
                step={step}
                value={answers[step.key]}
                answers={answers}
                onChange={(v: AnswerValue) => {
                  setAnswers((a) => ({ ...a, [step.key]: v }));
                  setError(null);
                }}
                onFieldChange={(field, v) => {
                  setAnswers((a) => ({ ...a, [field]: v }));
                  setError(null);
                }}
                onSelect={select}
                dropdownPlaceholder={m.dropdownPlaceholder}
                dropdownEmpty={m.dropdownEmpty}
                locale={locale}
              />

              {error ? (
                <p className="pf__error" role="alert">
                  {error}
                </p>
              ) : null}

              {showContinue ? (
                <button type="button" className="pf__btn pf__btn--inline" onClick={submitCurrent}>
                  {step.buttonText ?? (index + 1 === steps.length ? m.submit : m.next)}
                </button>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </PhaseShell>
  );
}
