// @vitest-environment happy-dom
/**
 * The `multiple_choice` render matrix: layout (`resolveOptionLayout`) and
 * selection mode (`isMultiSelect`) are independent axes. The regression pinned
 * here: a multi-select step configured with `optionLayout: 'cards'` silently
 * fell back to the checkbox ROW list — the builder canvas draws the card grid
 * for that exact config, so the published form disagreed with its own preview.
 */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
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

/**
 * Long text with length limits. The promise pinned here is the back-compat one:
 * a question with neither limit renders the same bare textarea it always has:
 * no wrapper, no counter, no `maxlength`.
 */
describe('textarea: character limits + live counter', () => {
  const longText: FormStep = { key: 'why', type: 'textarea', question: 'Tell us more' };

  it('renders nothing new when no limit is configured', () => {
    const html = render(longText, 'hello');
    expect(html).toContain('pf-input pf-textarea');
    expect(html).not.toContain('char-counter');
    expect(html).not.toContain('maxLength');
  });

  it('caps typing and counts against the maximum', () => {
    const html = render({ ...longText, maxChars: 200 }, 'hello');
    expect(html).toContain('maxLength="200"');
    expect(html).toContain('data-testid="char-counter"');
    expect(html).toContain('5 / 200');
  });

  it('shows the floor as a hint until it is met, then drops it', () => {
    const short = render({ ...longText, minChars: 20 }, 'hello');
    expect(short).toContain('5 characters');
    expect(short).toContain('20 minimum');
    const met = render({ ...longText, minChars: 20 }, 'a'.repeat(25));
    expect(met).toContain('25 characters');
    expect(met).not.toContain('20 minimum');
    // Whitespace does not meet the floor, the same rule the engine applies.
    expect(render({ ...longText, minChars: 20 }, ' '.repeat(25))).toContain('20 minimum');
  });

  it('a minimum alone still counts, with no ceiling to count against', () => {
    const html = render({ ...longText, minChars: 20 }, 'hello');
    expect(html).toContain('data-testid="char-counter"');
    expect(html).not.toContain('maxLength');
  });
});

describe('name: one-page field labels', () => {
  const name: FormStep = {
    key: 'name',
    type: 'name',
    question: 'Full name',
    fieldLabels: { firstname: 'Nombre', lastname: 'Apellido' },
  };
  const renderName = (step: FormStep, showFieldLabels?: boolean) =>
    renderToStaticMarkup(
      <StepInput
        step={step}
        value={null as never}
        answers={{}}
        onChange={() => {}}
        onFieldChange={() => {}}
        onSelect={() => {}}
        dropdownPlaceholder="Pick one"
        dropdownEmpty="No matches"
        autoFocus={false}
        showFieldLabels={showFieldLabels}
      />,
    );

  it('renders today\'s markup when the renderer does not ask for labels', () => {
    const { fieldLabels: _labels, ...bare } = name;
    expect(renderName(name)).toBe(renderName(bare));
    expect(renderName(name)).not.toContain('pf-name-field"');
  });

  it('renders a label above each input when the renderer asks for them', () => {
    const html = renderName(name, true);
    expect(html).toContain('pf-name-fields pf-name-fields--labelled');
    expect(html.match(/<label class="pf-name-field">/g)).toHaveLength(2);
    expect(html).toContain('<span class="pf-name-field__label">Nombre</span>');
    expect(html).toContain('<span class="pf-name-field__label">Apellido</span>');
    expect(html).not.toContain('aria-label');
  });

  it('renders today\'s markup with showFieldLabels but no label configured', () => {
    const { fieldLabels: _labels, ...bare } = name;
    expect(renderName(bare, true)).toBe(renderName(bare));
  });
});

