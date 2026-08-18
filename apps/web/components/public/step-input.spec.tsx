/**
 * The `multiple_choice` render matrix: layout (`resolveOptionLayout`) and
 * selection mode (`isMultiSelect`) are independent axes. The regression pinned
 * here: a multi-select step configured with `optionLayout: 'cards'` silently
 * fell back to the checkbox ROW list — the builder canvas draws the card grid
 * for that exact config, so the published form disagreed with its own preview.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { FormStep } from '@quill/engine';
import { StepInput } from './step-input';

function render(step: FormStep, value: unknown = null) {
  return renderToStaticMarkup(
    <StepInput
      step={step}
      value={value as never}
      answers={{}}
      onChange={() => {}}
      onFieldChange={() => {}}
      onSelect={() => {}}
      dropdownPlaceholder="Pick one"
      dropdownEmpty="No matches"
    />,
  );
}

const cards: FormStep = {
  key: 'use_case',
  type: 'multiple_choice',
  optionLayout: 'cards',
  options: [
    { label: 'Leads', value: 'leads', icon: '🧲' },
    { label: 'Meetings', value: 'meetings', icon: '📅' },
  ],
};

describe('multiple_choice: layout x selection mode', () => {
  it('multi-select + cards renders the card grid with checkbox semantics', () => {
    const html = render({ ...cards, selectionMode: 'multiple' }, ['leads']);
    expect(html).toContain('pf-choices--icons');
    expect(html).toContain('role="checkbox"');
    expect(html).not.toContain('pf-choices--list');
    // The picked card carries the selected state; the other does not.
    expect(html).toContain('pf-choice-icon pf-choice-icon--selected');
    expect(html).toContain('aria-checked="false"');
  });

  it('single-select + cards keeps the radio card grid', () => {
    const html = render(cards, 'leads');
    expect(html).toContain('pf-choices--icons');
    expect(html).toContain('role="radiogroup"');
    expect(html).toContain('role="radio"');
    expect(html).not.toContain('role="checkbox"');
  });

  it('multi-select + list keeps the checkbox rows', () => {
    const html = render(
      { ...cards, optionLayout: 'list', selectionMode: 'multiple' },
      ['meetings'],
    );
    expect(html).toContain('pf-choices--list');
    expect(html).toContain('pf-choice-list--multi');
    expect(html).toContain('role="checkbox"');
    expect(html).not.toContain('pf-choices--icons');
  });

  it('multi-select + cards shows the option icons (emoji reach the card)', () => {
    const html = render({ ...cards, selectionMode: 'multiple' });
    expect(html).toContain('🧲');
    expect(html).toContain('📅');
  });
});

describe('url', () => {
  it('renders a native url input with the url keyboard and the step placeholder', () => {
    const html = render(
      { key: 'site', type: 'url', question: 'Your website', placeholder: 'https://' },
      'acme.com',
    );
    expect(html).toContain('type="url"');
    // React serializes these camelCased in static markup.
    expect(html).toContain('inputMode="url"');
    expect(html).toContain('autoComplete="url"');
    expect(html).toContain('placeholder="https://"');
    expect(html).toContain('aria-label="Your website"');
    expect(html).toContain('value="acme.com"');
    expect(html).toContain('class="pf-input"');
  });
});
