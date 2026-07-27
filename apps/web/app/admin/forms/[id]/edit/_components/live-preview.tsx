'use client';

import { useState } from 'react';
import type { AnswerValue, Answers, FormConfig, FormLayout, FormStep } from '@quill/engine';
import { resolveQuestion, showBanner, showClientLogos } from '@quill/engine';
import { getMessages } from '@quill/shared';
import { formDesignProps } from '@/lib/form-design';
import { FormLogo } from '@/components/public/form-logo';
import { FormProgress } from '@/components/public/form-progress';
import { ClientLogosMarquee } from '@/components/public/client-logos-marquee';
import { StepInput } from '@/components/public/step-input';
import type { EditorMessages } from './messages';
import '@/app/[accountCode]/[handle]/[slug]/public-form.css';

/**
 * The live preview — the REAL public form markup, styled by the REAL public
 * stylesheet, in whichever layout the form publishes with.
 *
 * It used to be a hand-written approximation in admin Tailwind classes that
 * copied one accent variable across and ignored everything else. That is why
 * the builder drew a radio list while the form drew cards, and why it would
 * have gone on showing the default palette while the form used the author's.
 * Sharing the components (`StepInput`, `FormProgress`, `FormLogo`,
 * `ClientLogosMarquee`) and the stylesheet means a design axis added to the
 * renderer shows up here for free, and the two cannot disagree about anything.
 *
 * `layout` keeps it honest about SHAPE too: a vertical form has no Start gate,
 * so previewing the slides cover there would show a screen that never exists.
 *
 * It is INERT: fields render and accept typing so the author can feel the form,
 * but nothing advances, submits, or reaches the server.
 */
