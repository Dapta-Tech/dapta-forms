// @vitest-environment happy-dom
/**
 * A checkbox step (C1 of #125) as a respondent meets it, on the one-page
 * layout and on a slides screen: no title of its own, a required box blocks
 * the submit with the `consent` error, ticking it clears the error and the
 * answer goes out as `true`, unticking leaves no key behind, and a link in its
 * text never ticks the box. Server actions are mocked: no request leaves.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getMessages } from '@quill/shared';

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

const actions = vi.hoisted(() => ({
  submitForm: vi.fn(),
  recordEvent: vi.fn(async () => undefined),
  recordEvents: vi.fn(async () => undefined),
  recordBooking: vi.fn(async () => undefined),
  presignUpload: vi.fn(async () => ({ ok: false })),
}));
vi.mock('./transport', () => actions);

import { FormRenderer } from './form-renderer';
import { VerticalFormRenderer } from './vertical-form-renderer';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const consentCopy = getMessages('es').renderer.errors.consent;

const steps = [
  { key: 'email', type: 'email', question: 'Email?', required: true },
  {
    key: 'consent',
    type: 'checkbox',
    question: 'Acepto la [política de datos](https://example.com/privacidad)',
    required: true,
    // Neither may tick it: consent comes from the person.
    hidden: true,
    defaultValue: 'true',
  },
];

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  window.sessionStorage.clear();
  window.history.replaceState(null, '', '/acme/f/contacto?consent=true');
  actions.submitForm.mockReset();
  actions.submitForm.mockImplementation(async () => ({ ok: true, score: 0, outcome: null }));
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  vi.unstubAllGlobals();
});

async function mount(node: React.ReactNode) {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(node));
}

async function settle() {
  for (let i = 0; i < 8; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

function typeInto(el: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

const box = () => host.querySelector<HTMLInputElement>('input.pf-checkbox__box')!;
const submitButton = () =>
  [...host.querySelectorAll<HTMLButtonElement>('button.pf__btn')].find((b) => !b.classList.contains('pf__back'))!;
const sentData = () =>
  (actions.submitForm.mock.calls.at(-1) as unknown as [string, string, { data: Record<string, unknown> }])[2].data;

describe('one page: a required checkbox', () => {
  const page = () => (
    <VerticalFormRenderer
      accountCode="acme"
      slug="contacto"
      name="Contacto"
      config={{ version: 1, layout: 'vertical', steps } as never}
      locale="es"
    />
  );

  it('has no title, starts unticked despite hidden, a default and the URL, and links open apart', async () => {
    await mount(page());
    const section = host.querySelector('[data-vf-step="consent"]')!;
    expect(section).not.toBeNull();
    expect(section.querySelector('h2.pf__question')).toBeNull();
    expect(box().checked).toBe(false);
    const link = section.querySelector<HTMLAnchorElement>('a.pf-checkbox__link')!;
    expect(link.getAttribute('href')).toBe('https://example.com/privacidad');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(section.querySelector('.pf-v__required')).not.toBeNull();
  });

  it('blocks the submit with the consent error, then sends true once ticked', async () => {
    await mount(page());
    typeInto(host.querySelector<HTMLInputElement>('[data-vf-step="email"] input')!, 'ana@clinica.co');
    await act(async () => submitButton().click());
    await settle();
    expect(actions.submitForm).not.toHaveBeenCalled();
    const section = host.querySelector('[data-vf-step="consent"]')!;
    expect(section.className).toContain('pf-v__question--error');
    expect(section.querySelector('.pf__error')!.textContent).toBe(consentCopy);
    expect(box().getAttribute('aria-invalid')).toBe('true');

    await act(async () => box().click());
    expect(host.querySelector('[data-vf-step="consent"] .pf__error')).toBeNull();
    await act(async () => submitButton().click());
    await settle();
    expect(actions.submitForm).toHaveBeenCalled();
    expect(sentData().consent).toBe(true);
  });

  it('an optional box ticked and unticked leaves no key', async () => {
    const optional = steps.map((s) => (s.key === 'consent' ? { ...s, required: false } : s));
    await mount(
      <VerticalFormRenderer
        accountCode="acme"
        slug="contacto"
        name="Contacto"
        config={{ version: 1, layout: 'vertical', steps: optional } as never}
        locale="es"
      />,
    );
    typeInto(host.querySelector<HTMLInputElement>('[data-vf-step="email"] input')!, 'ana@clinica.co');
    await act(async () => box().click());
    await act(async () => box().click());
    await act(async () => submitButton().click());
    await settle();
    expect(actions.submitForm).toHaveBeenCalled();
    expect('consent' in sentData()).toBe(false);
  });
});

describe('slides: a checkbox on a screen with another question', () => {
  const grouped = steps.map((s) => ({ ...s, screenGroup: 'contact' }));
  const slides = () => (
    <FormRenderer
      accountCode="acme"
      slug="contacto"
      name="Contacto"
      config={{ version: 1, steps: grouped } as never}
      locale="es"
    />
  );

  it('the screen does not advance unticked, and goes once ticked', async () => {
    await mount(slides());
    const member = host.querySelector('[data-pf-step="consent"]')!;
    expect(member.querySelector('h2.pf__question')).toBeNull();
    // The group is still labelled by the box's text.
    expect(member.getAttribute('aria-labelledby')).toBe(member.querySelector('.pf-checkbox__text')!.id);
    typeInto(host.querySelector<HTMLInputElement>('[data-pf-step="email"] input')!, 'ana@clinica.co');
    await act(async () => submitButton().click());
    await settle();
    expect(actions.submitForm).not.toHaveBeenCalled();
    expect(host.querySelector('[data-pf-step="consent"]')!.className).toContain('pf-s__member--error');
    expect(host.querySelector('[data-pf-step="consent"] .pf__error')!.textContent).toBe(consentCopy);

    await act(async () => box().click());
    await act(async () => submitButton().click());
    await settle();
    expect(actions.submitForm).toHaveBeenCalled();
    expect(sentData().consent).toBe(true);
  });
});
