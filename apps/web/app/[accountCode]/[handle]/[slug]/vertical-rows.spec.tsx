// @vitest-environment happy-dom
/**
 * The one-page form as a regular web form (#127): two consecutive half-width
 * questions share a row, a name step can show a label above each input, and
 * `branding.density: 'compact'` marks the root for the compact CSS. Slides
 * ignores all three. Static markup only, same mocks as `legacy-markup.spec`.
 */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

// `next/font/google` resolves at build time and has no runtime in vitest.
vi.mock('next/font/google', () => {
  const font = () => ({ className: 'font', variable: '--font', style: { fontFamily: 'font' } });
  return {
    DM_Sans: font,
    Figtree: font,
    Fraunces: font,
    Hanken_Grotesk: font,
    JetBrains_Mono: font,
    Inter: font,
    Manrope: font,
    Playfair_Display: font,
    Poppins: font,
    Space_Grotesk: font,
    Work_Sans: font,
  };
});

vi.mock('./transport', () => ({
  submitForm: vi.fn(),
  recordEvent: vi.fn(async () => undefined),
  recordEvents: vi.fn(async () => undefined),
  recordBooking: vi.fn(async () => undefined),
  presignUpload: vi.fn(async () => ({ ok: false })),
}));

import { FormRenderer } from './form-renderer';
import { VerticalFormRenderer } from './vertical-form-renderer';

type Step = Record<string, unknown>;

function vertical(steps: Step[], extra: Record<string, unknown> = {}): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = renderToStaticMarkup(
    <VerticalFormRenderer
      accountCode="acme"
      slug="f"
      name="Clinic contact"
      config={{ version: 1, layout: 'vertical', steps, ...extra } as never}
      locale="en"
    />,
  );
  return host;
}

function slides(steps: Step[], extra: Record<string, unknown>, startAt: number): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = renderToStaticMarkup(
    <FormRenderer
      accountCode="acme"
      slug="f"
      name="Clinic contact"
      config={{ version: 1, layout: 'slides', steps, ...extra } as never}
      locale="en"
      startAt={startAt}
    />,
  );
  return host;
}

const half = (key: string, type = 'text'): Step => ({ key, type, question: `${key}?`, width: 'half' });
const nameStep: Step = {
  key: 'name',
  type: 'name',
  question: 'Full name',
  required: true,
  fieldLabels: { firstname: 'Nombre', lastname: 'Apellido' },
};

describe('one-page rows', () => {
  it('puts two consecutive half questions in one row', () => {
    const html = vertical([half('phone', 'phone'), half('email', 'email')]);
    const rows = html.querySelectorAll('.pf-v__row');
    expect(rows).toHaveLength(1);
    const cells = rows[0]!.querySelectorAll(':scope > section.pf-v__question[data-vf-step]');
    expect([...cells].map((c) => c.getAttribute('data-vf-step'))).toEqual(['phone', 'email']);
  });

  it('leaves a lone half question as a bare section', () => {
    const html = vertical([half('phone', 'phone'), { key: 'notes', type: 'textarea', question: 'Notes?' }]);
    expect(html.querySelector('.pf-v__row')).toBeNull();
    expect(html.querySelectorAll('section[data-vf-step]')).toHaveLength(2);
  });

  it('pairs over the live walk: a hidden question between two halves does not split them', () => {
    const html = vertical([half('a'), { key: 'secret', type: 'text', question: 's', hidden: true }, half('b')]);
    const row = html.querySelector('.pf-v__row');
    expect([...row!.querySelectorAll('section')].map((c) => c.getAttribute('data-vf-step'))).toEqual(['a', 'b']);
  });
});

describe('density', () => {
  const steps = [half('phone', 'phone'), half('email', 'email')];

  it('marks the root only for compact', () => {
    expect(vertical(steps, { branding: { density: 'compact' } }).querySelector('.pf--vertical')!.getAttribute('data-pf-density')).toBe(
      'compact',
    );
    expect(vertical(steps).querySelector('.pf--vertical')!.hasAttribute('data-pf-density')).toBe(false);
    expect(
      vertical(steps, { branding: { density: 'comfortable' } }).querySelector('.pf--vertical')!.hasAttribute('data-pf-density'),
    ).toBe(false);
  });
});

