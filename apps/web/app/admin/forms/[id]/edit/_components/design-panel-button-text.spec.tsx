// @vitest-environment happy-dom
/**
 * The Design tab's button text color (#129): offered only for a solid button,
 * with "Automatic" as its empty state, and a warning with a way back to
 * automatic when the chosen color reads below 4.5:1 on the accent.
 *
 * The live preview is stubbed: it is an iframe with its own document, and
 * what it renders is pinned in the public renderer's specs.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FormBranding, FormConfig, FormLayout } from '@quill/engine';
import { getMessages } from '@quill/shared';

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
vi.mock('./preview-frame', () => ({ PreviewFrame: () => null }));

import { DesignPanel } from './design-panel';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const m = getMessages('es').admin.editor;
const d = m.design;

let root: Root | undefined;
let host: HTMLDivElement | undefined;

afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  root = undefined;
  host = undefined;
});

async function mount(layout: FormLayout, branding: FormBranding = {}) {
  const onBrandingChange = vi.fn();
  const config = {
    version: 1,
    layout,
    steps: [{ key: 'email', type: 'email', question: 'Email?' }],
    branding,
  } as unknown as FormConfig;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root!.render(
      <DesignPanel
        config={config}
        name="Clinic contact"
        publicPath="/acme/f/contact"
        locale="es"
        layout={layout}
        onTitleChange={() => {}}
        onLanguageChange={() => {}}
        onLabelsChange={() => {}}
        onLayoutChange={() => {}}
        hasReveal={false}
        onEndRevealChange={() => {}}
        onCoverChange={() => {}}
        onBrandingChange={onBrandingChange}
        m={m}
      />,
    ),
  );
  return { onBrandingChange };
}

const control = () => host!.querySelector<HTMLButtonElement>(`button[aria-label="${d.buttonTextColor}"]`);
const lowContrast = () =>
  [...host!.querySelectorAll<HTMLElement>('[data-testid="contrast-warning"]')].find((w) =>
    w.textContent?.includes('El texto del botón tiene contraste'),
  );

describe('DesignPanel: button text color', () => {
  it('is offered with a solid button only', async () => {
    expect(d.buttonTextColor).toBe('Color del texto del botón');
    await mount('vertical', {});
    expect(control()).not.toBeNull();
    expect(host!.textContent).toContain(d.buttonTextAuto);
    await act(async () => root!.unmount());
    host!.remove();

    for (const buttonStyle of ['outline', 'soft'] as const) {
      await mount('vertical', { buttonStyle, buttonTextColor: '#FFFFFF' });
      expect(control()).toBeNull();
      expect(host!.textContent).not.toContain(d.buttonTextColor);
      await act(async () => root!.unmount());
      host!.remove();
    }
  });

  it('warns at 2.9:1 (white on #009DFF)', async () => {
    await mount('vertical', { primaryColor: '#009DFF', buttonTextColor: '#FFFFFF' });
    expect(lowContrast()?.textContent).toContain('2.9:1');
    // One warning only: the picker keeps its ratio badge but not its own note.
    const field = control()!.closest('div')!.parentElement!;
    expect(field.textContent).not.toContain(d.contrastFail);
    expect(field.querySelector('[data-testid="contrast-badge"]')?.textContent).toContain('2.9:1');
  });

  it('does not warn at 6.7:1 (white on #1A4FD6)', async () => {
    await mount('vertical', { primaryColor: '#1A4FD6', buttonTextColor: '#FFFFFF' });
    expect(lowContrast()).toBeUndefined();
  });

  it('does not warn without a chosen color, even on #009DFF', async () => {
    await mount('vertical', { primaryColor: '#009DFF' });
    expect(lowContrast()).toBeUndefined();
  });

  it('the warning action goes back to automatic', async () => {
    const { onBrandingChange } = await mount('vertical', { primaryColor: '#009DFF', buttonTextColor: '#FFFFFF' });
    await act(async () => lowContrast()!.querySelector('button')!.click());
    expect(onBrandingChange).toHaveBeenLastCalledWith({ buttonTextColor: null, themePreset: null });
  });
});
