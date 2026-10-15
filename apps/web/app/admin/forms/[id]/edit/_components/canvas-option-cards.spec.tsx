// @vitest-environment happy-dom
/**
 * The builder canvas draws card options the way the public form does: a card
 * without an icon shows its text alone, with no initials in a grey circle. A
 * canvas that still showed "FR" would promise the author something the
 * respondent never sees. The option's icon picker shows an empty slot then.
 */
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import type { FormConfig, FormOption, FormStep } from '@quill/engine';
import { getMessages } from '@quill/shared';
import { getBuilderMessages } from './builder-messages';
import { CanvasQuestion } from './canvas-question';
import { IconPicker } from './icon-picker';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let host: HTMLDivElement | undefined;

afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
});

const m = getBuilderMessages('en');
const opts = getMessages('en').admin.editor.options;

async function mount(node: ReactNode) {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(node));
}

async function renderStep(options: FormOption[], extra: Partial<FormStep> = {}) {
  const step: FormStep = {
    key: 'role',
    type: 'multiple_choice',
    question: 'Your role?',
    optionLayout: 'cards',
    options,
    ...extra,
  };
  const config = { version: 1, language: 'en', steps: [step] } as FormConfig;
  await mount(
    <CanvasQuestion
      config={config}
      step={step}
      index={0}
      total={1}
      device="desktop"
      onUpdate={() => {}}
      onOptionLabel={() => {}}
      m={m}
    />,
  );
}

const cards = () => [...host!.querySelectorAll<HTMLElement>('[data-testid="canvas-option-card"]')];
/** The round plate an emoji or letters sit on. */
const plate = (card: HTMLElement) => card.querySelector('span.rounded-full.bg-muted');

const plain = (label: string, value: string): FormOption => ({ label, value });

describe('canvas: cards without an icon', () => {
  it.each([
    ['one', [plain('Founder', 'founder')]],
    ['two', [plain('Founder', 'founder'), plain('No role', 'none')]],
    [
      'many',
      ['Founder', 'Marketing lead', 'Sales', 'Operations', 'Engineering'].map((l, i) =>
        plain(l, `o${i}`),
      ),
    ],
  ])('show only their editable text, with %s', async (_, options) => {
    await renderStep(options);
    expect(cards()).toHaveLength(options.length);
    for (const [i, card] of cards().entries()) {
      expect(card.dataset.textOnly).toBe('true');
      expect(card.className).toContain('justify-center');
      expect(plate(card)).toBeNull();
      expect(card.querySelector('img')).toBeNull();
      expect(card.querySelector('input')!.value).toBe(options[i]!.label);
    }
  });

  it('keeps the icon of the cards that have one, in the same step', async () => {
    await renderStep([
      { label: 'Leads', value: 'leads', icon: '🧲' },
      { label: 'HubSpot', value: 'hubspot', icon: 'https://cdn.example.com/hubspot.svg' },
      plain('Founder', 'founder'),
    ]);
    const [emoji, logo, text] = cards();
    expect(plate(emoji!)!.textContent).toBe('🧲');
    expect(emoji!.dataset.textOnly).toBeUndefined();
    expect(logo!.querySelector('img')!.getAttribute('src')).toBe(
      'https://cdn.example.com/hubspot.svg',
    );
    expect(text!.dataset.textOnly).toBe('true');
    expect(plate(text!)).toBeNull();
  });

  it('leaves the list layout as it was: letter badges A, B', async () => {
    await renderStep([plain('Founder', 'founder'), plain('Sales', 'sales')], {
      optionLayout: 'list',
    });
    expect(cards()).toHaveLength(0);
    expect(host!.textContent).toContain('A');
    expect(host!.textContent).toContain('B');
  });
});

describe('icon picker: the empty slot', () => {
  it('shows no initials when the option has no icon', async () => {
    await mount(
      <IconPicker value={null} label="Founder Role" layout="cards" onChange={() => {}} m={opts} />,
    );
    const preview = host!.querySelector('[data-testid="icon-picker-preview"]')!;
    expect(preview.textContent).toBe('');
    expect(preview.querySelector('.pi-plus')).not.toBeNull();
    expect(host!.textContent).toContain(opts.iconEmpty);
  });

  it('shows the icon when there is one', async () => {
    await mount(
      <IconPicker value="🧲" label="Leads" layout="cards" onChange={() => {}} m={opts} />,
    );
    expect(host!.querySelector('[data-testid="icon-picker-preview"]')!.textContent).toBe('🧲');
  });
});
