/**
 * The Connect tab's per-form save queue.
 *
 * The data loss it exists for: S1 (Salesforce on) in flight, the author
 * switches it off and leaves the tab, the final save S2 writes that, then S1
 * fails and its retry writes "on" over the newer save. A queue that only ever
 * writes and retries the LATEST snapshot cannot do that, and it reports the
 * state of the latest snapshot only, so an older failure is never "lost".
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  enqueueIntegrationsSave,
  resetIntegrationsSaveQueues,
  runDestinationWrite,
  subscribeIntegrationsSave,
} from './integrations-save-queue';
import { awaitPendingDestinationWrite, trackDestinationWrite } from './connect-sync';
import { readIntegrationsSave } from './integrations-save-status';

const MSG = { saveOffline: 'offline', saveError: 'error', lost: 'lost after leaving' };

/** A fake server: records what each call wrote; each call settles when told. */
function server() {
  const writes: string[] = [];
  const pending: Array<{ value: string; settle: (r: unknown) => void }> = [];
  const send = (value: string) => () =>
    new Promise<{ ok: boolean; transport?: boolean; message?: string }>((resolve) => {
      writes.push(value);
      pending.push({ value, settle: resolve as (r: unknown) => void });
    });
  const settleNext = async (r: unknown) => {
    pending.shift()!.settle(r);
    await vi.advanceTimersByTimeAsync(0);
  };
  return { writes, send, settleNext };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  resetIntegrationsSaveQueues();
  vi.useRealTimers();
});

describe('only the latest snapshot is written once a newer one exists', () => {
  it('the reported repro: an older failure is not retried over a newer save', async () => {
    const s = server();
    const unsubscribe = subscribeIntegrationsSave('f1');
    void enqueueIntegrationsSave('f1', s.send('[sf on]'), { messages: MSG });
    await vi.advanceTimersByTimeAsync(0);
    // The author switches it off and leaves the tab: the final save queues.
    unsubscribe();
    const s2 = enqueueIntegrationsSave('f1', s.send('[]'), { messages: MSG });
    await s.settleNext({ ok: false, transport: true, message: 'network down' }); // S1 fails
    await s.settleNext({ ok: true }); // S2 lands
    await expect(s2).resolves.toMatchObject({ kind: 'sent' });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(s.writes).toEqual(['[sf on]', '[]']);
    expect(readIntegrationsSave('f1')).toMatchObject({ status: 'saved' });
    expect(readIntegrationsSave('f1')?.lost).toBeFalsy();
  });

  it('drops a queued snapshot the moment a newer one arrives', async () => {
    const s = server();
    void enqueueIntegrationsSave('f2', s.send('A'), { messages: MSG });
    await vi.advanceTimersByTimeAsync(0);
    const b = enqueueIntegrationsSave('f2', s.send('B'), { messages: MSG });
    void enqueueIntegrationsSave('f2', s.send('C'), { messages: MSG });
    await expect(b).resolves.toEqual({ kind: 'superseded' });
    await s.settleNext({ ok: true });
    await s.settleNext({ ok: true });
    expect(s.writes).toEqual(['A', 'C']);
  });
});

describe('the state reported is the latest snapshot\'s', () => {
  it('never says "lost" when an older save failed and the latest one landed', async () => {
    const s = server();
    void enqueueIntegrationsSave('f3', s.send('old'), { messages: MSG });
    await vi.advanceTimersByTimeAsync(0);
    void enqueueIntegrationsSave('f3', s.send('new'), { messages: MSG });
    await s.settleNext({ ok: false, message: 'server said no' });
    await s.settleNext({ ok: true });
    expect(readIntegrationsSave('f3')).toMatchObject({ status: 'saved' });
    expect(readIntegrationsSave('f3')?.lost).toBeFalsy();
  });

  it('retries the latest snapshot itself only when nobody is on the tab, bounded', async () => {
    const s = server();
    void enqueueIntegrationsSave('f4', s.send('only'), { messages: MSG });
    await s.settleNext({ ok: false, transport: true, message: 'down' });
    await vi.advanceTimersByTimeAsync(1500);
    await s.settleNext({ ok: false, transport: true, message: 'down' });
    await vi.advanceTimersByTimeAsync(4000);
    await s.settleNext({ ok: false, transport: true, message: 'down' });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(s.writes).toEqual(['only', 'only', 'only']);
    expect(readIntegrationsSave('f4')).toMatchObject({ status: 'error', lost: true, detail: 'lost after leaving' });
  });

  it('leaves retrying to the editor while it is mounted', async () => {
    const s = server();
    subscribeIntegrationsSave('f5');
    void enqueueIntegrationsSave('f5', s.send('x'), { messages: MSG });
    await s.settleNext({ ok: false, transport: true, message: 'down' });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(s.writes).toEqual(['x']);
    expect(readIntegrationsSave('f5')).toMatchObject({ status: 'retrying' });
  });

  it('reports a partial save as partial, which is not saved', async () => {
    const s = server();
    void enqueueIntegrationsSave('f6', s.send('x'), { partial: 'All saved except the webhook.', messages: MSG });
    await s.settleNext({ ok: true });
    expect(readIntegrationsSave('f6')).toEqual({ status: 'partial', detail: 'All saved except the webhook.' });
  });
});