describe('name field labels', () => {
  it('shows a label above each input and keeps the title for screen readers only', () => {
    const html = vertical([nameStep]);
    const section = html.querySelector('section.pf-v__question--labelled');
    expect(section).not.toBeNull();
    const title = section!.querySelector('h2.pf__question');
    expect(title!.classList.contains('sr-only')).toBe(true);
    expect(title!.textContent).toContain('Full name');
    expect(section!.querySelector('.pf-name-fields--labelled')).not.toBeNull();
    const labels = section!.querySelectorAll('label.pf-name-field');
    expect(labels).toHaveLength(2);
    expect([...labels].map((l) => l.querySelector('.pf-name-field__label')!.textContent)).toEqual(['Nombre*', 'Apellido*']);
    for (const input of section!.querySelectorAll('input')) expect(input.hasAttribute('aria-label')).toBe(false);
  });

  it('puts the localized default on the sub-field with no label', () => {
    const html = vertical([{ ...nameStep, required: false, fieldLabels: { firstname: 'Nombre' } }]);
    const labels = [...html.querySelectorAll('.pf-name-field__label')].map((l) => l.textContent);
    expect(labels).toEqual(['Nombre', 'Last name']);
  });

  it('keeps today\'s markup without labels', () => {
    const html = vertical([{ ...nameStep, fieldLabels: undefined }]);
    expect(html.querySelector('.pf-v__question--labelled')).toBeNull();
    expect(html.querySelector('h2.pf__question')!.classList.contains('sr-only')).toBe(false);
    expect(html.querySelector('label.pf-name-field')).toBeNull();
    expect(html.querySelectorAll('.pf-name-fields input[aria-label]')).toHaveLength(2);
  });
});

describe('slides ignores width, fieldLabels and density', () => {
  it('renders no rows, no labels and no density attribute', () => {
    const steps = [nameStep, half('phone', 'phone'), half('email', 'email')];
    const branding = { density: 'compact' };
    for (const startAt of [0, 1, 2]) {
      const html = slides(steps, { branding }, startAt);
      expect(html.querySelector('.pf-v__row')).toBeNull();
      expect(html.querySelector('.pf-name-field')).toBeNull();
      expect(html.querySelector('[data-pf-density]')).toBeNull();
      // Same markup as the config without the three fields.
      const bare = slides(
        [{ ...nameStep, fieldLabels: undefined }, { ...steps[1], width: undefined }, { ...steps[2], width: undefined }],
        {},
        startAt,
      );
      expect(html.innerHTML).toBe(bare.innerHTML);
    }
  });
});

describe('re-pairing keeps the caret', () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

  it('keeps focus and value in A when typing in it shows C and breaks the A + B pair', async () => {
    const steps = [
      half('a'),
      { key: 'c', type: 'text', question: 'c?', showWhen: { field: 'a', values: ['x'] } },
      half('b'),
    ];
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    await act(async () =>
      root.render(
        <VerticalFormRenderer
          accountCode="acme"
          slug="f"
          name="Clinic contact"
          config={{ version: 1, layout: 'vertical', steps } as never}
          locale="en"
        />,
      ),
    );
    const inputOf = (key: string) => host.querySelector<HTMLInputElement>(`[data-vf-step="${key}"] input`)!;
    expect(host.querySelector('.pf-v__row')).not.toBeNull();

    const before = inputOf('a');
    await act(async () => before.focus());
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(before, 'x');
      before.dispatchEvent(new Event('input', { bubbles: true }));
    });

    // C shows, so A and B are no longer neighbours: A remounted as a bare section.
    expect(host.querySelector('[data-vf-step="c"]')).not.toBeNull();
    expect(host.querySelector('.pf-v__row')).toBeNull();
    const after = inputOf('a');
    expect(after).not.toBe(before);
    expect(document.activeElement).toBe(after);
    expect(after.value).toBe('x');

    await act(async () => root.unmount());
    host.remove();
  });
});
