'use client';

/**
 * The public form experience for `config.layout = 'vertical'` — every visible
 * question on ONE page, answered in any order and submitted once, driven by the
 * SAME engine walk as the slides layout (`runtimeSteps` recomputed on every
 * answer), so skip-logic, goto jumps, dynamic question variants and branch
 * closing all apply live: questions show and hide as the respondent types.
 *
 * Layout-specific decisions (vs `form-renderer.tsx`):
 *  - The cover renders as a HERO header (headline/subheadline/logos) — there is
 *    no gate screen and its `ctaText` is ignored.
 *  - Reveal steps never render mid-page; one reveal (a reveal step's config,
 *    else the legacy form-level reveal) plays AFTER Submit, before the result.
 *  - A `terminal` step with an answer hides everything after it (the respondent
 *    can still change their answer); it never auto-submits.
 *  - Validation is inline: blur validates a touched question, Submit validates
 *    the whole walk and scrolls to the first invalid question.
 *
 * Funnel events keep their metric semantics (see packages/db/src/analytics.ts):
 *  - `step_view` fires when a question ENTERS THE VIEWPORT (once per step) —
 *    index 0 on load matches a cover-less slides form, where the first question
 *    is also visible immediately, so "Starts" stays comparable across layouts.
 *  - `step_complete` fires when a question first holds a VALID answer (instant
 *    inputs on change, free-text inputs on blur).
 *  - `partial_submit` fires when the threshold step's answer becomes valid.
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
  isSafeHttpUrl,
  type Answers,
  type AnswerValue,
  type FormStep,
  type FormOutcome,
  type FormReveal,
} from '@quill/engine';
import { getMessages, t } from '@quill/shared';
import type { FormConfig } from '@quill/types';
import { FormLogo } from '@/components/public/form-logo';
import { ClientLogosMarquee } from '@/components/public/client-logos-marquee';
import { StepInput } from '@/components/public/step-input';
import { BookingScreen } from '@/components/public/booking-screen';
import { RevealScreen } from '@/components/public/reveal-screen';
import { formDesignProps } from '@/lib/form-design';
import { warmBookingEmbed, type BookingScheduledDetails } from '@/lib/booking-embed';
import { resolveSchedulerPrefill } from '@/lib/booking-prefill';
import { submitFormAction, recordEventAction, recordBookingAction } from './actions';
import {
  useSessionId,
  captureUtm,
  captureDefaults,
  capturePrefill,
  schedulerToBooking,
  PhaseShell,
  DoneScreen,
} from './renderer-shared';
import './public-form.css';

type Phase = 'form' | 'reveal' | 'submitting' | 'booking' | 'done';

/**
 * Does the respondent's answer to this step hold ANY content yet? Drives the
 * progress counter, the terminal cut and the completion events — deliberately
 * weaker than validity (a half-typed email "has content" but isn't complete).
 */
function hasContent(step: FormStep, answers: Answers): boolean {
  if (step.type === 'name') {
    return nameFields(step).some((f) => String(answers[f] ?? '').trim() !== '');
  }
  const v = answers[step.key];
  if (Array.isArray(v)) return v.length > 0;
  return v != null && String(v).trim() !== '';
}

/**
 * Fire `cb` once, the first time the element is meaningfully on screen. The
 * step_view signal for the vertical layout: visibility replaces "became the
 * current slide". Falls back to firing immediately where IntersectionObserver
 * is unavailable (old embeds/test DOMs) so the funnel never silently loses rows.
 */
function useFirstVisible(cb: () => void) {
  const ref = useRef<HTMLDivElement | null>(null);
  const fired = useRef(false);
  const cbRef = useRef(cb);
  cbRef.current = cb;
  useEffect(() => {
    if (fired.current || !ref.current) return;
    if (typeof IntersectionObserver === 'undefined') {
      fired.current = true;
      cbRef.current();
      return;
    }
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting && !fired.current) {
            fired.current = true;
            obs.disconnect();
            cbRef.current();
          }
        }
      },
      // Low threshold on purpose: a question taller than the viewport (a
      // scheduler embed) may never reach a high visible ratio.
      { threshold: 0.2 },
    );
    obs.observe(ref.current);
    return () => obs.disconnect();
  }, []);
  return ref;
}

