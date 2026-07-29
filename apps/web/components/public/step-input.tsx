'use client';

import { useEffect, useRef, useState } from 'react';
import type { Answers, AnswerValue, FormOption, FormStep } from '@quill/engine';
import {
  nameFields,
  isMultiSelect,
  sliderBounds,
  clampSliderValue,
  resolveOptionLayout,
  resolveOptionIcon,
  optionInitials,
} from '@quill/engine';
import { getMessages } from '@quill/shared';
import { SearchableDropdown } from './searchable-dropdown';
import { PhoneInput } from './phone-input';

interface StepInputProps {
  step: FormStep;
  value: AnswerValue;
  answers: Answers;
  onChange: (value: AnswerValue) => void;
  onFieldChange: (field: string, value: AnswerValue) => void;
  /** Choice/dropdown selection auto-advances the form (single-select only). */
  onSelect: (value: string) => void;
  dropdownPlaceholder: string;
  dropdownEmpty: string;
  /** Active locale — drives the phone picker's default country + copy. */
  locale?: string;
  /**
   * Focus the (first) text input on mount. Default `true` — the slides layout
   * shows one question per screen, so focusing it is always right. The vertical
   * layout renders every question at once and passes `false`: multiple
   * autofocused inputs would fight, and the winner would scroll the page.
   */
  autoFocus?: boolean;
  /**
   * A NON-INTERACTION answer write (today: the slider seeding its default on
   * mount so an untouched optional slider still submits a value). Falls back to
   * `onChange` when absent — the slides layout treats both the same. The
   * vertical layout passes a silent setter here: a mount-time seed must never
   * fire the `start`/`step_complete` funnel events a real interaction fires.
   */
  onSeed?: (value: AnswerValue) => void;
}

/** The current multi-select answer as a string[] (defensive against scalars). */
function asArray(value: AnswerValue): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (value == null || value === '') return [];
  return [String(value)];
}

/**
 * An option's icon. An emoji or initials are square glyphs, so they centre in a
 * circle; a logo has an arbitrary aspect ratio a circle would crop, so images
 * get a rectangle to letterbox into. `resolveOptionIcon` decides which — and
 * confines images to the card layout.
 *
 * A broken image URL falls back to the glyph rather than leaving a torn-image
 * box: the option must stay pickable whatever the icon does.
 */
function OptionIcon({
  option,
  layout,
}: {
  option: FormOption;
  layout: 'cards' | 'list';
}) {
  const [failed, setFailed] = useState(false);
  const resolved = resolveOptionIcon(option, layout);
  const base = layout === 'cards' ? 'pf-choice-icon' : 'pf-choice-list';

  if (resolved.kind === 'image' && !failed) {
    return (
      <span className={`${base}__img-wrap`} aria-hidden>
        <img
          src={resolved.src}
          alt=""
          className={`${base}__img`}
          onError={() => setFailed(true)}
        />
      </span>
    );
  }
  const glyph =
    resolved.kind === 'glyph' ? resolved.text : optionInitials(option.label);
  return (
    <span className={`${base}__circle`} aria-hidden>
      {glyph}
    </span>
  );
}

