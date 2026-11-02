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