/** Mounts children only once the wrapper is NEAR the viewport (lazy embeds). */
function NearViewport({ children, placeholder }: { children: React.ReactNode; placeholder: React.ReactNode }) {
  const [near, setNear] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (near || !ref.current) return;
    if (typeof IntersectionObserver === 'undefined') {
      setNear(true);
      return;
    }
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setNear(true);
          obs.disconnect();
        }
      },
      // Start loading a screen ahead so the embed is usually ready on arrival.
      { rootMargin: '600px 0px' },
    );
    obs.observe(ref.current);
    return () => obs.disconnect();
  }, [near]);
  return <div ref={ref}>{near ? children : placeholder}</div>;
}

export function VerticalFormRenderer({
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

  const [phase, setPhase] = useState<Phase>('form');
  const [answers, setAnswers] = useState<Answers>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [done, setDone] = useState<{ score: number; outcome: string | null } | null>(null);
  const [booking, setBooking] = useState<{ outcome: FormOutcome; score: number } | null>(null);

  const utmRef = useRef<Record<string, string>>({});
  const redirected = useRef(false); // a deferred redirect fires exactly once
  const viewTracked = useRef(false);
  const startTracked = useRef(false);
  // Keys whose answer was SEEDED, not typed (a slider's mount-time default).
  // A seeded value submits, but it is not "answered by the respondent": it must
  // not tick the progress counter and must never trip a terminal cut on load.
  // Any real interaction with the step removes it from this set.
  const seededKeys = useRef<Set<string>>(new Set());
  const partialSent = useRef(false);
  const completeSent = useRef<Set<string>>(new Set()); // one step_complete per step
  const stepViewSent = useRef<Set<string>>(new Set()); // one step_view per step
  const bookedRef = useRef(false); // one booking → one callback + one redirect
  const schedulerBooked = useRef<Set<string>>(new Set()); // one booking per scheduler step
  const engineConfig = config as unknown as Parameters<typeof runtimeSteps>[0];

  // The engine decides the ordered, visible, display-resolved steps — recomputed
  // on every answer, which is what makes show/hide live on one page.
  const steps = useMemo<FormStep[]>(
    () => runtimeSteps(engineConfig, answers),
    [engineConfig, answers],
  );

  /** Answered by the RESPONDENT — a seeded (untouched) default doesn't count. */
  const answeredByUser = (s: FormStep) => hasContent(s, answers) && !seededKeys.current.has(s.key);

  // Terminal cut (disqualify): once a terminal step holds an answer, everything
  // after it leaves the page. Unlike slides it does NOT auto-finalize — the
  // respondent keeps the Submit button and may still change their answer.
  const walk = useMemo<FormStep[]>(() => {
    const cut = steps.findIndex((s) => s.terminal && hasContent(s, answers) && !seededKeys.current.has(s.key));
    return cut >= 0 ? steps.slice(0, cut + 1) : steps;
  }, [steps, answers]);

  // Reveal steps are interstitials — never inline questions on this layout.
  const questions = useMemo(() => walk.filter((s) => s.type !== 'reveal'), [walk]);
  const answerable = useMemo(() => questions.filter((s) => s.type !== 'message'), [questions]);
  const answeredCount = answerable.filter(answeredByUser).length;

  // The one reveal that may play after Submit: a reveal STEP in the current walk
  // (its own copy/duration), else the legacy form-level reveal when enabled.
  const pendingReveal = useMemo<FormReveal | null>(() => {
    const revealStep = steps.find((s) => s.type === 'reveal');
    if (revealStep) return revealStep.reveal ?? { enabled: true };
    return revealAfterKey(engineConfig) ? (config.reveal ?? null) : null;
  }, [steps, engineConfig, config.reveal]);

  const thresholdKey = useMemo(() => partialSubmitKey(engineConfig), [engineConfig]);

  // The form's whole look — colors, typeface, shape, background treatment —
  // resolved once and applied to every phase root below, exactly as the slides
  // layout does. Before this the vertical form carried only the accent, so an
  // author who set a background, a font or a corner radius saw none of it here.
  const design = useMemo(() => formDesignProps(config.branding), [config.branding]);

  const err = (code: string) => m.errors[code as keyof typeof m.errors] ?? m.errors.required;

  const track = useCallback(
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

  // Latest answers via a ref for callbacks armed once (reveal, booking, done).
  const answersRef = useRef(answers);
  answersRef.current = answers;

  function withData(a: Answers): Record<string, unknown> {
    const utm = utmRef.current;
    return Object.keys(utm).length > 0 ? { ...a, utm } : { ...a };
  }

  // Capture UTM + declared-field URL prefill once on mount (client-only, so a
  // seeded visible step never causes an SSR/hydration mismatch).
  useEffect(() => {
    utmRef.current = captureUtm();
    // Defaults first, then the URL on top: a link that names a value must beat
    // a default the author configured earlier.
    const seed = { ...captureDefaults(engineConfig.steps), ...capturePrefill(engineConfig.steps) };
    if (Object.keys(seed).length > 0) setAnswers((a) => ({ ...seed, ...a }));
  }, []);
  useEffect(() => {
    if (!sessionId || viewTracked.current) return;
    viewTracked.current = true;
    track('view');
  }, [sessionId, track]);

  const finalize = useCallback(
    async (finalAnswers: Answers) => {
      setPhase('submitting');
      const res = await submitFormAction(accountCode, slug, {
        sessionId,
        data: withData(finalAnswers),
      });
      if (!res.ok) {
        setSubmitError(res.message ?? err('submit'));
        setPhase('form');
        return;
      }
      // Await the `submit` funnel event (best-effort) BEFORE any outcome
      // redirect — a fire-and-forget request would be aborted by the immediate
      // window.location navigation (same pattern as the slides layout).
      if (sessionId) {
        await recordEventAction(accountCode, slug, {
          sessionId,
          type: 'submit',
          stepIndex: null,
        }).catch(() => {});
      }
      const score = res.score ?? 0;
      const outcome = resolveOutcome(engineConfig, score, finalAnswers);
      if (outcome?.booking) {
        setDone({ score, outcome: res.outcome ?? null }); // pre-arm the done screen
        setBooking({ outcome, score });
        setPhase('booking');
        return;
      }
      const ending = resolveEnding(engineConfig, outcome);
      if (ending.redirectUrl) {
        if (isSafeHttpUrl(ending.redirectUrl)) {
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
  const finalizeRef = useRef(finalize);
  finalizeRef.current = finalize;

  // Deferred redirect (V5-B1): show the thank-you for N ms, then leave.
  useEffect(() => {
    if (phase !== 'done' || !done || redirected.current) return;
    const outcome = resolveOutcome(engineConfig, done.score, answersRef.current);
    const ending = resolveEnding(engineConfig, outcome);
    if (!ending.redirectUrl || ending.redirectDelayMs <= 0) return;
    if (!isSafeHttpUrl(ending.redirectUrl)) return;
    const url = ending.redirectUrl;
    const timer = setTimeout(() => {
      redirected.current = true;
      window.location.href = url;
    }, ending.redirectDelayMs);
    return () => clearTimeout(timer);
  }, [phase, done, engineConfig]);

  // Pre-warm the booking embed while the interstitial plays (reveal.prewarm).
  useEffect(() => {
    if (phase !== 'reveal') return;
    if (!pendingReveal?.prewarm) return;
    const a = answersRef.current;
    const pending = resolveOutcome(engineConfig, computeScore(engineConfig, a), a);
    if (pending?.booking) warmBookingEmbed(pending.booking.provider, pending.booking.url);
  }, [phase, pendingReveal?.prewarm, engineConfig]);

  /**
   * A question first holds a valid answer → `step_complete` (once), and the
   * threshold question → `partial_submit` + the partial save. Called with the
   * NEXT answers (state updates are async) from instant inputs on change and
   * from free-text inputs on blur.
   */
  const markCompleteIfValid = useCallback(
    (step: FormStep, nextAnswers: Answers) => {
      if (step.type === 'message' || step.type === 'reveal') return;
      if (!hasContent(step, nextAnswers)) return;
      if (!validateAnswerCode(step, nextAnswers[step.key], nextAnswers).ok) return;
      const idx = runtimeSteps(engineConfig, nextAnswers).findIndex((s) => s.key === step.key);
      if (!completeSent.current.has(step.key)) {
        completeSent.current.add(step.key);
        track('step_complete', idx >= 0 ? idx : undefined, step.key);
      }
      if (thresholdKey && step.key === thresholdKey && !partialSent.current) {
        partialSent.current = true;
        track('partial_submit', idx >= 0 ? idx : undefined, step.key);
        void submitFormAction(accountCode, slug, {
          sessionId,
          data: withData(nextAnswers),
          partial: true,
        });
      }
    },
    [engineConfig, thresholdKey, accountCode, slug, sessionId, track],
  );

  /** Every answer mutation funnels through here: start signal + error clearing. */
  function setAnswer(step: FormStep, key: string, value: AnswerValue, instant: boolean) {
    seededKeys.current.delete(step.key); // a real interaction "claims" the answer
    if (!startTracked.current) {
      startTracked.current = true;
      track('start');
    }
    const next = { ...answersRef.current, [key]: value };
    // Keep the ref fresh SYNCHRONOUSLY: a blur handler can run before React
    // re-renders (where the ref is normally reassigned), and it must validate
    // the value just typed, not the previous one.
    answersRef.current = next;
    setAnswers(next);
    setSubmitError(null);
    setErrors((e) => {
      if (!(step.key in e)) return e;
      const rest = { ...e };
      delete rest[step.key];
      return rest;
    });
    // Instant inputs (choice/dropdown/slider) complete on selection; free-text
    // inputs complete on blur so a half-typed value never fires the event.
    if (instant) markCompleteIfValid(step, next);
  }

  /** Blur leaves a question: validate it if it holds content or already errored. */
  function onQuestionBlur(step: FormStep, e: React.FocusEvent<HTMLDivElement>) {
    // Moving focus WITHIN the question (name's two fields) is not leaving it.
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    if (step.type === 'message' || step.type === 'reveal' || step.type === 'scheduler') return;
    const a = answersRef.current;
    if (hasContent(step, a) || errors[step.key]) {
      const check = validateAnswerCode(step, a[step.key], a);
      setErrors((prev) => {
        const rest = { ...prev };
        if (check.ok) delete rest[step.key];
        else rest[step.key] = check.code;
        return rest;
      });
      if (check.ok) markCompleteIfValid(step, a);
    }
  }

  // A booking on a SCHEDULER step: record the meeting (best-effort), make the
  // booked slot this step's answer. No advancing here — submission is still the
  // respondent's explicit Submit at the end of the page.
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
      setAnswer(schedStep, schedStep.key, details.startTime ?? 'booked', true);
    },
    [accountCode, slug, sessionId],
  );

  // Report the post-submit outcome booking, THEN redirect/finish (same as slides).
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

  /** Submit the whole page: validate the walk, scroll to the first error. */
  async function submitAll() {
    const a = answersRef.current;
    const errs: Record<string, string> = {};
    let firstBad: string | null = null;
    for (const s of walk) {
      if (s.type === 'message' || s.type === 'reveal') continue;
      const check = validateAnswerCode(s, a[s.key], a);
      if (!check.ok) {
        errs[s.key] = check.code;
        firstBad = firstBad ?? s.key;
      }
    }
    setErrors(errs);
    if (firstBad) {
      setSubmitError(m.verticalErrors);
      document
        .querySelector(`[data-vf-step="${CSS.escape(firstBad)}"]`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    setSubmitError(null);
    // Every valid answer is now definitively complete — sweep the walk so a
    // question the respondent filled but never blurred (typed then hit Submit)
    // still records its step_complete / partial_submit before the submission.
    for (const s of walk) markCompleteIfValid(s, a);
    if (pendingReveal && pendingReveal.enabled !== false) {
      setPhase('reveal');
      return;
    }
    await finalize(a);
  }

  const onRevealComplete = useCallback(() => {
    void finalizeRef.current(answersRef.current);
  }, []);

  // --- Screens --------------------------------------------------------------

  if (phase === 'done' && done) {
    const outcome = resolveOutcome(engineConfig, done.score, answersRef.current);
    const ending = resolveEnding(engineConfig, outcome);
    return (
      <DoneScreen
        ending={ending}
        answers={answersRef.current}
        m={m}
        accountCode={accountCode}
        cover={cover}
        design={design}
      />
    );
  }

  if (phase === 'booking' && booking?.outcome.booking) {
    return (
      <PhaseShell className="pf pf--booking-page" design={design} cover={cover}>
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
        design={design}
        role="status"
        aria-live="polite"
        cover={cover}
      >
        <RevealScreen
          reveal={pendingReveal ?? { enabled: true }}
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
        design={design}
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

  const logo = cover?.logo ?? config.branding?.logo ?? null;
  const logos = cover?.clientLogos ?? config.branding?.clientLogos ?? [];
  const total = answerable.length;

  return (
    <div className="pf pf--vertical" {...design.attrs} style={design.style}>
      {/* An author-supplied face has to be declared in the document. This root
          is not a PhaseShell, so it declares its own. */}
      {design.fontFace ? <style>{design.fontFace}</style> : null}
      {/* Banner + progress share ONE sticky group so they never fight for the
          viewport top; the banner's own sticky is neutralized on this layout. */}
      <div className="pf-v__sticky">
        {/* The one page is simultaneously the cover and the form, so both
            banner scopes show it here (showBanner(cover, true) === has text);
            the post-submit phases defer to the scope via the shared shell. */}
        {cover?.bannerText ? <div className="pf__banner">{cover.bannerText}</div> : null}
        {total > 0 ? (
          <div className="pf-v__progressbar">
            <div className="pf-progress" aria-hidden="true">
              <div className="pf-progress__track">
                <div
                  className="pf-progress__fill"
                  style={{ width: `${total > 0 ? Math.round((answeredCount / total) * 100) : 0}%` }}
                />
              </div>
            </div>
            <span className="pf-v__progress-label" aria-live="polite">
              {t(m.verticalProgress, { answered: answeredCount, total })}
            </span>
          </div>
        ) : null}
      </div>

      <div className="pf__main">
        <div className="pf-v__page">
          <header className="pf-v__header">
            <FormLogo src={logo} name={name} />
          </header>

          {cover ? (
            <section className="pf-v__hero pf-animate">
              {cover.eyebrow || cover.badge ? (
                <p className="pf__badge">{cover.eyebrow ?? cover.badge}</p>
              ) : null}
              <h1 className="pf__title">{cover.headline ?? name}</h1>
              {cover.subheadline ? <p className="pf__subheadline">{cover.subheadline}</p> : null}
              {cover.trustBadge ? <p className="pf__trust">{cover.trustBadge}</p> : null}
              <ClientLogosMarquee logos={logos} label={m.trustedBy} />
            </section>
          ) : null}

          {questions.length === 0 ? (
            <p className="pf__helper">{m.noSteps}</p>
          ) : (
            questions.map((step) => (
              <VerticalQuestion
                key={step.key}
                step={step}
                index={steps.findIndex((s) => s.key === step.key)}
                error={errors[step.key] ? err(errors[step.key] as string) : null}
                stepViewSent={stepViewSent}
                track={track}
                onBlur={(e) => onQuestionBlur(step, e)}
              >
                {step.type === 'scheduler' ? (
                  <SchedulerQuestion
                    step={step}
                    config={config}
                    answers={answers}
                    sessionId={sessionId}
                    locale={locale}
                    unconfiguredLabel={m.schedulerUnconfigured}
                    onBooked={(details) => void handleSchedulerBooked(step, details)}
                  />
                ) : (
                  <StepInput
                    step={step}
                    value={answers[step.key]}
                    answers={answers}
                    autoFocus={false}
                    // Mount-time seeding (slider default) is not an interaction:
                    // write the answer silently — no start/complete events, no
                    // progress tick, no terminal cut (seededKeys).
                    onSeed={(v: AnswerValue) => {
                      seededKeys.current.add(step.key);
                      setAnswers((a) => ({ ...a, [step.key]: v }));
                    }}
                    onChange={(v: AnswerValue) =>
                      setAnswer(step, step.key, v, step.type === 'slider' || step.type === 'multiple_choice')
                    }
                    onFieldChange={(field, v) => setAnswer(step, field, v, false)}
                    onSelect={(v) => setAnswer(step, step.key, v, true)}
                    dropdownPlaceholder={m.dropdownPlaceholder}
                    dropdownEmpty={m.dropdownEmpty}
                    locale={locale}
                  />
                )}
              </VerticalQuestion>
            ))
          )}

          {questions.length > 0 ? (
            <div className="pf-v__footer">
              {submitError ? (
                <p className="pf__error" role="alert">
                  {submitError}
                </p>
              ) : null}
              <button type="button" className="pf__btn" onClick={() => void submitAll()}>
                {m.submit}
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/**
 * One question block: heading, helper, the input, its inline error — and the
 * once-per-step `step_view` fired when the block first enters the viewport.
 */
function VerticalQuestion({
  step,
  index,
  error,
  stepViewSent,
  track,
  onBlur,
  children,
}: {
  step: FormStep;
  index: number;
  error: string | null;
  stepViewSent: React.MutableRefObject<Set<string>>;
  track: (type: string, stepIndex?: number, stepKey?: string) => void;
  onBlur: (e: React.FocusEvent<HTMLDivElement>) => void;
  children: React.ReactNode;
}) {
  const ref = useFirstVisible(() => {
    if (stepViewSent.current.has(step.key)) return;
    stepViewSent.current.add(step.key);
    track('step_view', index >= 0 ? index : undefined, step.key);
  });

  return (
    <section
      ref={ref}
      className={`pf-v__question${error ? ' pf-v__question--error' : ''}`}
      data-vf-step={step.key}
      onBlur={onBlur}
    >
      <div className="pf__question-wrap">
        <h2 className="pf__question">
          {step.question ?? step.key}
          {step.required && step.type !== 'message' ? (
            <span aria-hidden className="pf-v__required">
              *
            </span>
          ) : null}
        </h2>
        {step.helper && step.type !== 'message' ? <p className="pf__helper">{step.helper}</p> : null}
      </div>
      <div className="pf__fields">
        {children}
        {error ? (
          <p className="pf__error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </section>
  );
}

/**
 * A scheduler step inline on the page. The provider iframe is heavy, so it
 * mounts lazily as the block approaches the viewport; until then a quiet
 * placeholder holds the layout. Booking answers the step (no auto-advance).
 */
function SchedulerQuestion({
  step,
  config,
  answers,
  sessionId,
  locale,
  unconfiguredLabel,
  onBooked,
}: {
  step: FormStep;
  config: FormConfig;
  answers: Answers;
  sessionId: string;
  locale: string;
  unconfiguredLabel: string;
  onBooked: (details: BookingScheduledDetails) => void;
}) {
  const schedPrefill = resolveSchedulerPrefill(
    answers,
    step.scheduler?.prefillMap,
    config.steps as FormStep[],
  );
  const booking = step.scheduler
    ? schedulerToBooking(step.scheduler, schedPrefill.customAnswers)
    : null;
  if (!booking) {
    return (
      <p className="pf__error" role="alert" data-testid="scheduler-unconfigured">
        {unconfiguredLabel}
      </p>
    );
  }
  return (
    <NearViewport placeholder={<div className="pf-v__embed-placeholder" aria-hidden="true" />}>
      <BookingScreen
        booking={booking}
        answers={schedPrefill.answers}
        extraCustomAnswers={schedPrefill.customAnswers}
        sessionId={sessionId}
        locale={locale}
        hideHeader
        onBooked={onBooked}
      />
    </NearViewport>
  );
}
