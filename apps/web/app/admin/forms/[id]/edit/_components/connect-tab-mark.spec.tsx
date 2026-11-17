// @vitest-environment happy-dom
/**
 * The mark on the Connect tab's label.
 *
 * A card left out of the save (a webhook switched on with no URL) used to
 * hold the topbar on "Partly saved" for as long as the author stayed in
 * Build, over the builder's own save status. The condition is still true, so
 * it does not vanish: it moves to the Connect tab's label. A change that was
 * lost after the tab was left is marked there too, and announced once.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), toast: vi.fn() }));
vi.mock('@/components/toast', () => ({ useToast: () => toasts }));

import { ConnectTabMark } from './connect-tab-mark';
import {
  publishFormSave,
  publishIntegrationsSave,
  readCombinedSave,
  readIntegrationsSave,
} from '@/lib/integrations-save-status';

let root: Root | null = null;
let container: HTMLElement | null = null;

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.clearAllMocks();
});

async function mount(formId: string) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root!.render(<ConnectTabMark formId={formId} />));
  return container;
}
const mark = (el: HTMLElement) => el.querySelector('[data-testid="connect-tab-mark"]');

describe('the Connect tab is marked while something on it is not stored', () => {
  it('carries a card left out of the save, while the topbar speaks for the builder', async () => {
    const el = await mount('mark-1');
    expect(mark(el)).toBeNull();
    // The author is in Build (the Connect tab is not open for this form).
    await act(async () => publishIntegrationsSave('mark-1', { status: 'partial', detail: 'Saved everything except the webhook.' }));
    expect(mark(el)?.getAttribute('data-kind')).toBe('partial');
    expect(mark(el)?.getAttribute('title')).toBe('Saved everything except the webhook.');
    expect(mark(el)?.textContent).toBe('Saved everything except the webhook.');
    // The builder's own save is what the topbar shows.
    await act(async () => publishFormSave('mark-1', { status: 'saving', detail: null }));
    expect(readCombinedSave('mark-1').status).toBe('saving');
    await act(async () => publishFormSave('mark-1', { status: 'saved', detail: null }));
    expect(readCombinedSave('mark-1').status).toBe('saved');
    expect(mark(el)).not.toBeNull();
    // Back on Connect the tab shows what is stored and reports "saved": the mark goes.
    await act(async () => publishIntegrationsSave('mark-1', { status: 'saved' }));
    expect(mark(el)).toBeNull();
  });

  it('marks a lost change and announces it once, wherever the author is', async () => {
    const el = await mount('mark-2');
    await act(async () => publishIntegrationsSave('mark-2', { status: 'error', detail: 'Not saved after you left.', lost: true }));
    expect(mark(el)?.getAttribute('data-kind')).toBe('lost');
    expect(toasts.error).toHaveBeenCalledTimes(1);
    expect(toasts.error).toHaveBeenCalledWith('Not saved after you left.');
    expect(readIntegrationsSave('mark-2')?.announced).toBe(true);
    // Re-rendering, or mounting again, does not say it twice.
    act(() => root!.unmount());
    container!.remove();
    await mount('mark-2');
    expect(toasts.error).toHaveBeenCalledTimes(1);
  });

  it('shows nothing for a save in progress or a plain failure (the topbar has those)', async () => {
    const el = await mount('mark-3');
    await act(async () => publishIntegrationsSave('mark-3', { status: 'saving' }));
    expect(mark(el)).toBeNull();
    await act(async () => publishIntegrationsSave('mark-3', { status: 'error', detail: 'down' }));
    expect(mark(el)).toBeNull();
  });
});
