'use client';

import { useEffect, useRef } from 'react';
import type { Answers, AnswerValue, FormStep } from '@quill/engine';
import { nameFields } from '@quill/engine';
import { SearchableDropdown } from './searchable-dropdown';

interface StepInputProps {
  step: FormStep;
  value: AnswerValue;
  answers: Answers;
  onChange: (value: AnswerValue) => void;
  onFieldChange: (field: string, value: AnswerValue) => void;
  /** Choice/dropdown selection auto-advances the form. */
  onSelect: (value: string) => void;
  dropdownPlaceholder: string;
  dropdownEmpty: string;
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
}: StepInputProps) {
  switch (step.type) {
    case 'name': {
      const [firstField, secondField] = nameFields(step);
      return (
        <div className="pf-name-fields">
          {firstField && (
            <input
              type="text"
              className="pf-input"
              value={String(answers[firstField] ?? '')}
              onChange={(e) => onFieldChange(firstField, e.target.value)}
              placeholder={step.placeholders?.[firstField] ?? ''}
              aria-label={step.placeholders?.[firstField] ?? firstField}
              autoFocus
            />
          )}
          {secondField && (
            <input
              type="text"
              className="pf-input"
              value={String(answers[secondField] ?? '')}
              onChange={(e) => onFieldChange(secondField, e.target.value)}
              placeholder={step.placeholders?.[secondField] ?? ''}
              aria-label={step.placeholders?.[secondField] ?? secondField}
            />
          )}
        </div>
      );
    }

    case 'text':
    case 'email':
    case 'phone':
      return (
        <input
          type={step.type === 'email' ? 'email' : step.type === 'phone' ? 'tel' : 'text'}
          inputMode={step.type === 'phone' ? 'tel' : undefined}
          className="pf-input"
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
          placeholder={step.placeholder ?? ''}
          aria-label={step.question ?? step.key}
          autoFocus
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
          autoFocus
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
      if (step.showIcons) {
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
                <span className="pf-choice-icon__circle" aria-hidden="true">
                  {opt.icon ?? opt.label.charAt(0).toUpperCase()}
                </span>
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
                <span className="pf-choice-list__icon" aria-hidden="true">
                  {opt.icon}
                </span>
              ) : (
                <span className="pf-choice-list__radio" aria-hidden="true" />
              )}
              <span className="pf-choice-list__text">{opt.label}</span>
            </button>
          ))}
        </div>
      );

    case 'slider':
      return <SliderInput step={step} value={value} onChange={onChange} />;

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
}: {
  step: FormStep;
  value: AnswerValue;
  onChange: (value: AnswerValue) => void;
}) {
  const min = step.min ?? 0;
  const max = step.max ?? 100;
  const stepSize = step.step ?? 1;
  const current = value != null && value !== '' ? Number(value) : (step.default ?? min);
  const ref = useRef<HTMLInputElement>(null);
  const pct = max > min ? ((current - min) / (max - min)) * 100 : 0;

  useEffect(() => {
    ref.current?.style.setProperty('--pf-progress', `${pct}%`);
  }, [pct]);

  // Seed the default answer so an untouched (optional) slider still submits a value.
  useEffect(() => {
    if (value == null || value === '') onChange(current);
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
