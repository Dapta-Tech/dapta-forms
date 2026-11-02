// @vitest-environment happy-dom
/**
 * The long-text length pair is the one place in the panel where two fields can
 * contradict each other. `formStepSchema` refuses a floor above a ceiling, so
 * the editor must never WRITE that pair in the first place; otherwise a stray
 * keystroke fails the whole form's autosave.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FormLayout, FormStep } from '@quill/engine';
import { getMessages } from '@quill/shared';
import { getBuilderMessages } from './builder-messages';
import { clampCharLimit, QuestionSettings } from './question-settings';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('clampCharLimit', () => {
  it('reads an empty box as no limit on that end', () => {
    expect(clampCharLimit('')).toBeUndefined();
    expect(clampCharLimit('0')).toBeUndefined();
    expect(clampCharLimit('-5')).toBeUndefined();
    expect(clampCharLimit('abc')).toBeUndefined();
  });

  it('squeezes each field against its sibling so min > max is unwritable', () => {
    // A minimum typed above the configured maximum settles at the maximum.
    expect(clampCharLimit('400', undefined, 50)).toBe(50);
    // A maximum typed below the configured minimum settles at the minimum.
    expect(clampCharLimit('10', 50, undefined)).toBe(50);
    // With nothing to contradict, the typed value stands.
    expect(clampCharLimit('400', undefined, undefined)).toBe(400);
    expect(clampCharLimit('400', undefined, 500)).toBe(400);
  });

  it('holds the schema ceiling and rounds a fraction', () => {
    expect(clampCharLimit('99999')).toBe(10_000);
    expect(clampCharLimit('12.4')).toBe(12);
  });
});

// ---------------------------------------------------------------------------
// One page (#127): the half-width control and the name step's field labels.

const bm = getBuilderMessages('en');
const em = getMessages('en').admin.editor;

let root: Root | undefined;
let host: HTMLDivElement | undefined;

afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  root = undefined;
  host = undefined;
});

async function mount(step: FormStep, layout: FormLayout) {
  const onUpdate = vi.fn();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root!.render(
      <QuestionSettings
        formId="f1"
        step={step}
        index={0}
        steps={[step]}
        layout={layout}
        scoringEnabled={false}
        onUpdate={onUpdate}
        onOptionLabel={() => {}}
        onOptionValue={() => {}}
        lockedValues={new Set()}
        onDelete={() => {}}
        bm={bm}
        em={em}
        locale="en"
        revealAfter={false}
        onRevealAfterChange={() => {}}
        onRenameKey={() => {}}
        onOpenConnect={() => {}}
      />,
    ),
  );
  return onUpdate;
}

const widthControl = () => host!.querySelector('[data-testid="step-width"]');
const widthOption = (label: string) =>
  [...host!.querySelectorAll<HTMLButtonElement>('[data-testid="step-width"] [role="radio"]')].find(
    (b) => b.textContent === label,
  )!;

/** Type into a controlled input the way React listens for it. */
async function typeInto(input: HTMLInputElement | HTMLSelectElement, value: string, event = 'input') {
  const proto = input instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(input, value);
  await act(async () => input.dispatchEvent(new Event(event, { bubbles: true })));
}

const email: FormStep = { key: 'email', type: 'email', question: 'Email?' };
const name: FormStep = { key: 'name', type: 'name', question: 'Full name' };

describe('QuestionSettings: width (one page only)', () => {
  it('offers Full and Half on a short input in vertical, and writes them', async () => {
    const onUpdate = await mount(email, 'vertical');
    expect(widthControl()).not.toBeNull();
    await act(async () => widthOption(bm.settings.widthHalf).click());
    expect(onUpdate).toHaveBeenLastCalledWith({ width: 'half' });
    await act(async () => root!.unmount());
    host!.remove();

    const onHalf = await mount({ ...email, width: 'half' }, 'vertical');
    expect(widthOption(bm.settings.widthHalf).getAttribute('aria-checked')).toBe('true');
    await act(async () => widthOption(bm.settings.widthFull).click());
    expect(onHalf).toHaveBeenLastCalledWith({ width: undefined });
  });

  it('is not offered on slides, nor on a type that cannot be half', async () => {
    await mount(email, 'slides');
    expect(widthControl()).toBeNull();
    await act(async () => root!.unmount());
    host!.remove();
    await mount({ key: 'notes', type: 'textarea', question: 'Notes?' }, 'vertical');
    expect(widthControl()).toBeNull();
  });

  it('drops width when the type changes to one that cannot be half', async () => {
    const onUpdate = await mount({ ...email, width: 'half' }, 'vertical');
    // The type picker is the panel's first custom select: open it, pick "Long text".
    await act(async () => host!.querySelector<HTMLButtonElement>('button[aria-haspopup], button[aria-expanded]')!.click());
    const longText = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
      (o) => o.textContent?.includes(bm.gallery.items.long.title),
    )!;
    await act(async () => longText.querySelector('button')!.click());
    const patch = onUpdate.mock.lastCall![0] as Partial<FormStep>;
    expect(patch.type).toBe('textarea');
    expect('width' in patch && patch.width === undefined).toBe(true);
    expect('fieldLabels' in patch && patch.fieldLabels === undefined).toBe(true);
  });
});

