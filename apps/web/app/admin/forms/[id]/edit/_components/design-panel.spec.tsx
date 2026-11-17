// @vitest-environment happy-dom
/**
 * The Design tab's one-page controls (#126): "Show header" exists only on a
 * one-page form, and the progress toggle offers there only the two looks a
 * one-page form has (the bar, or nothing). Slides keeps its four. Density
 * (#127) is offered on one page only too.
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

const m = getMessages('en').admin.editor;
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
        locale="en"
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

const headerSwitch = () => host!.querySelector<HTMLButtonElement>('[data-testid="design-show-header"]');
const progressOptions = () =>
  [...host!.querySelectorAll<HTMLButtonElement>(`[role="radiogroup"][aria-label="${d.progress}"] [role="radio"]`)];
const labels = (buttons: HTMLButtonElement[]) => buttons.map((b) => b.textContent);
const checked = (buttons: HTMLButtonElement[]) => buttons.find((b) => b.getAttribute('aria-checked') === 'true')?.textContent;

describe('DesignPanel on a one-page form', () => {
  it('offers "Show header" and a two-option progress toggle', async () => {
    await mount('vertical');
    expect(headerSwitch()).not.toBeNull();
    expect(headerSwitch()!.getAttribute('aria-checked')).toBe('true');
    expect(host!.textContent).toContain(d.showHeaderHint);
    expect(labels(progressOptions())).toEqual([d.progressBar, d.progressNone]);
    expect(checked(progressOptions())).toBe(d.progressBar);
  });

  it('writes showHeader false when switched off, and true when switched back on', async () => {
    const { onBrandingChange } = await mount('vertical');
    await act(async () => headerSwitch()!.click());
    expect(onBrandingChange).toHaveBeenLastCalledWith({ showHeader: false });
    await act(async () => root!.unmount());
    host!.remove();

    const off = await mount('vertical', { showHeader: false });
    expect(headerSwitch()!.getAttribute('aria-checked')).toBe('false');
    await act(async () => headerSwitch()!.click());
    expect(off.onBrandingChange).toHaveBeenLastCalledWith({ showHeader: true });
  });

  it('shows a slides-only progress style as the bar, the look it renders as', async () => {
    await mount('vertical', { progressStyle: 'dots' });
    expect(checked(progressOptions())).toBe(d.progressBar);
  });

  it('writes the two progress looks', async () => {
    const { onBrandingChange } = await mount('vertical');
    await act(async () => progressOptions()[1]!.click());
    expect(onBrandingChange).toHaveBeenLastCalledWith({ progressStyle: 'none' });
    await act(async () => root!.unmount());
    host!.remove();

    const hidden = await mount('vertical', { progressStyle: 'none' });
    expect(checked(progressOptions())).toBe(d.progressNone);
    await act(async () => progressOptions()[0]!.click());
    expect(hidden.onBrandingChange).toHaveBeenLastCalledWith({ progressStyle: 'bar' });
  });
});

describe('DesignPanel on a slides form', () => {
  it('has no header switch and keeps the four progress styles', async () => {
    await mount('slides', { showHeader: false });
    expect(headerSwitch()).toBeNull();
    expect(labels(progressOptions())).toEqual([d.progressBar, d.progressDots, d.progressSteps, d.progressNone]);
  });
});

describe('DesignPanel density (one page only)', () => {
  const densityOptions = () => [...host!.querySelectorAll<HTMLButtonElement>('[data-testid="design-density"] [role="radio"]')];

  it('is offered on a one-page form, comfortable when absent', async () => {
    await mount('vertical');
    expect(host!.querySelector('[data-testid="design-density"]')).not.toBeNull();
    expect(labels(densityOptions())).toEqual([d.densityComfortable, d.densityCompact]);
    expect(checked(densityOptions())).toBe(d.densityComfortable);
    expect(host!.textContent).toContain(d.densityHint);
  });

  it('writes compact, and comfortable back (never clears the key)', async () => {
    const { onBrandingChange } = await mount('vertical');
    await act(async () => densityOptions()[1]!.click());
    expect(onBrandingChange).toHaveBeenLastCalledWith({ density: 'compact' });
    await act(async () => root!.unmount());
    host!.remove();

    const compact = await mount('vertical', { density: 'compact' });
    expect(checked(densityOptions())).toBe(d.densityCompact);
    await act(async () => densityOptions()[0]!.click());
    expect(compact.onBrandingChange).toHaveBeenLastCalledWith({ density: 'comfortable' });
  });

  it('is not offered on slides', async () => {
    await mount('slides', { density: 'compact' });
    expect(host!.querySelector('[data-testid="design-density"]')).toBeNull();
  });
});
