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

function render(step: FormStep, value: unknown = null, autoFocus?: boolean) {
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
      autoFocus={autoFocus}
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

/**
 * `autoFocus` must reach EVERY text-entry step, including `phone`. The
 * regression pinned here: the `phone` case dropped the prop and PhoneInput
 * focused its number field unconditionally, so the vertical layout — which
 * renders every question at once and passes `autoFocus={false}` precisely to
 * stop this — still had its phone field grab focus and scroll the page.
 *
 * Focus oracle: these tests assert on the `autofocus` attribute of the rendered
 * `type="tel"` field — the browser's declarative "focus me" directive, i.e. the
 * behavior a respondent actually experiences — never on component source text.
 * The web suite runs in `environment: 'node'` (see vitest.config.ts), so there
 * is no `document.activeElement`; the rendered directive is the observable.
 */
const phone: FormStep = {
  key: 'mobile',
  type: 'phone',
  question: 'What is your phone number?',
};

/** The rendered phone number field, isolated so the assertion cannot be
 *  satisfied by an `autofocus` belonging to some other element. */
function telField(html: string): string {
  const tag = html.match(/<input\b[^>]*\btype="tel"[^>]*>/)?.[0];
  if (!tag) throw new Error(`no tel input rendered:\n${html}`);
  return tag;
}

describe('phone: autoFocus reaches the number field', () => {
  it('autoFocus={false} leaves the phone field unfocused', () => {
    expect(telField(render(phone, '', false))).not.toContain('autofocus');
  });

  it('autoFocus={true} focuses the phone field', () => {
    expect(telField(render(phone, '', true))).toContain('autofocus');
  });

  it('the default still focuses the phone field (slides layout)', () => {
    expect(telField(render(phone, ''))).toContain('autofocus');
  });

  it('other text steps are unchanged by the fix', () => {
    const text: FormStep = { key: 'company', type: 'text', question: 'Company?' };
    expect(render(text, '', false)).not.toContain('autofocus');
    expect(render(text, '')).toContain('autofocus');
    // `name` renders two inputs: only the FIRST one ever autofocuses.
    const name: FormStep = { key: 'full_name', type: 'name', question: 'Your name?' };
    expect(render(name, '', false)).not.toContain('autofocus');
    expect(render(name, '').match(/autofocus/g)).toHaveLength(1);
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
