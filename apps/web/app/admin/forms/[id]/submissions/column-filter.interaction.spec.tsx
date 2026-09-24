// @vitest-environment happy-dom
/**
 * The Score menu, driven like a person would: typing applies once the typing
 * pauses, and the menu's Clear stays cleared. It used to undo itself half a
 * second later, when the wait re-applied the bound still in the fields.
 *
 * The router is a stand-in that does what the real one does for these menus:
 * it moves the address bar and hands the page the filter read back from it.
 */
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getMessages } from '@quill/shared';

const router = vi.hoisted(() => ({ push: vi.fn<(url: string) => void>() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));

import { FilterHost, FilterTh, type FilterLabels } from './column-filter';
import { parseViewFilter, type ViewFilter } from './filters';
import type { FilterColumn } from './filter-columns';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const m = getMessages('en').admin.submissions;
const labels: FilterLabels = { ...m.filters, completed: m.badgeCompleted, partial: m.badgePartial };
const columns: FilterColumn[] = [{ id: 'score', kind: 'score', label: 'Score' }];
const scope = { choiceKeys: new Set<string>(), scoring: true };
const read = (search: string) => parseViewFilter(new URLSearchParams(search), scope);

function Page() {
  const [filter, setFilter] = useState<ViewFilter>(() => read(window.location.search));
  router.push.mockImplementation((url: string) => {
    window.history.replaceState(null, '', url);
    setFilter(read(window.location.search));
  });
  return (
    <FilterHost
      columns={columns}
      filter={filter}
      statusCounts={{ completed: 0, partial: 0 }}
      total={0}
      labels={labels}
      locale="en"
    >
      <table>
        <thead>
          <tr>
            <FilterTh columnId="score" className="th">
              Score
            </FilterTh>
          </tr>
        </thead>
      </table>
    </FilterHost>
  );
}

let root: Root;
let host: HTMLDivElement;
const $ = <T extends Element>(sel: string) => document.querySelector<T>(sel);

/** Types into a controlled input the way the browser does: native setter, then an input event. */
function type(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

async function open(search: string) {
  window.history.replaceState(null, '', `/admin/forms/f/submissions${search}`);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<Page />));
  await act(async () => $<HTMLButtonElement>('[data-filter-trigger="score"]')!.click());
}

const min = () => $<HTMLInputElement>('[data-testid="filter-score-min"]')!;
const wait = (ms: number) => act(async () => void vi.advanceTimersByTime(ms));

describe('Score menu', () => {
  beforeEach(() => {
    // No layout here: a menu whose anchor measures 0x0 closes itself (the
    // trigger is hidden), so the buttons get a size.
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
      DOMRect.fromRect({ x: 10, y: 10, width: 24, height: 20 }),
    );
    vi.useFakeTimers();
    router.push.mockReset();
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('applies a bound once the typing pauses, and Clear stays cleared', async () => {
    await open('');
    await act(async () => type(min(), '5'));
    await wait(499);
    expect(router.push).not.toHaveBeenCalled();
    await wait(1);
    expect(router.push).toHaveBeenCalledTimes(1);
    expect(window.location.search).toBe('?scoreMin=5');

    await act(async () => $<HTMLButtonElement>('[data-testid="filter-clear"]')!.click());
    expect(window.location.search).toBe('');
    await wait(2000);
    expect(router.push).toHaveBeenCalledTimes(2);
    expect(window.location.search).toBe('');
    expect(min().value).toBe('');
  });

  it('drops a bound typed and not yet applied when Clear is pressed', async () => {
    await open('?sort=score_desc');
    await act(async () => type(min(), '7'));
    await act(async () => $<HTMLButtonElement>('[data-testid="filter-clear"]')!.click());
    await wait(2000);
    expect(router.push).toHaveBeenCalledTimes(1);
    expect(window.location.search).toBe('');
    expect(min().value).toBe('');
  });

  it('fills the fields from a bound set elsewhere, and applies at once on Enter', async () => {
    await open('?scoreMin=3');
    expect(min().value).toBe('3');
    await act(async () => type(min(), '4'));
    await act(async () => {
      min().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(window.location.search).toBe('?scoreMin=4');
    await wait(2000);
    expect(router.push).toHaveBeenCalledTimes(1);
  });
});