export function LivePreview({
  config,
  selected,
  layout = 'slides',
  name = 'Form',
  locale = 'en',
  m,
}: {
  config: FormConfig;
  selected: number | 'cover';
  layout?: FormLayout;
  /** The form's name — the logo falls back to it, exactly as on the public page. */
  name?: string;
  locale?: string;
  m: EditorMessages['preview'];
}) {
  const design = formDesignProps(config.branding);
  const cover = config.cover ?? {};
  const step: FormStep | undefined = typeof selected === 'number' ? config.steps[selected] : undefined;
  const vertical = layout === 'vertical';
  const isCover = selected === 'cover';
  // On one page the form IS the cover, so the banner always belongs to it.
  const banner = vertical ? cover.bannerText : showBanner(cover, isCover) ? cover.bannerText : null;

  // A CSS animation only plays when the element mounts, so a motion setting is
  // invisible in a static preview — you pick "Fade" and nothing happens. Keying
  // the content on the transition remounts it the moment the setting changes,
  // which replays the animation the respondent will actually see.
  const replayKey = `${design.design.transition}:${String(selected)}`;

  if (!vertical && !isCover && !step) {
    return (
      <div className="flex h-full items-center justify-center bg-background">
        <p className="p-8 text-center text-sm text-muted-foreground">{m.empty}</p>
      </div>
    );
  }

  return (
    <div
      className={`pf pf--embedded${vertical ? ' pf--vertical' : isCover ? ' pf--cover' : ''}`}
      {...design.attrs}
      style={design.style}
      data-testid="live-preview"
    >
      {design.fontFace ? <style>{design.fontFace}</style> : null}
      {vertical ? (
        <VerticalBody config={config} name={name} locale={locale} banner={banner} m={m} />
      ) : (
        <>
          {banner ? <div className="pf__banner">{banner}</div> : null}
          <div className="pf__main">
            {isCover ? (
              <CoverBody config={config} name={name} locale={locale} />
            ) : (
              <StepBody
                config={config}
                step={step as FormStep}
                index={selected as number}
                name={name}
                locale={locale}
                replayKey={replayKey}
              />
            )}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * The one-page form: the sticky banner + progress group, the hero, and every
 * visible question stacked — the real `.pf-v__*` structure, not a sketch of it,
 * so the design axes reach it the same way they reach the published page.
 */
function VerticalBody({
  config,
  name,
  locale,
  banner,
  m,
}: {
  config: FormConfig;
  name: string;
  locale: string;
  banner?: string | null;
  m: EditorMessages['preview'];
}) {
  const r = getMessages(locale).renderer;
  const [answers, setAnswers] = useState<Answers>({});
  const cover = config.cover ?? {};
  const logo = cover.logo ?? config.branding?.logo ?? null;
  const logos = showClientLogos(cover) ? (cover.clientLogos ?? config.branding?.clientLogos ?? []) : [];
  // A reveal is an interstitial the one-page layout plays after submit, not a
  // block on the page — same filter the renderer applies.
  const questions = config.steps.filter((s) => s.type !== 'reveal' && !s.hidden);

  return (
    <>
      <div className="pf-v__sticky">
        {banner ? <div className="pf__banner">{banner}</div> : null}
        {questions.length > 0 ? (
          <div className="pf-v__progressbar">
            <div className="pf-progress">
              <div className="pf-progress__track">
                <div className="pf-progress__fill" style={{ width: '0%' }} />
              </div>
            </div>
          </div>
        ) : null}
      </div>
      <div className="pf__main">
        <div className="pf-v__page">
          <header className="pf-v__header">
            <FormLogo src={logo} name={name} />
          </header>
          {cover.enabled !== false ? (
            <section className="pf-v__hero">
              {cover.eyebrow || cover.badge ? <p className="pf__badge">{cover.eyebrow ?? cover.badge}</p> : null}
              <h1 className="pf__title">{cover.headline ?? name}</h1>
              {cover.subheadline ? <p className="pf__subheadline">{cover.subheadline}</p> : null}
              {cover.trustBadge ? <p className="pf__trust">{cover.trustBadge}</p> : null}
              <ClientLogosMarquee logos={logos} label={r.trustedBy} />
            </section>
          ) : null}
          {questions.length === 0 ? (
            <p className="pf__helper">{m.empty}</p>
          ) : (
            questions.map((step) => (
              <section key={step.key} className="pf-v__question">
                <div className="pf__question-wrap">
                  <h2 className="pf__question">
                    {resolveQuestion(step, answers) || step.key}
                    {step.required && step.type !== 'message' ? (
                      <span aria-hidden className="pf-v__required">
                        *
                      </span>
                    ) : null}
                  </h2>
                  {step.helper && step.type !== 'message' ? <p className="pf__helper">{step.helper}</p> : null}
                </div>
                <div className="pf__fields">
                  <StepInput
                    step={step}
                    value={answers[step.key]}
                    answers={answers}
                    autoFocus={false}
                    onChange={(v: AnswerValue) => setAnswers((a) => ({ ...a, [step.key]: v }))}
                    onFieldChange={(field, v) => setAnswers((a) => ({ ...a, [field]: v }))}
                    onSelect={(value) => setAnswers((a) => ({ ...a, [step.key]: value }))}
                    dropdownPlaceholder={r.dropdownPlaceholder}
                    dropdownEmpty={r.dropdownEmpty}
                    locale={locale}
                  />
                </div>
              </section>
            ))
          )}
          {questions.length > 0 ? (
            <div className="pf-v__footer">
              <button type="button" className="pf__btn" tabIndex={-1} aria-hidden>
                {r.submit}
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </>
  );
}

function CoverBody({ config, name, locale }: { config: FormConfig; name: string; locale: string }) {
  const r = getMessages(locale).renderer;
  const cover = config.cover ?? {};
  const logo = cover.logo ?? config.branding?.logo ?? null;
  const logos = showClientLogos(cover) ? (cover.clientLogos ?? config.branding?.clientLogos ?? []) : [];

  return (
    <>
      <header className="pf__cover-header">
        <FormLogo src={logo} name={name} />
      </header>
      <div className="pf__cover-main">
        <div className="pf__cover-content">
          {cover.eyebrow || cover.badge ? <p className="pf__badge">{cover.eyebrow ?? cover.badge}</p> : null}
          <h1 className="pf__title">{cover.headline ?? name}</h1>
          {cover.subheadline ? <p className="pf__subheadline">{cover.subheadline}</p> : null}
          {cover.trustBadge ? <p className="pf__trust">{cover.trustBadge}</p> : null}
        </div>
        <ClientLogosMarquee logos={logos} label={r.trustedBy} />
      </div>
      <div className="pf__cover-footer">
        {/* NOT `disabled`: `.pf__btn:disabled` drops to 55% opacity, so a
            disabled button would preview the accent as a washed-out version of
            itself — the exact kind of lie this preview exists to prevent. A
            plain button with no handler is already inert. */}
        <button type="button" className="pf__btn" tabIndex={-1} aria-hidden>
          {cover.ctaText ?? r.start}
        </button>
      </div>
    </>
  );
}

function StepBody({
  config,
  step,
  index,
  name,
  locale,
  replayKey,
}: {
  config: FormConfig;
  step: FormStep;
  index: number;
  name: string;
  locale: string;
  /** Changing this remounts the content, replaying the step transition. */
  replayKey: string;
}) {
  const r = getMessages(locale).renderer;
  const design = formDesignProps(config.branding);
  const [answers, setAnswers] = useState<Answers>({});
  const logo = config.cover?.logo ?? config.branding?.logo ?? null;
  const total = config.steps.length;
  // The same display resolution the public renderer applies, so a question that
  // interpolates an earlier answer previews the way it will read.
  const question = resolveQuestion(step, answers) || step.key;
  // A choice step auto-advances on the public page, so a Continue button here
  // would preview a control the respondent never sees.
  const autoAdvances = step.type === 'dropdown' || step.type === 'multiple_choice';

  return (
    <>
      <header className="pf__topbar">
        <div className="pf__topbar-inner">
          <span className="pf__back pf__back--placeholder" />
          <FormLogo src={logo} name={name} />
          <span className="pf__back pf__back--placeholder" />
        </div>
        <FormProgress total={total} currentIndex={index} locale={locale} style={design.design.progressStyle} />
      </header>
      <div className="pf__body">
        <div className="pf__inner">
          <div className="pf__content pf-animate" key={replayKey}>
            <div className="pf__question-wrap">
              <h2 className="pf__question">{question}</h2>
              {step.helper && step.type !== 'message' ? <p className="pf__helper">{step.helper}</p> : null}
            </div>
            <div className="pf__fields">
              <StepInput
                step={step}
                value={answers[step.key]}
                answers={answers}
                onChange={(v: AnswerValue) => setAnswers((a) => ({ ...a, [step.key]: v }))}
                onFieldChange={(field, v) => setAnswers((a) => ({ ...a, [field]: v }))}
                onSelect={(value) => setAnswers((a) => ({ ...a, [step.key]: value }))}
                dropdownPlaceholder={r.dropdownPlaceholder}
                dropdownEmpty={r.dropdownEmpty}
                locale={locale}
              />
              {!autoAdvances ? (
                <button type="button" className="pf__btn pf__btn--inline" tabIndex={-1} aria-hidden>
                  {step.buttonText ?? (index + 1 === total ? r.submit : r.next)}
                </button>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
