'use client';

/**
 * The first-run wizard: three questions, then the template the first form is
 * built from.
 *
 * It IS a Dapta form, not a page that resembles one. The chrome is the public
 * renderer's own — `.pf` shell, centred topbar with the mark, `pf__body` /
 * `pf__inner` rhythm — and the questions render through `StepInput`, the same
 * component a respondent meets. Two things follow from that, both of them the
 * reason for it: the first screen a new user sees demonstrates the product
 * they just signed up for, and it cannot drift away from the real thing,
 * because a change to how forms render changes this screen too.
 *
 * The stage bar takes `FormProgress`'s slot under the topbar. All three stages
 * are named from the first paint — seeing that there are three is what stops
 * the second question feeling like the fifth.
 *
 * There is NO skip on the questions. They are three taps, and an answer that can
 * be skipped is an answer most people skip, which would leave the column this
 * whole feature exists to fill mostly empty. The template screen offers "start
 * from scratch" instead, which is an honest choice rather than a way out.
 *
 * Every advance patches the server. That is deliberate and is the difference
 * between a funnel and a completion count: the person who quits on question two
 * never reaches the end to be recorded, and they are exactly the one worth
 * measuring.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import type { FormsMessages, Locale } from '@quill/shared';
import { StepInput } from '@/components/public/step-input';
import { FormsLockup, FormsMark } from '@/components/brand/forms-logo';
import { captureEvent } from '@/lib/product-analytics';
import { fill, wizardQuestions, wizardTemplates } from '@/lib/onboarding';
import { USE_CASE_TEMPLATE, type OnboardingUseCase } from '@quill/types';
import { saveOnboardingStepAction, completeOnboardingAction } from './actions';
// The renderer's own stylesheet. Every rule in it is scoped under `.pf`, so
// importing it here cannot leak into the dashboard — and it is what makes this
// screen identical to a real form rather than a careful imitation.
import '../[accountCode]/[handle]/[slug]/public-form.css';
import './onboarding.css';

type Messages = FormsMessages['admin']['onboarding'];

/** Which stage of the three the current screen belongs to. 1 is already done. */
const QUESTION_STAGE = 2;
const TEMPLATE_STAGE = 3;

