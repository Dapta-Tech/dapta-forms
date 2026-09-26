// @vitest-environment happy-dom
/**
 * A screen of several questions on the slides canvas (#200): the whole card as
 * the respondent sees it, every question editable, the selected one marked,
 * ONE button with the public screen's label rule, and progress in screens.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FormConfig } from '@quill/engine';
import { getBuilderMessages } from './builder-messages';
import { CanvasScreen } from './canvas-question';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// The selected block scrolls into view; happy-dom has no layout to scroll.
Element.prototype.scrollIntoView = () => {};

let root: Root | undefined;
let host: HTMLDivElement | undefined;

afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
});

const config = (buttonText?: string): FormConfig =>
  ({
    version: 1,
    language: 'en',
    branding: { progressStyle: 'steps' },
    steps: [
      { key: 'intro', type: 'message', question: 'Your details', buttonText: 'Continue', screenGroup: 's' },
      { key: 'name', type: 'text', question: 'Your name?', screenGroup: 's' },
      { key: 'email', type: 'email', question: 'Your email?', screenGroup: 's', ...(buttonText ? { buttonText } : {}) },
      { key: 'notes', type: 'textarea', question: 'Anything else?' },
    ],
  }) as FormConfig;

async function renderScreen(cfg: FormConfig, position: number, total: number, onSelect = vi.fn()) {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root!.render(
      <CanvasScreen
        config={cfg}
        members={[0, 1, 2]}
        selected={1}
        position={position}
        total={total}
        device="desktop"
        onSelect={onSelect}
        onUpdateStep={() => {}}
        onOptionLabel={() => {}}
        m={getBuilderMessages('en')}
      />,
    ),
  );
  return onSelect;
}

const buttons = () => [...host!.querySelectorAll('button')].filter((b) => b.querySelector('.pi-arrow-right'));

describe('CanvasScreen', () => {
  it('draws every question of the screen, the selected one marked, and one button', async () => {
    await renderScreen(config(), 0, 2);
    expect(host!.querySelectorAll('[data-testid^="screen-block-"]')).toHaveLength(3);
    expect(host!.querySelector('[aria-current="true"]')!.getAttribute('data-testid')).toBe('screen-block-1');
    expect(buttons()).toHaveLength(1);
  });

  it('counts progress in screens', async () => {
    await renderScreen(config(), 0, 2);
    expect(host!.textContent).toContain('1 / 2');
  });

  it('labels its button the way the public screen does: the last question, else Next or Submit', async () => {
    // A leading message does not lend its "Continue".
    await renderScreen(config(), 0, 2);
    expect(buttons()[0]!.textContent).toBe('Next');
    await act(async () => root?.unmount());
    host?.remove();
    await renderScreen(config(), 1, 2);
    expect(buttons()[0]!.textContent).toBe('Submit');
    await act(async () => root?.unmount());
    host?.remove();
    await renderScreen(config('Send it'), 0, 2);
    expect(buttons()[0]!.textContent).toBe('Send it');
  });

  it('selects the question a click lands in', async () => {
    const onSelect = await renderScreen(config(), 0, 2);
    await act(async () => {
      host!
        .querySelector('[data-testid="screen-block-2"]')!
        .dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    expect(onSelect).toHaveBeenCalledWith(2);
  });
});
