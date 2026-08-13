'use client';

/**
 * The first-run wizard: a few questions, then the template the first form is
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
 * NO question can be skipped — decided 11-ago, phone included: the phone number
 * is what the Dapta pipeline births the HubSpot contact from, so a skippable
 * phone is a contact that never exists. Screens advance three ways: cards
 * advance on the tap (choosing IS continuing), the industry dropdown arms an
 * explicit Next (picking from a filtered list wants a confirmation beat), and
 * the phone/slider screens have a Continue because typing and dragging have no
 * natural "done" signal.
 *
 * HOW MANY questions there are depends on who is asking. Someone arriving from
 * Dapta AI already gave Dapta their industry, CRM, lead volume and phone number,
 * so they see two screens where a cold signup sees six. Nothing here hardcodes a
 * count — see `cohort`.
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
import { callAction } from '@/lib/call-action';
import {
  fill,
  leadVolumeBucket,
  LEAD_VOLUME_SLIDER,
  stepIndexFromSearch,
  stepParam,
  wizardQuestions,
  wizardTemplates,
} from '@/lib/onboarding';
import {
  USE_CASE_TEMPLATE,
  type OnboardingCohort,
  type OnboardingUseCase,
} from '@quill/types';
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

export function OnboardingWizard({
  messages: m,
  locale,
  cohort,
}: {
  messages: Messages;
  locale: Locale;
  /**
   * Which set of screens this person gets, resolved server-side against the
   * Dapta IAM. Passed in rather than fetched here: it decides the FIRST screen,
   * so it has to be known before the first paint.
   */
  cohort: OnboardingCohort;
}) {
  const questions = useMemo(() => wizardQuestions(m, cohort), [m, cohort]);
  const templates = useMemo(() => wizardTemplates(m), [m]);

  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [template, setTemplate] = useState<string | null>(null);
  const [submitting, startSubmit] = useTransition();
  /** Set when the completion could not be made — see `finish`. */
  const [failed, setFailed] = useState(false);
  /**
   * The phone field as it is being typed.
   *
   * Kept apart from `answers` on purpose: `answers` is what gets PATCHed, and
   * every other screen writes to it once, at the moment of a decision. A phone
   * number arrives a digit at a time, so writing it there would send a patch per
   * keystroke and store half-typed numbers.
   */
  const [draft, setDraft] = useState('');
  /**
   * Enough digits to be a number at all. Not validation — the input already
   * builds E.164 and refuses letters — just a guard so the button cannot submit
   * a bare country code.
   */
  const phoneUsable = draft.replace(/\D/g, '').length >= 8;
  /**
   * The slider as it is being dragged. Same reasoning as `draft`: a drag emits
   * a value per pixel, and `answers` must only ever see the decision. Survives
   * leaving and returning to the screen, so going back shows the number that
   * was picked rather than snapping to the default — the STORED answer is a
   * bucket and cannot reconstruct it.
   */
  const [sliderDraft, setSliderDraft] = useState<number>(LEAD_VOLUME_SLIDER.default);
  /**
   * A dropdown pick waiting for its Next. The dropdown is the one input where
   * choosing does NOT continue: the pick collapses a filtered list, and
   * advancing on it yanks the screen away mid-confirmation. Armed per screen —
   * cleared on every index move — and seeded from the stored answer when
   * returning, so Back shows the earlier pick already armed.
   */
  const [pending, setPending] = useState<string | null>(null);

  /** Past the last question is the template screen. */
  const onTemplates = index >= questions.length;
  const current = onTemplates ? null : questions[index];
  const stepKey = onTemplates ? 'template' : (current?.key ?? questions[0]?.key ?? 'role');

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
   * The progress patches, one at a time and in order.
   *
   * The wizard has two writers — the arrival effect below and every answer — and
   * they both patch the SAME JSON column by read-modify-write. Left unchained
   * they overlap: the arrival patch, fired un-awaited on mount, can still be in
   * flight when the first answer's patch reads the row, and whichever writes
   * second overwrites the other's field with a snapshot taken before it existed.
   * Serializing costs nothing here — nothing in the UI waits on these — and it
   * removes the only interleaving this screen can actually produce.
   *
   * The chain swallows rejections rather than propagating them. It has to: a
   * rejected link would leave `queue.current` permanently rejected, so every
   * later patch would be skipped and the progress column would stop at whatever
   * the last success wrote. The action already treats a failed save as a
   * non-event by design, and the next advance re-sends every answer anyway.
   */
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const save = useCallback((patch: Parameters<typeof saveOnboardingStepAction>[0]) => {
    queue.current = queue.current
      .catch(() => undefined)
      .then(() => saveOnboardingStepAction(patch))
      .catch(() => undefined);
  }, []);

  /**
   * Mirror every screen move into the URL — `/onboarding?step=N`, the same
   * shape the Dapta adminpanel uses — so GTM's history trigger sees one
   * pageview per step without a single custom event.
   *
   * Native `history.pushState`, never `router.push`: the router would re-run
   * the server component — `me()` plus the IAM cohort probe — on every answer,
   * for a page whose state lives entirely in this client component. A PUSH per
   * move (matching the adminpanel) is what makes the browser's own back/forward
   * walk the steps; the popstate listener below is what makes the wizard follow.
   */
  const syncStepUrl = useCallback((nextIndex: number) => {
    window.history.pushState(null, '', stepParam(nextIndex));
  }, []);

  // Stamp the FIRST screen on arrival — replace, not push, so question one and
  // the bare `/onboarding` are one history entry and browser-back from it still
  // EXITS the wizard instead of stepping to itself. Idempotent under
  // StrictMode's double mount: same URL both times. The server page redirects
  // any direct `?step=N` load back to bare `/onboarding` first, so this is the
  // only writer of the first entry.
  useEffect(() => {
    window.history.replaceState(null, '', stepParam(0));
  }, []);

  // The browser's back/forward buttons move the wizard, not just the URL — the
  // half the adminpanel is missing. Clamped to the screens that exist, and
  // `pending` is cleared like every other index move (see `back`).
  useEffect(() => {
    const onPop = () => {
      setPending(null);
      setIndex(stepIndexFromSearch(window.location.search, questions.length + 1));
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [questions]);

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
      // The real length, not a constant. The two cohorts run different-length
      // wizards, so a fixed total would count one against the other's
      // denominator and make both drop-off rates meaningless.
      total_steps: questions.length + 1,
      cohort,
    });
    if (index !== 0) return;
    captureEvent('onboarding_started', { locale, cohort });
    // Claim the FIRST screen on arrival. Every later screen has its `lastStep`
    // written by the answer that led to it, but nothing precedes this one — so
    // without this patch, someone who opens the wizard and quits on question one
    // is indistinguishable in the database from someone who never opened it at
    // all. Those are opposite problems: one is a wizard failing, the other is a
    // signup that never arrived.
    //
    // Harmless on a RETURN visit even though it re-announces step one: the
    // server only ever advances `lastStep`, so it cannot drag a stored
    // `template` back and misfile a finisher as a first-question quit.
    //
    // Names the cohort's OWN first screen, which is `phone` for a cold signup
    // and `role` for someone from Dapta — hardcoding `role` would have recorded
    // every cold arrival as having already cleared the phone question.
    const first = questions[0]?.key;
    if (first) save({ lastStep: first });
  }, [stepKey, index, questions, locale, cohort, save]);

  /**
   * Move to the screen after `from`, recording the one being REACHED.
   *
   * Shared by answering and by skipping, so the two can never disagree about
   * what `lastStep` should say — the bug that would follow is silent and only
   * shows up as a drop-off bucket that does not add up.
   */
  const advanceTo = useCallback(
    (from: number, patch: Record<string, string | null>) => {
      const advancing = from + 1;
      // `lastStep` names the screen being REACHED, which is what makes the
      // stored value a drop-off bucket rather than a record of the last answer.
      const reached = questions[advancing]?.key ?? 'template';
      save({ ...patch, lastStep: reached });
      setIndex(advancing);
      syncStepUrl(advancing);
    },
    [questions, save, syncStepUrl],
  );

  /** Answer the current question and advance. Choosing IS continuing — one tap. */
  const answer = useCallback(
    (value: string) => {
      if (!current) return;
      const next = { ...answers, [current.field]: value };
      setAnswers(next);
      setPending(null);
      // Changing the use case invalidates an explicit template pick made on a
      // later screen. Without this, going back and choosing a different purpose
      // leaves the OLD card selected while the "Recommended for you" badge moves
      // to the new one — two highlighted cards saying different things, and the
      // button builds the one the person no longer asked for.
      if (current.field === 'useCase') setTemplate(null);
      captureEvent('onboarding_step_answered', {
        step_key: current.key,
        step_index: index,
        // A phone number is PII and this event goes to a shared analytics
        // project. Every other answer is an enum from a fixed list, so the value
        // is the whole point; this one says only that it was given.
        value: current.field === 'phone' ? '<provided>' : value,
        cohort,
      });
      // Every answer so far, not just this one. A patch that never landed — the
      // action swallows its failures by design — is repaired by the next advance
      // instead of leaving a permanent hole in the column, and the merge ignores
      // fields it already has, so re-sending them costs nothing.
      advanceTo(index, next);
    },
    [advanceTo, answers, cohort, current, index],
  );

  const back = useCallback(() => {
    setPending(null);
    // Computed rather than a functional update: the URL mirror needs the value.
    const next = Math.max(0, index - 1);
    setIndex(next);
    syncStepUrl(next);
  }, [index, syncStepUrl]);

  const finish = useCallback(
    (id: string) => {
      captureEvent('onboarding_template_picked', {
        template: id,
        recommended: id === recommended,
        use_case: answers.useCase ?? null,
        cohort,
      });
      setFailed(false);
      // `async` so the scope returns a PROMISE. A non-thenable body ends the
      // transition in the same tick: `submitting` would flip straight back to
      // false, the interstitial below would never paint, the CTA would stay live
      // for the whole round trip, and a rejection would have nobody to catch it.
      startSubmit(async () => {
        // The answers travel WITH the completion, so the claim writes them in
        // its own single statement and cannot lose the last one to a PATCH still
        // in flight. `locale` so the created form is named like the card.
        // Transport-safe (30s: this one call creates the account's first form):
        // a rejected invocation lands on the Failed screen with a retry, not on
        // an unhandled rejection that silently drops them back into the wizard.
        const result = await callAction(
          () =>
            completeOnboardingAction({
              template: id,
              role: answers.role ?? null,
              industry: answers.industry ?? null,
              useCase: answers.useCase ?? null,
              crm: answers.crm ?? null,
              leadVolume: answers.leadVolume ?? null,
              leadSource: answers.leadSource ?? null,
              phone: answers.phone ?? null,
              // The cohort travels too, so the server can record WHY the questions
              // this person never saw are empty. Without it a Dapta account's null
              // industry is indistinguishable from a gap in our own data.
              cohort,
              locale,
            }),
          { timeoutMs: 30_000 },
        );
        // Only a FAILURE returns: every path where the API answered ends in a
        // redirect, which throws. `/admin` is not a fallback while the claim is
        // unwritten — the first-run gate reads the same column this request
        // failed to set and would bounce them back into a wizard remounted at
        // question one, with their answers gone. Say so, and offer a retry.
        if (result && !result.ok) setFailed(true);
      });
    },
    [answers, cohort, locale, recommended],
  );

  const stage = onTemplates ? TEMPLATE_STAGE : QUESTION_STAGE;

  // The form is being created and a redirect is on its way. Nothing here is
  // actionable any more, so the screen becomes an interstitial rather than a
  // disabled copy of itself — a frozen page with a greyed-out button reads as a
  // hang, and this is the last thing before a screen they have never seen.
  if (submitting) return <CreatingScreen m={m} />;
  // The completion did not go through. The template pick is still in state, so
  // retrying is one button and nothing has to be re-answered.
  if (failed) {
    const pick = template ?? recommended;
    return <FailedScreen m={m} onRetry={pick ? () => finish(pick) : undefined} />;
  }

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
                {current.step.type === 'phone' ? <p className="ob__label">{m.phone.label}</p> : null}
                <StepInput
                  step={current.step}
                  value={
                    current.step.type === 'phone'
                      ? draft
                      : current.step.type === 'slider'
                        ? sliderDraft
                        : current.step.type === 'dropdown'
                          ? (pending ?? answers[current.field] ?? '')
                          : (answers[current.field] ?? '')
                  }
                  answers={answers}
                  // Cards report through `onSelect`, and for them choosing IS
                  // continuing. The dropdown also reports through `onSelect`,
                  // but its pick only ARMS the Next button below — a pick that
                  // collapses a filtered list should not also yank the screen.
                  // `onChange` carries the two continuous inputs: phone digits
                  // and the slider's drag, neither of which has a "done" signal
                  // of its own. `onFieldChange` stays a no-op — no step type
                  // here is multi-field.
                  onSelect={current.step.type === 'dropdown' ? setPending : answer}
                  onChange={(v) =>
                    current.step.type === 'slider'
                      ? setSliderDraft(Number(v ?? LEAD_VOLUME_SLIDER.default))
                      : setDraft(String(v ?? ''))
                  }
                  onFieldChange={() => {}}
                  dropdownPlaceholder={m.industry.placeholder}
                  dropdownEmpty={m.industry.empty}
                  locale={locale}
                />

                {/* The screens that cannot know when the person is done get a
                    button: typing (phone), dragging (slider), and the dropdown,
                    whose pick arms this Next instead of advancing. */}
                {current.step.type === 'phone' ? (
                  <button
                    type="button"
                    className="pf__btn ob__cta"
                    disabled={!phoneUsable}
                    onClick={() => answer(draft.trim())}
                  >
                    {m.next}
                  </button>
                ) : null}
                {current.step.type === 'dropdown' ? (
                  <button
                    type="button"
                    className="pf__btn ob__cta"
                    disabled={!(pending ?? answers[current.field])}
                    onClick={() => {
                      const chosen = pending ?? answers[current.field];
                      if (chosen) answer(chosen);
                    }}
                  >
                    {m.next}
                  </button>
                ) : null}
                {current.step.type === 'slider' ? (
                  <button
                    type="button"
                    className="pf__btn ob__cta"
                    // Never disabled: the default (0) is a real answer — "no
                    // leads yet" — not a missing one.
                    onClick={() => answer(leadVolumeBucket(sliderDraft))}
                  >
                    {m.next}
                  </button>
                ) : null}
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
 * The completion failed and there is nowhere safe to send them.
 *
 * The dashboard is not that place: the claim is unwritten, so the first-run gate
 * would read the same NULL column and redirect them back into a wizard that
 * remounts with none of their answers. Standing still and saying so keeps the
 * template pick alive in state, which makes the retry one click.
 *
 * Same shell as the interstitial it replaces, so nothing jumps between the two.
 */
function FailedScreen({ m, onRetry }: { m: Messages; onRetry?: () => void }) {
  return (
    <div className="pf ob ob--creating">
      <div className="ob__creating" role="alert">
        <FormsMark className="ob__creating-mark" title="Dapta Forms" />
        <h1 className="ob__creating-headline">{m.error.headline}</h1>
        <p className="ob__creating-sub">{m.error.body}</p>
        {onRetry ? (
          <button type="button" className="pf__btn ob__cta" onClick={onRetry}>
            {m.error.retry}
          </button>
        ) : null}
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