export function OnboardingWizard({ messages: m, locale }: { messages: Messages; locale: Locale }) {
  const questions = useMemo(() => wizardQuestions(m), [m]);
  const templates = useMemo(() => wizardTemplates(m), [m]);

  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [template, setTemplate] = useState<string | null>(null);
  const [submitting, startSubmit] = useTransition();

  /** Past the last question is the template screen. */
  const onTemplates = index >= questions.length;
  const current = onTemplates ? null : questions[index];
  const stepKey = onTemplates ? 'template' : (current?.key ?? 'role');

  /**
   * The card the previous answer pre-selects. Recomputed rather than stored so
   * going back and changing the use case actually changes the recommendation —
   * a stale one would point at a template the person no longer asked for.
   */
  const recommended = useMemo(() => {
    const useCase = answers.useCase as OnboardingUseCase | undefined;
    return useCase ? USE_CASE_TEMPLATE[useCase] : null;
  }, [answers.useCase]);

  /**
   * Emit `step_viewed` once per screen ARRIVAL, not once per render.
   *
   * Without the ref this fires on every state change — a keystroke in the
   * industry search, a re-render from the transition — and the funnel's view
   * count becomes a typing-speed measurement. React also mounts effects twice in
   * development StrictMode, which the same guard absorbs.
   */
  const viewed = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (viewed.current.has(stepKey)) return;
    viewed.current.add(stepKey);
    captureEvent('onboarding_step_viewed', {
      step_key: stepKey,
      step_index: index,
      total_steps: questions.length + 1,
    });
    if (index !== 0) return;
    captureEvent('onboarding_started', { locale });
    // Claim the FIRST screen on arrival. Every later screen has its `lastStep`
    // written by the answer that led to it, but nothing precedes this one — so
    // without this patch, someone who opens the wizard and quits on question one
    // is indistinguishable in the database from someone who never opened it at
    // all. Those are opposite problems: one is a wizard failing, the other is a
    // signup that never arrived.
    //
    // Safe to fire alongside `answer`'s patch because it only ever runs for
    // index 0, which no answer patch targets — the two never race on the row.
    void saveOnboardingStepAction({ lastStep: 'role' });
  }, [stepKey, index, questions.length, locale]);

  /** Answer the current question and advance. Choosing IS continuing — one tap. */
  const answer = useCallback(
    (value: string) => {
      if (!current) return;
      setAnswers((a) => ({ ...a, [current.field]: value }));
      // Changing the use case invalidates an explicit template pick made on a
      // later screen. Without this, going back and choosing a different purpose
      // leaves the OLD card selected while the "Recommended for you" badge moves
      // to the new one — two highlighted cards saying different things, and the
      // button builds the one the person no longer asked for.
      if (current.field === 'useCase') setTemplate(null);
      captureEvent('onboarding_step_answered', {
        step_key: current.key,
        step_index: index,
        value,
      });
      const advancing = index + 1;
      // `lastStep` names the screen being REACHED, which is what makes the
      // stored value a drop-off bucket rather than a record of the last answer.
      const reached = questions[advancing]?.key ?? 'template';
      void saveOnboardingStepAction({ [current.field]: value, lastStep: reached });
      setIndex(advancing);
    },
    [current, index, questions],
  );

  const back = useCallback(() => setIndex((i) => Math.max(0, i - 1)), []);

  const finish = useCallback(
    (id: string) => {
      captureEvent('onboarding_template_picked', {
        template: id,
        recommended: id === recommended,
        use_case: answers.useCase ?? null,
      });
      startSubmit(() => void completeOnboardingAction(id));
    },
    [answers.useCase, recommended],
  );

  const stage = onTemplates ? TEMPLATE_STAGE : QUESTION_STAGE;

  // The form is being created and a redirect is on its way. Nothing here is
  // actionable any more, so the screen becomes an interstitial rather than a
  // disabled copy of itself — a frozen page with a greyed-out button reads as a
  // hang, and this is the last thing before a screen they have never seen.
  if (submitting) return <CreatingScreen m={m} />;

  return (
    <div className="pf ob">
      {/* The renderer's topbar: back · logo · spacer, on a `40px 1fr 40px` grid
          that centres the mark against the bar rather than against whatever
          space the back button leaves over. */}
      <header className="pf__topbar">
        <div className="pf__topbar-inner">
          {index > 0 ? (
            <button type="button" className="pf__back" onClick={back} aria-label={m.back}>
              ←
            </button>
          ) : (
            <span className="pf__back pf__back--placeholder" />
          )}
          <span className="ob__brand">
            <FormsLockup className="ob__logo ob__logo--wide" title="Dapta Forms" />
            <FormsMark className="ob__logo ob__logo--compact" title="Dapta Forms" />
          </span>
          <span className="pf__back pf__back--placeholder" />
        </div>
        {/* Where a real form puts `FormProgress`. Same slot, same job. */}
        <StageBar m={m} stage={stage} />
      </header>

      <div className="pf__body">
        <div className="pf__inner">
          {current ? (
            <div className="pf__content pf-animate" key={current.key}>
              <div className="pf__question-wrap">
                <p className="ob__eyebrow">
                  {fill(m.progress, { current: index + 1, total: questions.length })}
                </p>
                <h1 className="pf__question">{current.step.question}</h1>
                {current.step.helper ? <p className="pf__helper">{current.step.helper}</p> : null}
              </div>

              <div className="pf__fields">
                <StepInput
                  step={current.step}
                  value={answers[current.field] ?? ''}
                  answers={answers}
                  // Only single-select choices and the dropdown are used here,
                  // and both report through `onSelect`. The other two are
                  // required by the shared component's contract and are wired to
                  // no-ops rather than to `answer`: routing them there would
                  // make a future step type (a slider, a text field) advance the
                  // wizard on every keystroke.
                  onSelect={answer}
                  onChange={() => {}}
                  onFieldChange={() => {}}
                  dropdownPlaceholder={m.industry.placeholder}
                  dropdownEmpty={m.industry.empty}
                  locale={locale}
                />
              </div>
            </div>
          ) : (
            <div className="pf__content pf-animate" key="template">
              <div className="pf__question-wrap">
                <h1 className="pf__question">{m.templates.question}</h1>
                <p className="pf__helper">{m.templates.helper}</p>
              </div>

              <div className="pf__fields">
                <ul className="ob__templates">
                  {templates.map((t) => {
                    const isRecommended = t.id === recommended;
                    const selected = (template ?? recommended) === t.id;
                    return (
                      // `blank` spans the full row: it is the last card and an
                      // odd one out in a two-column grid, so left alone it sat
                      // as a half-width orphan under the four real templates.
                      <li key={t.id} className={t.id === 'blank' ? 'ob__templates-wide' : undefined}>
                        <button
                          type="button"
                          className="ob__template"
                          aria-pressed={selected}
                          data-selected={selected || undefined}
                          onClick={() => setTemplate(t.id)}
                        >
                          {isRecommended && (
                            <span className="ob__badge">{m.templates.recommended}</span>
                          )}
                          <span className="ob__template-head">
                            <span className="ob__template-icon" aria-hidden="true">
                              {t.icon}
                            </span>
                            <span className="ob__template-name">{t.name}</span>
                          </span>
                          <span className="ob__template-desc">{t.description}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>

                <button
                  type="button"
                  className="pf__btn ob__cta"
                  // `?? recommended` so the pre-selected card is genuinely
                  // armed: requiring a redundant click on the option we already
                  // highlighted would make the recommendation a lie.
                  disabled={!(template ?? recommended)}
                  onClick={() => {
                    const pick = template ?? recommended;
                    if (pick) finish(pick);
                  }}
                >
                  {m.templates.cta}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * The interstitial between "Create my form" and the builder.
 *
 * The wait is real work — the API claims completion, builds the config from the
 * template registry, and creates the form — and it is the last thing that
 * happens before the person sees a screen they have never seen before. A moving
 * bar reads as progress where a spinner reads as a stall, and the same pattern
 * is already what a respondent gets on a form's reveal step, so this is the
 * product's own loading language rather than a new one.
 */
function CreatingScreen({ m }: { m: Messages }) {
  return (
    <div className="pf ob ob--creating">
      <div className="ob__creating">
        <FormsMark className="ob__creating-mark" title="Dapta Forms" />
        <h1 className="ob__creating-headline">{m.creating}</h1>
        <p className="ob__creating-sub">{m.creatingSubtitle}</p>
        {/* `role="progressbar"` with no value: indeterminate, which is the
            honest reading — there is one round trip, not measurable steps. */}
        <div className="ob__creating-track" role="progressbar" aria-label={m.creating}>
          <div className="ob__creating-fill" />
        </div>
      </div>
    </div>
  );
}

/**
 * The three stages, always all visible.
 *
 * Stage 1 is complete before this component ever renders — they signed in to get
 * here — and showing it ticked is the point: the wizard opens already one third
 * done rather than at zero.
 */
function StageBar({ m, stage }: { m: Messages; stage: number }) {
  const labels = [m.stages.account, m.stages.profile, m.stages.firstForm];
  return (
    <ol className="ob__stages">
      {labels.map((label, i) => {
        const n = i + 1;
        const state = n < stage ? 'done' : n === stage ? 'current' : 'todo';
        return (
          <li key={label} className="ob__stage" data-state={state}>
            <span className="ob__stage-mark" aria-hidden="true">
              {state === 'done' ? '✓' : n}
            </span>
            <span className="ob__stage-label">{label}</span>
          </li>
        );
      })}
    </ol>
  );
}