describe('checkbox', () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const consent: FormStep = {
    key: 'consent',
    type: 'checkbox',
    question: 'Acepto la [política](https://a.co) y [esto](javascript:alert(1))',
    required: true,
  };

  async function mount(props: Partial<Parameters<typeof StepInput>[0]> = {}) {
    const onChange = vi.fn();
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    await act(async () =>
      root.render(
        <StepInput
          step={consent}
          value={undefined}
          answers={{}}
          onChange={onChange}
          onFieldChange={() => {}}
          onSelect={() => {}}
          dropdownPlaceholder="Pick one"
          dropdownEmpty="No matches"
          {...props}
        />,
      ),
    );
    const done = async () => {
      await act(async () => root.unmount());
      host.remove();
    };
    return { host, onChange, done };
  }

  it('renders a native box and a safe link that opens in a new tab', () => {
    const html = render(consent);
    expect(html).toContain('type="checkbox" class="pf-checkbox__box"');
    expect(html).toContain('<a class="pf-checkbox__link" href="https://a.co" target="_blank" rel="noopener noreferrer">política</a>');
    // A javascript: link stays literal text.
    expect(html).toContain('[esto](javascript:alert(1))');
    expect(html).not.toContain('href="javascript');
  });

  it('a click on the box answers true, and on a ticked box answers undefined', async () => {
    const off = await mount();
    await act(async () => off.host.querySelector<HTMLInputElement>('input.pf-checkbox__box')!.click());
    expect(off.onChange).toHaveBeenCalledWith(true);
    await off.done();

    const on = await mount({ value: true });
    expect(on.host.querySelector<HTMLInputElement>('input.pf-checkbox__box')!.checked).toBe(true);
    await act(async () => on.host.querySelector<HTMLInputElement>('input.pf-checkbox__box')!.click());
    expect(on.onChange).toHaveBeenCalledWith(undefined);
    await on.done();
  });

  it('a click on the link does not change the box', async () => {
    const t = await mount();
    const link = t.host.querySelector<HTMLAnchorElement>('a.pf-checkbox__link')!;
    // The test DOM must not try to navigate.
    link.addEventListener('click', (e) => e.preventDefault());
    await act(async () => link.click());
    expect(t.onChange).not.toHaveBeenCalled();
    await t.done();
  });

  it('paints the required mark only when asked, and takes the label id', () => {
    expect(render(consent)).not.toContain('pf-v__required');
    const html = renderToStaticMarkup(
      <StepInput
        step={consent}
        value={undefined}
        answers={{}}
        onChange={() => {}}
        onFieldChange={() => {}}
        onSelect={() => {}}
        dropdownPlaceholder="Pick one"
        dropdownEmpty="No matches"
        showRequiredMark
        labelId="q-consent"
      />,
    );
    expect(html).toContain('<span class="pf-checkbox__text" id="q-consent">');
    expect(html).toContain('class="pf-v__required"');
  });

  it('an empty text falls back to the step key', () => {
    expect(render({ ...consent, question: '' })).toContain('<span class="pf-checkbox__text">consent</span>');
  });
});

describe('phone: placeholder and focus', () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const phone = (placeholder?: string | null): FormStep => ({
    key: 'phone',
    type: 'phone',
    question: 'Your phone?',
    phoneDefaultCountry: 'US',
    ...(placeholder === undefined ? {} : { placeholder }),
  });
  const placeholderOf = (html: string) => /<input[^>]*type="tel"[^>]*>/.exec(html)?.[0].match(/placeholder="([^"]*)"/)?.[1];

  it('shows the configured placeholder as is', () => {
    expect(placeholderOf(render(phone('Tu celular')))).toBe('Tu celular');
  });

  it('absent, null or blank keeps the country mask', () => {
    const mask = placeholderOf(render(phone()));
    expect(mask).toBe('(000) 000-0000');
    expect(placeholderOf(render(phone(null)))).toBe(mask);
    expect(placeholderOf(render(phone('  ')))).toBe(mask);
  });

  it('phoneAutoFocus false leaves the input unfocused after mount', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    await act(async () =>
      root.render(
        <StepInput
          step={phone()}
          value=""
          answers={{}}
          onChange={() => {}}
          onFieldChange={() => {}}
          onSelect={() => {}}
          dropdownPlaceholder="Pick one"
          dropdownEmpty="No matches"
          autoFocus={false}
          phoneAutoFocus={false}
        />,
      ),
    );
    const input = host.querySelector<HTMLInputElement>('input[type="tel"]')!;
    expect(input).not.toBeNull();
    expect(document.activeElement).not.toBe(input);
    await act(async () => root.unmount());
    host.remove();
  });
});
