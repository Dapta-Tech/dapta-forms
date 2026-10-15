// @vitest-environment happy-dom
/**
 * The publish menu's "Revert to the previous published version", driven like
 * a person would.
 *
 * What it promises, each pinned below:
 *   - disabled while the form has no earlier published version, and says so;
 *   - when there is one, it shows the date that version went live, and asks
 *     first in a dialog that names that date and says the draft does not change;
 *   - a confirmed revert flushes pending edits, calls the API and hands the
 *     editor the result; a cancelled one calls nothing;
 *   - a publish lights the item up without a reload, and a 409
 *     NOTHING_TO_REVERT greys it out again;
 *   - English and Spanish.
 *
 * The server actions are mocked: the API side is pinned by the controller spec.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getMessages, t, type Locale } from '@quill/shared';

const actions = vi.hoisted(() => ({
  publishFormAction: vi.fn(),
  revertFormAction: vi.fn(),
}));
vi.mock('@/app/admin/actions', () => actions);
const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), toast: vi.fn() }));
vi.mock('@/components/toast', () => ({ useToast: () => toasts }));

import { PublishButton } from './publish-button';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PREVIOUS_AT = Date.UTC(2026, 9, 3, 14, 30);
const LATER_AT = Date.UTC(2026, 9, 9, 9, 0);

let root: Root;
let host: HTMLDivElement;
const $ = <T extends Element = HTMLElement>(sel: string) => document.querySelector<T>(sel);
const click = (el: Element | null) => act(async () => (el as HTMLElement).click());

const flush = vi.fn();
const onReverted = vi.fn();

async function mount(
  opts: { previousAt?: number | null; hasDraft?: boolean; locale?: Locale } = {},
) {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root.render(
      <PublishButton
        formId="form-1"
        locale={opts.locale ?? 'en'}
        initialHasDraft={opts.hasDraft ?? false}
        initialPreviousPublishedAt={opts.previousAt ?? null}
        flush={flush}
        onReverted={onReverted}
      />,
    ),
  );
}

const when = (ms: number, locale: Locale = 'en') =>
  new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(ms);

async function openMenu() {
  await click($('[data-testid="publish-menu-button"]'));
  expect($('[data-testid="publish-menu"]')).not.toBeNull();
}

const revertItem = () => $('[data-testid="publish-menu-revert"]')!;

const reverted = (over: Record<string, unknown> = {}) => ({
  ok: true,
  updatedAt: 1_700_000_000_500,
  saved: { name: 'Lead quiz', config: { version: 1, steps: [] } },
  hasDraft: false,
  previousPublishedAt: LATER_AT,
  ...over,
});

const m = getMessages('en').admin.publish;

beforeEach(() => {
  // No layout here: a menu whose anchor measures 0x0 closes itself (the
  // trigger is hidden), so the buttons get a size.
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
    DOMRect.fromRect({ x: 900, y: 10, width: 32, height: 36 }),
  );
  actions.publishFormAction.mockReset();
  actions.revertFormAction.mockReset();
  toasts.success.mockReset();
  toasts.error.mockReset();
  flush.mockReset().mockResolvedValue({ ok: true });
  onReverted.mockReset();
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('the publish menu', () => {
  it('sits beside Publish and opens even with nothing to publish', async () => {
    await mount({ hasDraft: false });
    expect($<HTMLButtonElement>('[data-testid="publish-button"]')!.disabled).toBe(true);
    const trigger = $<HTMLButtonElement>('[data-testid="publish-menu-button"]')!;
    expect(trigger.disabled).toBe(false);
    expect(trigger.getAttribute('aria-label')).toBe(m.moreOptions);
    await openMenu();
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(revertItem().textContent).toContain(m.revert);
  });
});

describe('Revert to the previous published version', () => {
  it('is disabled with no earlier published version, says so, and does nothing on click', async () => {
    await mount({ previousAt: null });
    await openMenu();
    expect(revertItem().getAttribute('aria-disabled')).toBe('true');
    expect($('[data-testid="publish-menu-revert-hint"]')!.textContent).toBe(m.revertUnavailable);

    await click(revertItem());
    expect($('[data-testid="confirm-dialog"]')).toBeNull();
    expect(actions.revertFormAction).not.toHaveBeenCalled();
  });

  it('shows when the previous version went live', async () => {
    await mount({ previousAt: PREVIOUS_AT });
    await openMenu();
    expect(revertItem().getAttribute('aria-disabled')).toBe('false');
    expect($('[data-testid="publish-menu-revert-hint"]')!.textContent).toBe(
      t(m.revertAvailable, { date: when(PREVIOUS_AT) }),
    );
  });

  it('asks first, naming the date and saying the draft does not change; cancel calls nothing', async () => {
    await mount({ previousAt: PREVIOUS_AT, hasDraft: true });
    await openMenu();
    await click(revertItem());

    const dialog = $('[data-testid="confirm-dialog"]')!;
    expect(dialog).not.toBeNull();
    expect(dialog.textContent).toContain(m.revertTitle);
    expect(dialog.textContent).toContain(when(PREVIOUS_AT));
    expect(dialog.textContent).toContain('Your draft does not change.');
    expect($('[data-testid="confirm-dialog-confirm"]')!.textContent).toBe(m.revertConfirm);

    await click($('[data-testid="confirm-dialog-cancel"]'));
    expect($('[data-testid="confirm-dialog"]')).toBeNull();
    expect(actions.revertFormAction).not.toHaveBeenCalled();
    expect(flush).not.toHaveBeenCalled();
  });

  it('on confirm, saves pending edits first, reverts, and hands the editor the result', async () => {
    const order: string[] = [];
    flush.mockImplementation(async () => {
      order.push('flush');
      return { ok: true };
    });
    actions.revertFormAction.mockImplementation(async () => {
      order.push('revert');
      return reverted();
    });
    await mount({ previousAt: PREVIOUS_AT });
    await openMenu();
    await click(revertItem());
    await click($('[data-testid="confirm-dialog-confirm"]'));

    expect(order).toEqual(['flush', 'revert']);
    expect(actions.revertFormAction).toHaveBeenCalledWith('form-1');
    expect(onReverted).toHaveBeenCalledWith(reverted());
    expect(toasts.success).toHaveBeenCalledWith(m.reverted);

    // The version just replaced is now the one a revert brings back.
    await openMenu();
    expect($('[data-testid="publish-menu-revert-hint"]')!.textContent).toBe(
      t(m.revertAvailable, { date: when(LATER_AT) }),
    );
  });

  it('reverts nothing when the pending edits cannot be saved', async () => {
    flush.mockResolvedValue({ ok: false, kind: 'error' });
    await mount({ previousAt: PREVIOUS_AT });
    await openMenu();
    await click(revertItem());
    await click($('[data-testid="confirm-dialog-confirm"]'));

    expect(actions.revertFormAction).not.toHaveBeenCalled();
    expect(onReverted).not.toHaveBeenCalled();
    expect(toasts.error).toHaveBeenCalledWith(m.revertSaveFirst);
  });

  it('greys out after a 409 NOTHING_TO_REVERT', async () => {
    actions.revertFormAction.mockResolvedValue({ ok: false, code: 'NOTHING_TO_REVERT' });
    await mount({ previousAt: PREVIOUS_AT });
    await openMenu();
    await click(revertItem());
    await click($('[data-testid="confirm-dialog-confirm"]'));

    expect(toasts.error).toHaveBeenCalledWith(m.nothingToRevert);
    expect(onReverted).not.toHaveBeenCalled();
    await openMenu();
    expect(revertItem().getAttribute('aria-disabled')).toBe('true');
  });

  it('lights up after a publish, without a reload', async () => {
    actions.publishFormAction.mockResolvedValue({
      ok: true,
      updatedAt: 1_700_000_000_100,
      saved: { name: 'Lead quiz', config: { version: 1, steps: [] } },
      previousPublishedAt: PREVIOUS_AT,
    });
    await mount({ previousAt: null, hasDraft: true });
    await click($('[data-testid="publish-button"]'));
    expect(actions.publishFormAction).toHaveBeenCalled();

    await openMenu();
    expect(revertItem().getAttribute('aria-disabled')).toBe('false');
    expect($('[data-testid="publish-menu-revert-hint"]')!.textContent).toBe(
      t(m.revertAvailable, { date: when(PREVIOUS_AT) }),
    );
  });

  it('speaks Spanish with the Spanish catalog', async () => {
    const es = getMessages('es').admin.publish;
    await mount({ previousAt: PREVIOUS_AT, locale: 'es' });
    expect($('[data-testid="publish-menu-button"]')!.getAttribute('aria-label')).toBe(es.moreOptions);
    await openMenu();
    expect(revertItem().textContent).toContain('Volver a la versión publicada anterior');
    expect($('[data-testid="publish-menu-revert-hint"]')!.textContent).toBe(
      t(es.revertAvailable, { date: when(PREVIOUS_AT, 'es') }),
    );
    await click(revertItem());
    expect($('[data-testid="confirm-dialog"]')!.textContent).toContain('Tu borrador no cambia.');
  });
});
