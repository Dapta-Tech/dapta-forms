/**
 * The funnel-event actions a screen of several questions uses (#200). A batch
 * goes to the API all at once rather than one after another, because the
 * browser runs server actions one at a time and the final submit waits behind
 * this one; and one call never fans out past `EVENTS_PER_CALL`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  postFormEvent: vi.fn(),
  postSubmission: vi.fn(),
  postUploadPresign: vi.fn(),
}));
vi.mock('@/lib/api', () => api);
vi.mock('@/lib/booking-embed', () => ({ postBookingCallback: vi.fn() }));
vi.mock('@/lib/forwarded-for', () => ({ forwardedForChain: vi.fn(async () => undefined) }));

import { recordEventAction, recordEventsAction } from './actions';
import { EVENTS_PER_CALL, eventBatches } from './event-batches';

const views = (n: number) => Array.from({ length: n }, (_, i) => ({ type: 'step_view', stepIndex: i, stepKey: `q${i}` }));

beforeEach(() => {
  api.postFormEvent.mockReset();
});

describe('recordEventsAction', () => {
  it('posts every event of the batch at once, not one after another', async () => {
    const pending: Array<() => void> = [];
    api.postFormEvent.mockImplementation(() => new Promise<void>((resolve) => pending.push(resolve)));
    const done = recordEventsAction('acme', 'f', { sessionId: 's', events: views(3) });
    // All three are in flight before the first answers.
    expect(api.postFormEvent).toHaveBeenCalledTimes(3);
    for (const resolve of pending.reverse()) resolve();
    await done;
    expect(api.postFormEvent.mock.calls.map((c) => c[2])).toEqual([
      { sessionId: 's', type: 'step_view', stepIndex: 0, stepKey: 'q0' },
      { sessionId: 's', type: 'step_view', stepIndex: 1, stepKey: 'q1' },
      { sessionId: 's', type: 'step_view', stepIndex: 2, stepKey: 'q2' },
    ]);
  });

  it('never fans out past one batch per call', async () => {
    api.postFormEvent.mockResolvedValue(undefined);
    await recordEventsAction('acme', 'f', { sessionId: 's', events: views(EVENTS_PER_CALL + 6) });
    expect(api.postFormEvent).toHaveBeenCalledTimes(EVENTS_PER_CALL);
  });

  it('ignores a payload without a list of events', async () => {
    await recordEventsAction('acme', 'f', { sessionId: 's', events: 'x' as never });
    expect(api.postFormEvent).not.toHaveBeenCalled();
  });
});

describe('recordEventAction', () => {
  it('posts one event, as it always did', async () => {
    api.postFormEvent.mockResolvedValue(undefined);
    await recordEventAction('acme', 'f', { sessionId: 's', type: 'view' });
    expect(api.postFormEvent).toHaveBeenCalledWith('acme', 'f', { sessionId: 's', type: 'view' });
  });
});

describe('eventBatches', () => {
  it('splits a big screen into consecutive batches, in order, dropping nothing', () => {
    const batches = eventBatches(views(30));
    expect(batches.map((b) => b.length)).toEqual([24, 6]);
    expect(batches.flat()).toEqual(views(30));
    expect(eventBatches([])).toEqual([]);
  });
});
