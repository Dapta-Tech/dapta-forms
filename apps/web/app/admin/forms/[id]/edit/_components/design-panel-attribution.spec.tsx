// @vitest-environment happy-dom
/**
 * The Design tab under the workspace's "Made with dForms" setting: when the
 * workspace hides the attribution, the badge size does nothing anywhere, so
 * it is disabled with a hint pointing at Brand kit, and the live preview is
 * told to render without the badge. With the setting on (or absent), both
 * are exactly as before, on slides and on one page.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FormConfig, FormLayout } from '@quill/engine';
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
const frame = vi.hoisted(() => ({ props: [] as Array<{ showAttribution?: boolean }> }));
vi.mock('./preview-frame', () => ({
  PreviewFrame: (p: { showAttribution?: boolean }) => {
    frame.props.push(p);
    return null;
  },
}));

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
  frame.props.length = 0;
});

async function mount(layout: FormLayout, showAttribution?: boolean) {
  const onBrandingChange = vi.fn();
  const config = {
    version: 1,
    layout,
    steps: [{ key: 'email', type: 'email', question: 'Email?' }],
    branding: { badgeSize: 'md' },
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
        showAttribution={showAttribution}
        m={m}
      />,
    ),
  );
  return { onBrandingChange };
}

const sizeGroup = () => host!.querySelector<HTMLElement>('[data-testid="design-badge-size"]')!;
const sizeOptions = () => [...sizeGroup().querySelectorAll<HTMLButtonElement>('[role="radio"]')];

describe('Design: badge size under the workspace attribution setting', () => {
  for (const layout of ['slides', 'vertical'] as const) {
    it(`${layout}: enabled with its usual hint when the attribution shows (default)`, async () => {
      const { onBrandingChange } = await mount(layout);
      expect(sizeOptions()).toHaveLength(2);
      expect(sizeOptions().every((b) => !b.disabled)).toBe(true);
      expect(sizeGroup().textContent).toContain(d.badgeSizeHint);
      expect(sizeGroup().textContent).not.toContain(d.badgeSizeHiddenHint);
      await act(async () => sizeOptions()[0]!.click());
      expect(onBrandingChange).toHaveBeenCalledWith({ badgeSize: 'sm' });
      expect(frame.props.at(-1)!.showAttribution).toBe(true);
    });

    it(`${layout}: disabled, pointing at Brand kit, when the workspace hides it`, async () => {
      const { onBrandingChange } = await mount(layout, false);
      expect(sizeOptions().every((b) => b.disabled)).toBe(true);
      expect(sizeGroup().getAttribute('data-disabled')).toBe('true');
      expect(sizeGroup().textContent).toContain(d.badgeSizeHiddenHint);
      expect(sizeGroup().textContent).not.toContain(d.badgeSizeHint);
      await act(async () => sizeOptions()[0]!.click());
      expect(onBrandingChange).not.toHaveBeenCalled();
      // The preview is told, so it renders what the public form will.
      expect(frame.props.at(-1)!.showAttribution).toBe(false);
    });
  }

  it('speaks Spanish', () => {
    expect(getMessages('es').admin.editor.design.badgeSizeHiddenHint).toContain('Kit de marca');
  });
});
