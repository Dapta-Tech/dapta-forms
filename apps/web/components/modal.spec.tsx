// @vitest-environment happy-dom
/**
 * `Modal`'s `portal` prop and its Tab trap.
 *
 * The rail's "New workspace" dialog renders inside the rail, a stacking
 * context it cannot paint out of, so it portals to <body>; a dialog opened
 * from another dialog must stay where it is, because nesting is decided by the
 * DOM. The browser half (what actually paints on top) is
 * qa/component/rail-dialog-layering.spec.ts.
 */
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Modal } from './modal';
import { LAYER } from '@/lib/layers';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;
let close: () => void;

function Harness({ portal }: { portal?: boolean }) {
  const [open, setOpen] = useState(true);
  close = () => setOpen(false);
  return (
    <aside data-rail>
      <Modal open={open} onClose={() => setOpen(false)} title="New workspace" labelId="t" portal={portal}>
        <input name="name" />
        <button type="button">Cancel</button>
        <button type="submit">Create</button>
      </Modal>
    </aside>
  );
}

async function mount(portal?: boolean) {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<Harness portal={portal} />));
}

const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]')!;
const tab = (shiftKey = false) =>
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true }));
  });

beforeEach(() => {
  document.body.innerHTML = '';
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

describe('Modal portal', () => {
  it('renders in place by default, inside the element that opened it', async () => {
    await mount();
    expect(host.querySelector('[data-rail]')!.contains(dialog())).toBe(true);
  });

  it('with `portal`, renders as a child of <body>, out of the rail', async () => {
    await mount(true);
    const overlay = dialog().parentElement!;
    expect(overlay.parentElement).toBe(document.body);
    expect(host.contains(dialog())).toBe(false);
    expect(overlay.style.zIndex).toBe(String(LAYER.overlay));
  });

  it('with `portal`, hides the app behind it from assistive tech, and restores it on close', async () => {
    await mount(true);
    expect(host.getAttribute('aria-hidden')).toBe('true');
    expect(dialog().getAttribute('aria-modal')).toBe('true');
    await act(async () => close());
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(host.hasAttribute('aria-hidden')).toBe(false);
  });

  it('focuses the first control on open', async () => {
    await mount(true);
    expect(document.activeElement).toBe(dialog().querySelector('input'));
  });
});

describe('Modal Tab trap', () => {
  it('moves every Tab by hand, through the buttons and back round', async () => {
    // Safari does not Tab to buttons, so a trap that only wraps at the last
    // control let focus out of the dialog from its only text field.
    await mount(true);
    const [input, cancel, create] = [...dialog().querySelectorAll<HTMLElement>('input, button')];
    await tab();
    expect(document.activeElement).toBe(cancel);
    await tab();
    expect(document.activeElement).toBe(create);
    await tab();
    expect(document.activeElement).toBe(input);
    await tab(true);
    expect(document.activeElement).toBe(create);
  });

  it('reaches an iframe (the file preview), since nothing off the list is reachable', async () => {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    await act(async () =>
      root.render(
        <Modal open onClose={() => {}} title="Preview" labelId="p" portal>
          <button type="button">Download</button>
          <iframe title="file" />
        </Modal>,
      ),
    );
    await tab();
    expect(document.activeElement?.tagName).toBe('IFRAME');
  });

  it('pulls focus back in from outside the dialog', async () => {
    await mount(true);
    const outside = document.createElement('button');
    document.body.append(outside);
    outside.focus();
    await tab();
    expect(document.activeElement).toBe(dialog().querySelector('input'));
    outside.remove();
  });
});
