'use client';

import { useState } from 'react';
import type { AnswerValue, Answers, FormConfig, FormStep } from '@quill/engine';
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
 * stylesheet.
 *
 * It used to be a hand-written approximation in admin Tailwind classes that
 * copied one accent variable across and ignored everything else. That is why
 * the builder drew a radio list while the form drew cards, and why it would
 * have gone on showing the default palette while the form used the author's.
 * Sharing the components (`StepInput`, `FormProgress`, `FormLogo`,
 * `ClientLogosMarquee`) and the stylesheet means a design axis added to the
 * renderer shows up here for free, and the two cannot disagree about anything.
 *
 * It is INERT: fields render and accept typing so the author can feel the form,
 * but nothing advances, submits, or reaches the server.
 */
export function LivePreview({
  config,
  selected,
  name = 'Form',
  locale = 'en',
  m,
}: {
  config: FormConfig;
  selected: number | 'cover';
  /** The form's name — the logo falls back to it, exactly as on the public page. */
  name?: string;
  locale?: string;
  m: EditorMessages['preview'];
}) {
  const design = formDesignProps(config.branding);
  const cover = config.cover ?? {};
  const step: FormStep | undefined = typeof selected === 'number' ? config.steps[selected] : undefined;
  const isCover = selected === 'cover';
  const banner = showBanner(cover, isCover) ? cover.bannerText : null;

  if (!isCover && !step) {
    return (
      <div className="flex h-full items-center justify-center bg-background">
        <p className="p-8 text-center text-sm text-muted-foreground">{m.empty}</p>
      </div>
    );
  }

  return (
    <div
      className={`pf pf--embedded${isCover ? ' pf--cover' : ''}`}
      {...design.attrs}
      style={design.style}
      data-testid="live-preview"
    >
      {design.fontFace ? <style>{design.fontFace}</style> : null}
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
          />
        )}
      </div>
    </div>
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
}: {
  config: FormConfig;
  step: FormStep;
  index: number;
  name: string;
  locale: string;
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
          <div className="pf__content">
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
