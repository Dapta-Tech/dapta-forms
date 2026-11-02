// @vitest-environment happy-dom
/**
 * The one-page canvas (#127): two consecutive half-width questions share a row
 * (two columns on desktop, one on the phone frame), compact density drops the
 * lines between questions, and a name step with field labels shows them above
 * its inputs with a note that the title is hidden on the form.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import type { FormConfig } from '@quill/engine';
import { getBuilderMessages } from './builder-messages';
import { CanvasPage } from './canvas-question';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// The selected block scrolls into view; happy-dom has no layout to scroll.
Element.prototype.scrollIntoView = () => {};

const m = getBuilderMessages('en');

let root: Root | undefined;
let host: HTMLDivElement | undefined;

afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  root = undefined;
  host = undefined;
});

const config = (extra: Partial<FormConfig> = {}): FormConfig =>
  ({
    version: 1,
    language: 'en',
    layout: 'vertical',
    steps: [
      { key: 'name', type: 'name', question: 'Full name', fieldLabels: { firstname: 'Nombre', lastname: 'Apellido' } },
      { key: 'phone', type: 'phone', question: 'Phone', width: 'half' },
      { key: 'email', type: 'email', question: 'Email', width: 'half' },
      { key: 'notes', type: 'textarea', question: 'Notes', width: 'half' },
    ],
    ...extra,
  }) as FormConfig;

async function renderPage(cfg: FormConfig, device: 'desktop' | 'mobile' = 'desktop') {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root!.render(
      <CanvasPage
        config={cfg}
        selected={0}
        device={device}
        onSelect={() => {}}
        onUpdateStep={() => {}}
        onOptionLabel={() => {}}
        m={m}
      />,
    ),
  );
}

const list = () => host!.querySelector('[data-testid="canvas-page"] > div')!;

describe('CanvasPage rows', () => {
  it('puts two half questions in a two-column row on desktop', async () => {
    await renderPage(config());
    const row = host!.querySelector('[data-testid="page-row-1"]')!;
    expect(row).not.toBeNull();
    expect(row.className).toContain('grid-cols-2');
    expect([...row.querySelectorAll('[data-testid^="page-block-"]')].map((b) => b.getAttribute('data-testid'))).toEqual([
      'page-block-1',
      'page-block-2',
    ]);
    // The textarea cannot be half: it keeps a row of its own.
    expect(host!.querySelectorAll('[data-testid^="page-row-"]')).toHaveLength(1);
  });

  it('stacks the row on the phone frame', async () => {
    await renderPage(config(), 'mobile');
    expect(host!.querySelector('[data-testid="page-row-1"]')!.className).toContain('grid-cols-1');
  });

  it('a hidden step breaks the pair', async () => {
    const cfg = config();
    cfg.steps[1] = { ...cfg.steps[1]!, hidden: true };
    await renderPage(cfg);
    expect(host!.querySelector('[data-testid^="page-row-"]')).toBeNull();
  });
});

describe('CanvasPage density', () => {
  it('keeps the dividers when comfortable and drops them when compact', async () => {
    await renderPage(config());
    expect(list().className).toContain('divide-y');
    expect(host!.querySelector('[data-testid="page-block-0"]')!.className).toContain('py-6');
    await act(async () => root!.unmount());
    host!.remove();

    await renderPage(config({ branding: { density: 'compact' } }));
    expect(list().className).not.toContain('divide-y');
    expect(host!.querySelector('[data-testid="page-block-0"]')!.className).toContain('py-3');
  });
});

describe('CanvasPage name labels', () => {
  it('shows each label above its input and says the title is hidden on the form', async () => {
    await renderPage(config());
    expect(host!.querySelector('[data-testid="canvas-name-label-0"]')!.textContent).toBe('Nombre');
    expect(host!.querySelector('[data-testid="canvas-name-label-1"]')!.textContent).toBe('Apellido');
    expect(host!.querySelector('[data-testid="canvas-name-labels-note"]')!.textContent).toBe(
      m.canvas.nameLabelsTitleHidden,
    );
  });

  it('shows neither without labels', async () => {
    const cfg = config();
    cfg.steps[0] = { key: 'name', type: 'name', question: 'Full name' };
    await renderPage(cfg);
    expect(host!.querySelector('[data-testid="canvas-name-label-0"]')).toBeNull();
    expect(host!.querySelector('[data-testid="canvas-name-labels-note"]')).toBeNull();
  });
});