/**
 * A write that does not go through the queue's snapshots: the Build tab's
 * per-question HubSpot picker reads the stored destinations, changes one
 * mapping and writes the array back.
 *
 * The audit's scenario: a save fails as the author leaves Connect, and within
 * a few seconds they map a property from a question in Build. The queue's
 * retry then wrote its older whole array over the new mapping. It reproduces:
 * run the same sequence with the mapping written directly (as it was) and the
 * store ends on the snapshot, without the mapping.
 */
describe('a write from outside the queue', () => {
  /** A store both writers share, like the form's stored destinations. */
  function store() {
    const state = { value: 'A', failSnapshot: 1 };
    // The Connect tab's snapshot: fails `failSnapshot` times, then lands.
    const snapshot = (value: string) => async () => {
      if (state.failSnapshot > 0) {
        state.failSnapshot -= 1;
        return { ok: false as const, transport: true as const, message: 'network down' };
      }
      state.value = value;
      return { ok: true as const };
    };
    // The picker: read, change one thing, write back.
    const mapping = async () => {
      state.value = `${state.value}+map`;
      return { ok: true as const };
    };
    return { state, snapshot, mapping };
  }

  it('the repro, with the mapping written directly: the retry undoes it', async () => {
    const s = store();
    void enqueueIntegrationsSave('fw0', s.snapshot('S1'), { messages: MSG });
    await vi.advanceTimersByTimeAsync(0); // S1 failed, its retry is scheduled
    await s.mapping(); // straight to the server, as the picker used to
    expect(s.state.value).toBe('A+map');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(s.state.value).toBe('S1'); // the mapping is gone
  });

  it('runs the waiting retry first, so the write lands on top of it and nothing undoes it', async () => {
    const s = store();
    void enqueueIntegrationsSave('fw1', s.snapshot('S1'), { messages: MSG });
    await vi.advanceTimersByTimeAsync(0);
    await runDestinationWrite('fw1', s.mapping);
    expect(s.state.value).toBe('S1+map');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(s.state.value).toBe('S1+map');
    expect(readIntegrationsSave('fw1')).toMatchObject({ status: 'saved' });
  });

  it('drops a retry that still cannot land, and says that change was lost instead of undoing the write later', async () => {
    const s = store();
    s.state.failSnapshot = 99;
    void enqueueIntegrationsSave('fw2', s.snapshot('S1'), { messages: MSG });
    await vi.advanceTimersByTimeAsync(0);
    await runDestinationWrite('fw2', s.mapping);
    expect(s.state.value).toBe('A+map');
    s.state.failSnapshot = 0; // the network is back: a retry WOULD land now
    await vi.advanceTimersByTimeAsync(60_000);
    expect(s.state.value).toBe('A+map');
    expect(readIntegrationsSave('fw2')).toMatchObject({ status: 'error', lost: true, detail: MSG.lost });
  });

  it('makes a snapshot that arrives meanwhile wait for it, and waits for one already in flight', async () => {
    const order: string[] = [];
    let endWrite!: () => void;
    const outside = runDestinationWrite('fw3', async () => {
      order.push('write:start');
      await new Promise<void>((r) => (endWrite = r));
      order.push('write:end');
    });
    await vi.advanceTimersByTimeAsync(0);
    const saved = enqueueIntegrationsSave(
      'fw3',
      async () => {
        order.push('snapshot');
        return { ok: true as const };
      },
      { messages: MSG },
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(order).toEqual(['write:start']);
    endWrite();
    await outside;
    await saved;
    expect(order).toEqual(['write:start', 'write:end', 'snapshot']);

    // And the other way round: a snapshot in flight finishes first.
    const s = server();
    void enqueueIntegrationsSave('fw4', s.send('S'), { messages: MSG });
    await vi.advanceTimersByTimeAsync(0);
    let ran = false;
    const later = runDestinationWrite('fw4', async () => {
      ran = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(ran).toBe(false);
    await s.settleNext({ ok: true });
    await later;
    expect(ran).toBe(true);
  });
});

/**
 * The Connect tab waits for pending writes before it reads the form. It held
 * ONE write per form: a card action still running (a spreadsheet being
 * created) was replaced by the save the tab flushed on its way out, and a tab
 * opened again read the form before the sheet was attached.
 */
describe('what a reopened Connect tab waits for', () => {
  it('waits for every pending write, a slow action and the save that follows it included', async () => {
    let endAction!: () => void;
    const action = new Promise<void>((r) => (endAction = r));
    trackDestinationWrite('cs1', action);
    // The tab's own flush, registered after the action and finished first.
    trackDestinationWrite('cs1', Promise.resolve());
    let ready = false;
    void awaitPendingDestinationWrite('cs1').then(() => (ready = true));
    await vi.advanceTimersByTimeAsync(0);
    expect(ready).toBe(false);
    // The action's result is saved through the queue as it settles.
    const s = server();
    void action.then(() => enqueueIntegrationsSave('cs1', s.send('with sheet'), { messages: MSG }));
    endAction();
    await vi.advanceTimersByTimeAsync(0);
    expect(ready).toBe(false);
    await s.settleNext({ ok: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(ready).toBe(true);
  });
});
