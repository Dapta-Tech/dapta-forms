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
  partialSubmitKey,
  nameFields,
  type Answers,
  type AnswerValue,
  type FormStep,
} from '@quill/engine';
import { onAccent, getMessages, t } from '@quill/shared';
import type { FormConfig } from '@quill/types';
import { signupHref } from '@/lib/growth';
import { FormLogo } from '@/components/public/form-logo';
import { FormProgress } from '@/components/public/form-progress';
import { ClientLogosMarquee } from '@/components/public/client-logos-marquee';
import { StepInput } from '@/components/public/step-input';
import { submitFormAction, recordEventAction } from './actions';
import './public-form.css';

type Phase = 'cover' | 'steps' | 'reveal' | 'submitting' | 'done';
const REVEAL_MS = 2200;

function useSessionId(key: string): string {
  const [id] = useState(() => {
    if (typeof window === 'undefined') return '';
    const existing = window.sessionStorage.getItem(key);
    if (existing) return existing;
    const fresh = crypto.randomUUID();
    window.sessionStorage.setItem(key, fresh);
    return fresh;
  });
  return id;
}

/** Read `utm_*` query params from the current URL into a flat string map. */
function captureUtm(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  const params = new URLSearchParams(window.location.search);
  const utm: Record<string, string> = {};
  for (const [k, v] of params.entries()) {
    if (k.toLowerCase().startsWith('utm_') && v) utm[k] = v;
  }
  return utm;
}

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

  const utmRef = useRef<Record<string, string>>({});
  const viewTracked = useRef(false);
  const partialSent = useRef(false);
  const advancing = useRef(false);
  const submitAfterReveal = useRef(false);
  const lastStepViewKey = useRef<string | null>(null);
  const engineConfig = config as unknown as Parameters<typeof runtimeSteps>[0];

  // The engine decides the ordered, visible, display-resolved steps.
  const steps = useMemo<FormStep[]>(
    () => runtimeSteps(engineConfig, answers),
    [engineConfig, answers],
  );
  const step = steps[index];
  const thresholdKey = useMemo(() => partialSubmitKey(engineConfig), [engineConfig]);

  // Accent branding (only override the local default when a color is configured).
  const primary = config.branding?.primaryColor ?? null;
  const accentVars = primary
    ? ({ ['--pf-primary']: primary, ['--pf-primary-contrast']: onAccent(primary) } as React.CSSProperties)
    : undefined;

  const err = (code: string) => m.errors[code as keyof typeof m.errors] ?? m.errors.required;

  const track = useCallback(
    (type: string, stepIndex?: number) => {
      if (!sessionId) return;
      void recordEventAction(accountCode, slug, { sessionId, type, stepIndex: stepIndex ?? null });
    },
    [accountCode, slug, sessionId],
  );

  // Capture UTM once, and fire a single `view` per session per load.
  useEffect(() => {
    utmRef.current = captureUtm();
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
    track('step_view', index);
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
      track('submit');
      const score = res.score ?? 0;
      const outcome = resolveOutcome(engineConfig, score);
      if (outcome?.redirectUrl) {
        window.location.href = outcome.redirectUrl;
        return;
      }
      setDone({ score, outcome: res.outcome ?? null });
      setPhase('done');
    },
    [accountCode, slug, sessionId, engineConfig, track],
  );

  const advance = useCallback(
    async (nextAnswers: Answers, completed: FormStep) => {
      if (advancing.current) return;
      advancing.current = true;
      try {
        const nextSteps = runtimeSteps(engineConfig, nextAnswers);
        const completedIdx = nextSteps.findIndex((s) => s.key === completed.key);
        const isLast = completedIdx >= 0 ? completedIdx >= nextSteps.length - 1 : index >= nextSteps.length - 1;

        track('step_complete', index);

        // Partial submit once past the configured lead-capture threshold.
        if (thresholdKey && completed.key === thresholdKey && !partialSent.current) {
          partialSent.current = true;
          track('partial_submit', index);
          void submitFormAction(accountCode, slug, {
            sessionId,
            data: withData(nextAnswers),
            partial: true,
          });
        }

        // Terminal (disqualify) step → finalize now, skip reveal/booking.
        if (completed.terminal) {
          await finalize(nextAnswers);
          return;
        }

        // Optional processing/reveal interstitial after this step.
        const reveal = config.reveal && config.reveal.enabled !== false;
        if (reveal && completed.triggersReveal) {
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
    [engineConfig, index, thresholdKey, accountCode, slug, sessionId, config.reveal, finalize, track],
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
    if (step.type === 'textarea' || step.type === 'dropdown' || step.type === 'multiple_choice') return;
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

  // Drive the reveal interstitial: after REVEAL_MS, continue or finalize.
  useEffect(() => {
    if (phase !== 'reveal') return;
    const timer = setTimeout(() => {
      if (submitAfterReveal.current) {
        submitAfterReveal.current = false;
        void finalize(answers);
      } else {
        setAnimKey((k) => k + 1);
        setPhase('steps');
      }
    }, REVEAL_MS);
    return () => clearTimeout(timer);
  }, [phase]);

  // --- Screens --------------------------------------------------------------

  if (phase === 'done' && done) {
    const outcome = resolveOutcome(engineConfig, done.score);
    const cta = signupHref('confirmation', accountCode);
    return (
      <div className="pf pf--done" style={accentVars}>
        {cover?.bannerText ? <div className="pf__banner">{cover.bannerText}</div> : null}
        <div className="pf-done__inner pf-animate">
          <div className="pf-done__check" aria-hidden="true">
            ✓
          </div>
          <h1 className="pf-done__title">{outcome?.label ?? m.thankYouTitle}</h1>
          <p className="pf-done__body">{t(m.thankYouBody, { name })}</p>
          {cta ? (
            <>
              <p className="pf-done__cta-question">{m.ctaQuestion}</p>
              <a className="pf-done__cta" href={cta} target="_blank" rel="noopener noreferrer">
                {m.ctaAction}
                <span className="sr-only"> {m.newTab}</span>
              </a>
            </>
          ) : null}
        </div>
      </div>
    );
  }

  if (phase === 'reveal') {
    const reveal = config.reveal ?? {};
    return (
      <div className="pf pf--reveal" style={accentVars} role="status" aria-live="polite">
        {cover?.bannerText ? <div className="pf__banner">{cover.bannerText}</div> : null}
        <RevealBody
          headline={reveal.headline ?? m.revealHeadline}
          subtitle={reveal.subtitle ?? m.revealSubtitle}
        />
      </div>
    );
  }

  if (phase === 'submitting') {
    return (
      <div className="pf pf--reveal" style={accentVars} role="status" aria-live="polite">
        {cover?.bannerText ? <div className="pf__banner">{cover.bannerText}</div> : null}
        <div className="pf-reveal__inner">
          <div className="pf-reveal__spinner" aria-hidden="true" />
          <p className="pf-reveal__subtitle">{m.submitting}</p>
        </div>
      </div>
    );
  }

  if (phase === 'cover' && cover) {
    const logo = cover.logo ?? config.branding?.logo ?? null;
    const logos = cover.clientLogos ?? config.branding?.clientLogos ?? [];
    return (
      <div
        className="pf pf--cover"
        style={accentVars}
        onKeyDown={(e) => e.key === 'Enter' && start()}
        tabIndex={-1}
      >
        {cover.bannerText ? <div className="pf__banner">{cover.bannerText}</div> : null}
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
      </div>
    );
  }

  if (!step) {
    return (
      <div className="pf" style={accentVars}>
        <div className="pf__body">
          <p className="pf__helper">{m.noSteps}</p>
        </div>
      </div>
    );
  }

  const showContinue = step.type !== 'multiple_choice' && step.type !== 'dropdown';
  const logo = cover?.logo ?? config.branding?.logo ?? null;

  return (
    <div className="pf" style={accentVars} onKeyDown={onKeyDown}>
      {cover?.bannerText ? <div className="pf__banner">{cover.bannerText}</div> : null}
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
    </div>
  );
}

/** Reveal interstitial body with an animated determinate bar (generic copy). */
function RevealBody({ headline, subtitle }: { headline: string; subtitle: string }) {
  const [pct, setPct] = useState(4);
  useEffect(() => {
    const startedAt = Date.now();
    const id = setInterval(() => {
      const p = Math.min(100, Math.round(((Date.now() - startedAt) / REVEAL_MS) * 100));
      setPct(p);
      if (p >= 100) clearInterval(id);
    }, 60);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="pf-reveal__inner">
      <div className="pf-reveal__spinner" aria-hidden="true" />
      <h1 className="pf-reveal__headline">{headline}</h1>
      <p className="pf-reveal__subtitle">{subtitle}</p>
      <div className="pf-reveal__track">
        <div className="pf-reveal__fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
