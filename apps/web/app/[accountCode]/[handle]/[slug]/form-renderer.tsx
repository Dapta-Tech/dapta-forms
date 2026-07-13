'use client';

/**
 * Minimal public form renderer (ugly-but-working; Phase 1 brings the real UI).
 * Walks the visible steps with the engine (skip-logic + validation shared with
 * the server), posts funnel events, and submits via the server action. The
 * per-session id lives in sessionStorage so events + submission tie together.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  visibleSteps,
  validateAnswer,
  type Answers,
  type FormStep,
} from '@quill/engine';
import type { FormConfig } from '@quill/types';
import { submitFormAction, recordEventAction } from './actions';

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

export function FormRenderer({
  accountCode,
  slug,
  name,
  config,
}: {
  accountCode: string;
  slug: string;
  name: string;
  config: FormConfig;
}) {
  const sessionId = useSessionId(`quill-form-${accountCode}-${slug}`);
  const cover = config.cover?.enabled ? config.cover : null;
  const [started, setStarted] = useState(!cover);
  const [answers, setAnswers] = useState<Answers>({});
  const [index, setIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ score?: number; outcome?: string | null } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // The engine decides which steps are visible given the answers so far.
  const steps = useMemo(
    () => visibleSteps(config as never, answers) as FormStep[],
    [config, answers],
  );
  const step = steps[Math.min(index, Math.max(steps.length - 1, 0))];

  useEffect(() => {
    if (sessionId) void recordEventAction(accountCode, slug, { sessionId, type: 'view' });
  }, [sessionId, accountCode, slug]);

  function start() {
    setStarted(true);
    void recordEventAction(accountCode, slug, { sessionId, type: 'start' });
  }

  function setValue(value: string | number) {
    if (!step) return;
    setAnswers((a) => ({ ...a, [step.key]: value }));
    setError(null);
  }

  async function next() {
    if (!step) return;
    const check = validateAnswer(step, answers[step.key]);
    if (!check.ok) {
      setError(check.error);
      return;
    }
    void recordEventAction(accountCode, slug, { sessionId, type: 'step_complete', stepIndex: index });
    if (index + 1 < steps.length) {
      setIndex(index + 1);
      void recordEventAction(accountCode, slug, { sessionId, type: 'step_view', stepIndex: index + 1 });
      return;
    }
    // Final step → submit.
    setSubmitting(true);
    const res = await submitFormAction(accountCode, slug, { sessionId, data: answers as Record<string, unknown> });
    setSubmitting(false);
    if (!res.ok) {
      setError(res.message ?? 'Could not submit — please try again.');
      return;
    }
    void recordEventAction(accountCode, slug, { sessionId, type: 'submit' });
    setDone({ score: res.score, outcome: res.outcome });
  }

  if (done) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-md border border-border bg-card p-8 text-center">
        <h1 className="text-2xl font-semibold">Thank you!</h1>
        <p className="text-muted-foreground">Your responses to “{name}” were recorded.</p>
      </div>
    );
  }

  if (!started && cover) {
    return (
      <div className="flex flex-col items-center gap-4 rounded-md border border-border bg-card p-8 text-center">
        {cover.eyebrow ? (
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {cover.eyebrow}
          </span>
        ) : null}
        <h1 className="text-3xl font-semibold tracking-tight">{cover.headline ?? name}</h1>
        {cover.subheadline ? <p className="text-muted-foreground">{cover.subheadline}</p> : null}
        <button
          type="button"
          onClick={start}
          className="rounded-md bg-primary px-6 py-3 font-semibold text-primary-foreground active:scale-[0.98]"
        >
          {cover.ctaText ?? 'Start'}
        </button>
        {cover.trustBadge ? <p className="text-xs text-muted-foreground">{cover.trustBadge}</p> : null}
      </div>
    );
  }

  if (!step) {
    return <p className="text-center text-muted-foreground">This form has no steps yet.</p>;
  }

  const value = answers[step.key];

  return (
    <div className="flex flex-col gap-5 rounded-md border border-border bg-card p-8">
      {/* Progress dots across the currently-visible steps. */}
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={steps.length}
        aria-valuenow={index + 1}
        className="flex items-center gap-1.5"
      >
        {steps.map((s, i) => (
          <span
            key={s.key}
            className={`h-1.5 flex-1 rounded-full ${i <= index ? 'bg-primary' : 'bg-muted'}`}
          />
        ))}
      </div>

      <div className="flex flex-col gap-1">
        <h2 className="text-xl font-semibold">{step.question ?? step.key}</h2>
        {step.helper ? <p className="text-sm text-muted-foreground">{step.helper}</p> : null}
      </div>

      {step.type === 'message' ? null : step.type === 'dropdown' || step.type === 'multiple_choice' ? (
        <div className="flex flex-col gap-2">
          {(step.options ?? []).map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => setValue(o.value)}
              className={`rounded-md border px-4 py-3 text-left transition-colors ${
                value === o.value ? 'border-primary bg-primary/10' : 'border-border hover:border-primary'
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
      ) : step.type === 'slider' ? (
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={step.min ?? 0}
            max={step.max ?? 100}
            step={step.step ?? 1}
            value={Number(value ?? step.default ?? step.min ?? 0)}
            onChange={(e) => setValue(Number(e.target.value))}
            className="flex-1"
          />
          <span className="w-12 text-right font-mono text-sm">
            {String(value ?? step.default ?? step.min ?? 0)}
          </span>
        </div>
      ) : step.type === 'textarea' ? (
        <textarea
          value={String(value ?? '')}
          onChange={(e) => setValue(e.target.value)}
          placeholder={step.placeholder ?? undefined}
          rows={4}
          className="rounded-md border border-border bg-background px-3 py-2"
        />
      ) : (
        <input
          type={step.type === 'email' ? 'email' : step.type === 'phone' ? 'tel' : 'text'}
          value={String(value ?? '')}
          onChange={(e) => setValue(e.target.value)}
          placeholder={step.placeholder ?? undefined}
          className="rounded-md border border-border bg-background px-3 py-2"
        />
      )}

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => setIndex(Math.max(0, index - 1))}
          disabled={index === 0 || submitting}
          className="text-sm text-muted-foreground hover:text-foreground disabled:opacity-40"
        >
          Back
        </button>
        <button
          type="button"
          onClick={() => void next()}
          disabled={submitting}
          className="rounded-md bg-primary px-5 py-2.5 font-semibold text-primary-foreground active:scale-[0.98] disabled:opacity-50"
        >
          {submitting ? 'Submitting…' : index + 1 === steps.length ? (step.buttonText ?? 'Submit') : (step.buttonText ?? 'Next')}
        </button>
      </div>
    </div>
  );
}
