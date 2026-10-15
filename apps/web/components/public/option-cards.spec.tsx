/**
 * Card options without an icon show their text alone. They used to draw the
 * label's initials ("FR", "NR") in a grey circle where the icon goes, which
 * read as a broken logo. Cards that do have an icon are unchanged.
 *
 * StepInput is the one renderer behind the public form, the embedded form and
 * the builder's live preview (an iframe of the same renderer), so pinning it
 * here covers all three; the builder canvas has its own spec.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { FormOption, FormStep } from '@quill/engine';
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

const step = (options: FormOption[], extra: Partial<FormStep> = {}): FormStep => ({
  key: 'role',
  type: 'multiple_choice',
  optionLayout: 'cards',
  options,
  ...extra,
});

const plain = (label: string, value: string): FormOption => ({ label, value });

/** Every card button, as written in the markup. */
const cards = (html: string) =>
  html.match(/<button [^>]*class="pf-choice-icon[^"]*"[^>]*>.*?<\/button>/g) ?? [];

describe('cards without an icon', () => {
  it.each([
    ['one option', [plain('Founder', 'founder')]],
    ['two options', [plain('Founder', 'founder'), plain('No role', 'none')]],
    [
      'many options',
      ['Founder', 'Marketing lead', 'Sales', 'Operations', 'Engineering', 'Something else'].map(
        (l, i) => plain(l, `o${i}`),
      ),
    ],
  ])('show only their text, with %s', (_, options) => {
    const html = render(step(options));
    const drawn = cards(html);
    expect(drawn).toHaveLength(options.length);
    for (const [i, card] of drawn.entries()) {
      expect(card).toContain('pf-choice-icon--text');
      expect(card).not.toContain('pf-choice-icon__circle');
      expect(card).toContain(`<span class="pf-choice-icon__label">${options[i]!.label}</span>`);
    }
    // No initials anywhere: "F" for Founder, "NR" for No role, "ML" for Marketing lead.
    expect(html).not.toMatch(/aria-hidden="true">(F|NR|ML|SE)<\/span>/);
  });

  it('treat a blank icon as no icon', () => {
    const html = render(step([{ label: 'Founder', value: 'founder', icon: '   ' }]));
    expect(cards(html)[0]).toContain('pf-choice-icon--text');
    expect(html).not.toContain('pf-choice-icon__circle');
  });

  it('sit beside cards with an icon, which keep theirs, in the same step', () => {
    const html = render(
      step([
        { label: 'HubSpot', value: 'hubspot', icon: 'https://cdn.example.com/hubspot.svg' },
        { label: 'Leads', value: 'leads', icon: '🧲' },
        { label: 'Other', value: 'other', icon: 'HS' },
        plain('Founder', 'founder'),
      ]),
    );
    const [logo, emoji, letters, text] = cards(html);
    expect(logo).toContain('pf-choice-icon__img');
    expect(logo).not.toContain('pf-choice-icon--text');
    expect(emoji).toContain('<span class="pf-choice-icon__circle" aria-hidden="true">🧲</span>');
    expect(letters).toContain('<span class="pf-choice-icon__circle" aria-hidden="true">HS</span>');
    expect(text).toContain('pf-choice-icon--text');
    expect(text).not.toContain('pf-choice-icon__circle');
  });

  it('keep the selected state, single and multi select', () => {
    const single = cards(
      render(step([plain('Founder', 'founder'), plain('Sales', 'sales')]), 'founder'),
    );
    expect(single[0]).toContain('pf-choice-icon pf-choice-icon--text pf-choice-icon--selected');
    expect(single[0]).toContain('aria-checked="true"');
    const multi = cards(
      render(
        step([plain('Founder', 'founder'), plain('Sales', 'sales')], { selectionMode: 'multiple' }),
        ['sales'],
      ),
    );
    expect(multi[1]).toContain('pf-choice-icon--selected');
    expect(multi[1]).toContain('role="checkbox"');
  });

  it('a legacy showIcons step without optionLayout is cards too, and loses the initials as well', () => {
    const html = render({
      key: 'r',
      type: 'multiple_choice',
      showIcons: true,
      options: [plain('Founder', 'f')],
    });
    expect(cards(html)[0]).toContain('pf-choice-icon--text');
  });
});

describe('the list layout is unchanged', () => {
  it('keeps the radio for an option without an icon, blank or absent', () => {
    const html = render(
      step([plain('Founder', 'founder'), { label: 'Sales', value: 'sales', icon: ' ' }], {
        optionLayout: 'list',
      }),
    );
    expect(html.match(/pf-choice-list__radio/g)).toHaveLength(2);
    expect(html).not.toContain('pf-choice-list__circle');
  });

  it('still draws an emoji, and still degrades a logo to initials', () => {
    const html = render(
      step(
        [
          { label: 'Leads', value: 'leads', icon: '🧲' },
          { label: 'HubSpot Sales', value: 'hs', icon: 'https://cdn.example.com/hubspot.svg' },
        ],
        { optionLayout: 'list' },
      ),
    );
    expect(html).toContain('<span class="pf-choice-list__circle" aria-hidden="true">🧲</span>');
    expect(html).toContain('<span class="pf-choice-list__circle" aria-hidden="true">HS</span>');
  });
});
