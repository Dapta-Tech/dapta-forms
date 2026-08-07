'use client';

/**
 * The first-run wizard: three questions, then the template the first form is
 * built from.
 *
 * One screen at a time, and all three stages named from the very first paint.
 * Seeing that there are three is what stops the second question feeling like the
 * fifth — the same reason a progress bar beats a spinner.
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
import { SearchableDropdown } from '@/components/public/searchable-dropdown';
import { FormsLockup, FormsMark } from '@/components/brand/forms-logo';
import { captureEvent } from '@/lib/product-analytics';
import { fill, wizardQuestions, wizardTemplates } from '@/lib/onboarding';
import { USE_CASE_TEMPLATE, type OnboardingUseCase } from '@quill/types';
import { saveOnboardingStepAction, completeOnboardingAction } from './actions';
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
      const next = { ...answers, [current.field]: value };
      setAnswers(next);
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
    [answers, current, index, questions],
  );

  const back = useCallback(() => setIndex((i) => Math.max(0, i - 1)), []);

  const finish = useCallback(
    (id: string) => {
      captureEvent('onboarding_template_picked', {
        template: id,
        recommended: id === recommended,
        use_case: answers.useCase ?? null,
      });
      // The server action redirects; the transition keeps the button disabled
      // and the copy honest until the navigation actually happens.
      startSubmit(() => void completeOnboardingAction(id));
    },
    [answers.useCase, recommended],
  );

  const stage = onTemplates ? TEMPLATE_STAGE : QUESTION_STAGE;

  // The form is being created and a redirect is on its way. Nothing on this
  // screen is actionable any more, so it becomes an interstitial rather than a
  // disabled copy of itself — the wait is a second of real work, and a frozen
  // page with a greyed-out button reads as a hang.
  if (submitting) return <CreatingScreen m={m} />;

  return (
    <main className="ob">
      {/* Three columns, so the stage bar is centred against the VIEWPORT rather
          than against the space the logo leaves over. A flex row with
          space-between put it visually left of centre. The empty third column
          is what balances the logo. */}
      <header className="ob__top">
        {/* Two marks, one shown per breakpoint. At phone width the full lockup
            is ~110px of a 390px header, which squeezed the stage bar out of the
            centre and left it hard against the logo; the F alone is ~24px and
            keeps the brand present without taking the room. Only one is exposed
            to assistive tech — the hidden one is `aria-hidden` via its own CSS. */}
        <div className="ob__brand">
          <FormsLockup className="ob__logo ob__logo--wide" title="Dapta Forms" />
          <FormsMark className="ob__logo ob__logo--compact" title="Dapta Forms" />
        </div>
        <StageBar m={m} stage={stage} />
        <div aria-hidden="true" />
      </header>

      <div className="ob__body">
        {current ? (
          <section className="ob__screen" key={current.key}>
            <p className="ob__eyebrow">{fill(m.progress, { current: index + 1, total: questions.length })}</p>
            <h1 className="ob__question">{current.question}</h1>
            <p className="ob__helper">{current.helper}</p>

            {current.layout === 'search' ? (
              <div className="ob__search">
                <SearchableDropdown
                  options={current.options.map((o) => ({ label: o.label, value: o.value }))}
                  value={answers[current.field] ?? ''}
                  onSelect={answer}
                  placeholder={m.industry.placeholder}
                  emptyLabel={m.industry.empty}
                />
              </div>
            ) : (
              // Same markup for both option layouts — only the list class
              // differs, so the grid-vs-rows decision lives entirely in CSS and
              // a third layout costs one rule rather than a second branch here.
              <ul className={current.layout === 'list' ? 'ob__list' : 'ob__cards'}>
                {current.options.map((o) => (
                  <li key={o.value}>
                    <button
                      type="button"
                      className={current.layout === 'list' ? 'ob__row' : 'ob__card'}
                      aria-pressed={answers[current.field] === o.value}
                      data-selected={answers[current.field] === o.value || undefined}
                      onClick={() => answer(o.value)}
                    >
                      {o.icon && (
                        <span className="ob__card-icon" aria-hidden="true">
                          {o.icon}
                        </span>
                      )}
                      <span className="ob__card-label">{o.label}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {index > 0 && (
              <button type="button" className="ob__back" onClick={back}>
                {m.back}
              </button>
            )}
          </section>
        ) : (
          <section className="ob__screen" key="template">
            <h1 className="ob__question">{m.templates.question}</h1>
            <p className="ob__helper">{m.templates.helper}</p>

            <ul className="ob__templates">
              {templates.map((t) => {
                const isRecommended = t.id === recommended;
                const selected = (template ?? recommended) === t.id;
                return (
                  // `blank` spans the full row: it is the last card and an odd
                  // one out in a two-column grid, so left alone it sat as a
                  // half-width orphan under the four real templates.
                  <li key={t.id} className={t.id === 'blank' ? 'ob__templates-wide' : undefined}>
                    <button
                      type="button"
                      className="ob__template"
                      aria-pressed={selected}
                      data-selected={selected || undefined}
                      disabled={submitting}
                      onClick={() => setTemplate(t.id)}
                    >
                      {isRecommended && <span className="ob__badge">{m.templates.recommended}</span>}
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

            <div className="ob__actions">
              <button type="button" className="ob__back" onClick={back} disabled={submitting}>
                {m.back}
              </button>
              <button
                type="button"
                className="ob__cta"
                // `?? recommended` so the pre-selected card is genuinely armed:
                // requiring a redundant click on the option we already
                // highlighted would make the recommendation a lie.
                disabled={submitting || !(template ?? recommended)}
                onClick={() => {
                  const pick = template ?? recommended;
                  if (pick) finish(pick);
                }}
              >
                {m.templates.cta}
              </button>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}

/**
 * The interstitial between "Create my form" and the builder.
 *
 * The wait is real work — the API claims completion, builds the config from the
 * template registry, and creates the form — and it is the last thing that
 * happens before the person sees a screen they have never seen before. A
 * determinate bar reads as progress where a spinner reads as a stall, and the
 * same pattern is already what a respondent gets on a form's reveal step, so
 * this is the product's own loading language rather than a new one.
 *
 * The bar is CSS-driven and does not report real progress; it cannot, because
 * the work is a single round trip. It runs slightly longer than the request
 * usually takes so it is never seen to finish and then sit there.
 */
function CreatingScreen({ m }: { m: Messages }) {
  return (
    <main className="ob ob--creating">
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
    </main>
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