describe('QuestionSettings: name field labels (one page only)', () => {
  it('offers a label per sub-field in vertical and not on slides', async () => {
    await mount(name, 'vertical');
    expect(host!.querySelector('[data-testid="name-label-0"]')).not.toBeNull();
    expect(host!.querySelector('[data-testid="name-label-1"]')).not.toBeNull();
    expect(host!.textContent).toContain(em.nameStep.labelHint);
    await act(async () => root!.unmount());
    host!.remove();
    await mount(name, 'slides');
    expect(host!.querySelector('[data-testid="name-label-0"]')).toBeNull();
    expect(host!.textContent).not.toContain(em.nameStep.labelHint);
  });

  it('writes the label under the sub-field key, and clears an emptied one', async () => {
    const onUpdate = await mount(name, 'vertical');
    await typeInto(host!.querySelector<HTMLInputElement>('[data-testid="name-label-0"]')!, 'Nombre');
    expect(onUpdate).toHaveBeenLastCalledWith({ fieldLabels: { firstname: 'Nombre' } });
    await act(async () => root!.unmount());
    host!.remove();

    const withLabel = await mount({ ...name, fieldLabels: { firstname: 'Nombre' } }, 'vertical');
    await typeInto(host!.querySelector<HTMLInputElement>('[data-testid="name-label-0"]')!, '');
    expect(withLabel).toHaveBeenLastCalledWith({ fieldLabels: undefined });
  });

  it('moves the label when the sub-field key is renamed', async () => {
    const onUpdate = await mount({ ...name, fieldLabels: { firstname: 'Nombre' } }, 'vertical');
    const keyInput = [...host!.querySelectorAll<HTMLInputElement>('input')].find((i) => i.value === 'firstname')!;
    await typeInto(keyInput, 'nombre');
    expect(onUpdate).toHaveBeenLastCalledWith({ fields: ['nombre', 'lastname'], fieldLabels: { nombre: 'Nombre' } });
  });
});

// ---------------------------------------------------------------------------
// Checkbox (#128): what the panel offers, and its links section.