/** Renders the input for a single step. `message` renders info copy, no input. */
export function StepInput({
  step,
  value,
  answers,
  onChange,
  onFieldChange,
  onSelect,
  dropdownPlaceholder,
  dropdownEmpty,
  locale = 'en',
  autoFocus = true,
  onSeed,
}: StepInputProps) {
  switch (step.type) {
    case 'name': {
      const [firstField, secondField] = nameFields(step);
      // Positional fallback: a configured placeholder wins; an empty/unset one
      // falls back to the localized default so published inputs never render
      // placeholder-less. aria-labels reuse the same resolved copy (never the
      // raw field key).
      const nm = getMessages(locale).renderer.name;
      const firstLabel = (firstField && step.placeholders?.[firstField]) || nm.firstPlaceholder;
      const secondLabel = (secondField && step.placeholders?.[secondField]) || nm.lastPlaceholder;
      return (
        <div className="pf-name-fields">
          {firstField && (
            <input
              type="text"
              className="pf-input"
              value={String(answers[firstField] ?? '')}
              onChange={(e) => onFieldChange(firstField, e.target.value)}
              placeholder={firstLabel}
              aria-label={firstLabel}
              autoFocus={autoFocus}
            />
          )}
          {secondField && (
            <input
              type="text"
              className="pf-input"
              value={String(answers[secondField] ?? '')}
              onChange={(e) => onFieldChange(secondField, e.target.value)}
              placeholder={secondLabel}
              aria-label={secondLabel}
            />
          )}
        </div>
      );
    }

    case 'phone':
      // Country-code selector + digits input; the answer is a single E.164
      // string ('+525512345678'), preserving the string onChange contract.
      return (
        <PhoneInput
          value={String(value ?? '')}
          onChange={onChange}
          locale={locale}
          ariaLabel={step.question ?? step.key}
          defaultCountry={step.phoneDefaultCountry ?? undefined}
        />
      );

    case 'text':
    case 'email':
      return (
        <input
          type={step.type === 'email' ? 'email' : 'text'}
          className="pf-input"
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
          placeholder={step.placeholder ?? ''}
          aria-label={step.question ?? step.key}
          autoFocus={autoFocus}
        />
      );

    case 'textarea':
      return (
        <textarea
          className="pf-input pf-textarea"
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
          placeholder={step.placeholder ?? ''}
          aria-label={step.question ?? step.key}
          rows={4}
          autoFocus={autoFocus}
        />
      );

    case 'dropdown':
      return (
        <SearchableDropdown
          options={step.options ?? []}
          value={String(value ?? '')}
          onSelect={onSelect}
          placeholder={step.placeholder ?? dropdownPlaceholder}
          emptyLabel={dropdownEmpty}
        />
      );

    case 'multiple_choice':
      // Multi-select (checkboxes): toggle values in/out of an array; the form's
      // Continue button submits. No auto-advance (you may pick several).
      if (isMultiSelect(step)) {
        const picked = asArray(value);
        return (
          <div className="pf-choices--list" role="group" aria-label={step.question ?? step.key}>
            {(step.options ?? []).map((opt) => {
              const on = picked.includes(opt.value);
              return (
                <button
                  key={opt.value}
                  type="button"
                  role="checkbox"
                  aria-checked={on}
                  className={`pf-choice-list pf-choice-list--multi${on ? ' pf-choice-list--selected' : ''}`}
                  onClick={() =>
                    onChange(on ? picked.filter((v) => v !== opt.value) : [...picked, opt.value])
                  }
                >
                  <span className="pf-choice-list__check" aria-hidden="true" />
                  <span className="pf-choice-list__text">{opt.label}</span>
                </button>
              );
            })}
          </div>
        );
      }
      if (resolveOptionLayout(step) === 'cards') {
        return (
          <div className="pf-choices--icons" role="radiogroup" aria-label={step.question ?? step.key}>
            {(step.options ?? []).map((opt) => (
              <button
                key={opt.value}
                type="button"
                role="radio"
                aria-checked={value === opt.value}
                className={`pf-choice-icon${value === opt.value ? ' pf-choice-icon--selected' : ''}`}
                onClick={() => onSelect(opt.value)}
              >
                <OptionIcon option={opt} layout="cards" />
                <span className="pf-choice-icon__label">{opt.label}</span>
              </button>
            ))}
          </div>
        );
      }
      return (
        <div className="pf-choices--list" role="radiogroup" aria-label={step.question ?? step.key}>
          {(step.options ?? []).map((opt) => (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={value === opt.value}
              className={`pf-choice-list${value === opt.value ? ' pf-choice-list--selected' : ''}`}
              onClick={() => onSelect(opt.value)}
            >
              {opt.icon ? (
                <OptionIcon option={opt} layout="list" />
              ) : (
                <span className="pf-choice-list__radio" aria-hidden="true" />
              )}
              <span className="pf-choice-list__text">{opt.label}</span>
            </button>
          ))}
        </div>
      );

    case 'slider':
      return <SliderInput step={step} value={value} onChange={onChange} onSeed={onSeed} />;

    case 'message':
      return step.helper ? <p className="pf-message__body">{step.helper}</p> : null;

    default:
      return null;
  }
}

function SliderInput({
  step,
  value,
  onChange,
  onSeed,
}: {
  step: FormStep;
  value: AnswerValue;
  onChange: (value: AnswerValue) => void;
  /** Mount-time default seeding — see {@link StepInputProps.onSeed}. */
  onSeed?: (value: AnswerValue) => void;
}) {
  const { min, max } = sliderBounds(step);
  const stepSize = step.step ?? 1;
  // Clamped so a config with an out-of-bounds default can't drive the fill past
  // 100% (or seed an unsubmittable answer) for real respondents — V5-A2.
  const current = clampSliderValue(step, value != null && value !== '' ? Number(value) : (step.default ?? min));
  const ref = useRef<HTMLInputElement>(null);
  const pct = max > min ? ((current - min) / (max - min)) * 100 : 0;

  useEffect(() => {
    ref.current?.style.setProperty('--pf-progress', `${pct}%`);
  }, [pct]);

  // Seed the default answer so an untouched (optional) slider still submits a
  // value. Routed through `onSeed` when provided: this is NOT an interaction,
  // and the vertical layout must not count it as one (start/step_complete).
  useEffect(() => {
    if (value == null || value === '') (onSeed ?? onChange)(current);
  }, []);

  return (
    <div className="pf-slider">
      <div className="pf-slider__pill">
        <span className="pf-slider__pill-num">{current}</span>
        {step.sliderUnitLabel ? (
          <span className="pf-slider__pill-label">{step.sliderUnitLabel}</span>
        ) : null}
      </div>
      <input
        ref={ref}
        type="range"
        className="pf-slider__input"
        style={{ ['--pf-progress']: `${pct}%` } as React.CSSProperties}
        min={min}
        max={max}
        step={stepSize}
        value={current}
        aria-label={step.question ?? step.key}
        onChange={(e) => {
          const v = Number(e.target.value);
          e.target.style.setProperty('--pf-progress', `${max > min ? ((v - min) / (max - min)) * 100 : 0}%`);
          onChange(v);
        }}
      />
      <div className="pf-slider__scale" aria-hidden="true">
        <span>{min}</span>
        <span>{max}</span>
      </div>
    </div>
  );
}
