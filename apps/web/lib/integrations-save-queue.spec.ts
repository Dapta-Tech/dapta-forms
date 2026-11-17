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
import { enqueueIntegrationsSave, resetIntegrationsSaveQueues, subscribeIntegrationsSave } from './integrations-save-queue';
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