describe('QuestionSettings: checkbox', () => {
  const consent: FormStep = {
    key: 'consent',
    type: 'checkbox',
    question: 'Acepto la política de datos',
    required: true,
  };
  const testId = (id: string) => host!.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  const openAdvanced = async () => {
    const toggle = host!.querySelector<HTMLButtonElement>('[data-testid="advanced-settings"] button[aria-expanded]')!;
    if (toggle.getAttribute('aria-expanded') !== 'true') await act(async () => toggle.click());
  };

  it('shows Required and the links section, and none of the controls a checkbox ignores', async () => {
    await mount(consent, 'vertical');
    expect(host!.querySelector(`[aria-label="${bm.settings.required}"]`)).not.toBeNull();
    expect(testId('checkbox-links')).not.toBeNull();
    await openAdvanced();
    expect(testId('step-placeholder')).toBeNull();
    expect(testId('default-answer')).toBeNull();
    expect(testId('prefill-row')).toBeNull();
    expect(host!.querySelector(`[aria-label="${em.behavior.hidden}"]`)).toBeNull();
    expect(host!.querySelector(`[aria-label="${em.behavior.terminal}"]`)).toBeNull();
    expect(host!.textContent).not.toContain(em.variants.title);
  });

  it('announces none of the ignored settings an API config may carry (#128)', async () => {
    const badges = () => [...host!.querySelectorAll('[data-testid="advanced-badge"]')].map((b) => b.textContent);
    const carried = {
      terminal: true,
      hidden: true,
      defaultValue: 'true',
      questionField: 'email',
      questionVariants: { '*': 'Otro texto' },
    };
    await mount({ ...consent, ...carried }, 'vertical');
    expect(badges()).toEqual([]);
    await act(async () => root!.unmount());
    host!.remove();
    // The same settings on a text step are announced.
    await mount({ key: 'company', type: 'text', question: 'Company?', ...carried }, 'vertical');
    expect(badges()).toEqual(
      expect.arrayContaining([bm.settings.badgeEndsForm, bm.settings.badgeHidden, bm.settings.badgeDefault, bm.settings.badgeDynamic]),
    );
  });

  it('a text step still has them (the check above is not vacuous)', async () => {
    await mount({ key: 'company', type: 'text', question: 'Company?' }, 'vertical');
    await openAdvanced();
    expect(testId('default-answer')).not.toBeNull();
    expect(host!.querySelector(`[aria-label="${em.behavior.hidden}"]`)).not.toBeNull();
    expect(testId('checkbox-links')).toBeNull();
  });

  async function addLink(text: string, url: string) {
    await typeInto(testId('checkbox-link-text') as HTMLInputElement, text);
    await typeInto(testId('checkbox-link-url') as HTMLInputElement, url);
  }

  it('wraps the first appearance of the link text', async () => {
    const onUpdate = await mount({ ...consent, question: 'Acepto la política y la política' }, 'vertical');
    await addLink('política', 'https://example.com/p');
    await act(async () => testId('checkbox-link-add')!.click());
    expect(onUpdate).toHaveBeenLastCalledWith({ question: 'Acepto la [política](https://example.com/p) y la política' });
    // The fields are cleared for the next one.
    expect((testId('checkbox-link-text') as HTMLInputElement).value).toBe('');
    expect((testId('checkbox-link-url') as HTMLInputElement).value).toBe('');
  });

  it('appends the link when its text is not in the question', async () => {
    const onUpdate = await mount(consent, 'vertical');
    await addLink('términos', 'https://example.com/t');
    await act(async () => testId('checkbox-link-add')!.click());
    expect(onUpdate).toHaveBeenLastCalledWith({
      question: 'Acepto la política de datos [términos](https://example.com/t)',
    });
  });

  it('does not wrap text that already sits inside a link', async () => {
    const onUpdate = await mount({ ...consent, question: 'Lee la [política](https://a.co)' }, 'vertical');
    await addLink('política', 'https://b.co');
    await act(async () => testId('checkbox-link-add')!.click());
    expect(onUpdate).toHaveBeenLastCalledWith({ question: 'Lee la [política](https://a.co) [política](https://b.co)' });
  });

  it('lists the links and removes one back to its text', async () => {
    const onUpdate = await mount(
      { ...consent, question: 'Acepto la [política](https://a.co) y los [términos](https://b.co)' },
      'vertical',
    );
    const rows = host!.querySelectorAll('[data-testid="checkbox-link"]');
    expect(rows).toHaveLength(2);
    expect(rows[1]!.textContent).toContain('https://b.co');
    const remove = rows[1]!.querySelector<HTMLButtonElement>(`[aria-label="${bm.settings.checkboxLinkRemove}"]`)!;
    await act(async () => remove.click());
    expect(onUpdate).toHaveBeenLastCalledWith({ question: 'Acepto la [política](https://a.co) y los términos' });
  });

  it('keeps Add disabled without text or with a URL that is not http(s)', async () => {
    await mount(consent, 'vertical');
    const add = () => testId('checkbox-link-add') as HTMLButtonElement;
    expect(add().disabled).toBe(true);
    await addLink('política', 'javascript:x');
    expect(add().disabled).toBe(true);
    await typeInto(testId('checkbox-link-url') as HTMLInputElement, 'https://example.com/p');
    expect(add().disabled).toBe(false);
  });
});

describe('QuestionSettings: phone placeholder', () => {
  const phone: FormStep = { key: 'phone', type: 'phone', question: 'Phone?' };
  const field = () => host!.querySelector<HTMLInputElement>('[data-testid="step-placeholder"]');

  it('offers the placeholder field and writes what is typed', async () => {
    const onUpdate = await mount(phone, 'vertical');
    expect(field()).not.toBeNull();
    await typeInto(field()!, 'Celular');
    expect(onUpdate).toHaveBeenLastCalledWith({ placeholder: 'Celular' });
  });

  it('emptying it writes null, back to the automatic mask', async () => {
    const onUpdate = await mount({ ...phone, placeholder: 'Celular' }, 'vertical');
    expect(field()!.value).toBe('Celular');
    await typeInto(field()!, '');
    expect(onUpdate).toHaveBeenLastCalledWith({ placeholder: null });
  });
});
