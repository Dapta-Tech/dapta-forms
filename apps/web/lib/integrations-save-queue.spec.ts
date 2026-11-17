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
  integrationsSaveIdle,
  resetIntegrationsSaveQueues,
  runDestinationWrite,
  subscribeIntegrationsSave,
  UNMOUNTED_RETRY_MS,
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
 * A write that is not a snapshot: the Build tab's per-question HubSpot picker
 * (and a field-key rename, and a spreadsheet attached after the tab was left)
 * reads the stored destinations, changes one thing and writes the array back.
 *
 * The first audit's scenario: a save fails as the author leaves Connect, and
 * within a few seconds they map a property from a question in Build. The
 * queue's retry then wrote its older whole array over the new mapping.
 *
 * The second audit's, on the first fix: the queue had waiters that some exits
 * forgot to wake (a save in flight, another waiting, then a pick: nothing
 * ever moved again), and it gave the failed save one early retry and then
 * threw it away. Both are gone with the single write loop: there is nothing
 * to wake, and an outside write waits for the snapshot's whole retry schedule.
 */
describe('a write from outside the queue', () => {
  /** A store every writer shares, like the form's stored destinations. */
  function store(initial = 'A') {
    const state = { value: initial, down: false, failNext: 0, log: [] as string[] };
    /** The Connect tab's whole array. */
    const snapshot = (value: string) => async () => {
      state.log.push(`snapshot:${value}`);
      if (state.down || state.failNext > 0) {
        if (state.failNext > 0) state.failNext -= 1;
        return { ok: false as const, transport: true as const, message: 'network down' };
      }
      state.value = value;
      return { ok: true as const };
    };
    /** Read, change one thing, write back. */
    const outside = (tag: string) => async () => {
      state.log.push(`outside:${tag}`);
      if (state.down) return { ok: false as const, transport: true as const, message: 'network down' };
      state.value = `${state.value}+${tag}`;
      return { ok: true as const };
    };
    return { state, snapshot, outside };
  }
  /** Did this promise settle within the time given? */
  async function settles(p: Promise<unknown>, ms: number): Promise<boolean> {
    let done = false;
    void p.then(
      () => (done = true),
      () => (done = true),
    );
    await vi.advanceTimersByTimeAsync(ms);
    return done;
  }
  const TWENTY_MINUTES = 20 * 60_000;

  it('the first repro, with the mapping written directly: the retry undoes it', async () => {
    const s = store();
    s.state.failNext = 1;
    void enqueueIntegrationsSave('fw0', s.snapshot('S1'), { messages: MSG });
    await vi.advanceTimersByTimeAsync(0); // S1 failed, its retry is scheduled
    await s.outside('map')(); // straight to the server, as the picker used to
    expect(s.state.value).toBe('A+map');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(s.state.value).toBe('S1'); // the mapping is gone
  });

  it('waits for the failed save\'s retry, lands on top of it, and nothing undoes it', async () => {
    const s = store();
    s.state.failNext = 1;
    void enqueueIntegrationsSave('fw1', s.snapshot('S1'), { messages: MSG });
    await vi.advanceTimersByTimeAsync(0);
    const pick = runDestinationWrite('fw1', s.outside('map'));
    expect(await settles(pick, UNMOUNTED_RETRY_MS[0])).toBe(true);
    expect(s.state.value).toBe('S1+map');
    await vi.advanceTimersByTimeAsync(TWENTY_MINUTES);
    expect(s.state.value).toBe('S1+map');
    expect(readIntegrationsSave('fw1')).toMatchObject({ status: 'saved' });
  });

  // The DEADLOCK the audit found: with a save in flight and a newer one
  // waiting behind it, a pick made the queue wait on itself. Twenty minutes
  // later the second save had not left and the pick had not run.
  it('a save in flight + a newer one waiting + a pick: all three finish, newest snapshot first', async () => {
    const s = store();
    let release!: () => void;
    const slow = () =>
      new Promise<{ ok: true }>((resolve) => {
        s.state.log.push('snapshot:S1');
        release = () => {
          s.state.value = 'S1';
          resolve({ ok: true });
        };
      });
    const first = enqueueIntegrationsSave('dl1', slow, { messages: MSG });
    await vi.advanceTimersByTimeAsync(0);
    const second = enqueueIntegrationsSave('dl1', s.snapshot('S2'), { messages: MSG });
    const pick = runDestinationWrite('dl1', s.outside('map'));
    await vi.advanceTimersByTimeAsync(0);
    release();
    expect(await settles(Promise.all([first, second, pick]), 1000)).toBe(true);
    expect(s.state.log).toEqual(['snapshot:S1', 'snapshot:S2', 'outside:map']);
    expect(s.state.value).toBe('S2+map');
    expect(readIntegrationsSave('dl1')).toMatchObject({ status: 'saved' });
    expect(integrationsSaveIdle('dl1')).toBe(true);
  });

  // The variant: the retry of a failed save is itself in flight when a new
  // snapshot arrives.
  it('a retry in flight + a new save + a pick: the new save wins and everything settles', async () => {
    const s = store();
    s.state.failNext = 1;
    let releaseRetry!: () => void;
    let calls = 0;
    const flaky = async () => {
      calls += 1;
      if (calls === 1) return s.snapshot('S1')();
      s.state.log.push('snapshot:S1(retry)');
      await new Promise<void>((r) => (releaseRetry = r));
      s.state.value = 'S1';
      return { ok: true as const };
    };
    void enqueueIntegrationsSave('dl2', flaky, { messages: MSG });
    await vi.advanceTimersByTimeAsync(UNMOUNTED_RETRY_MS[0]); // the retry is now in flight
    const newer = enqueueIntegrationsSave('dl2', s.snapshot('S2'), { messages: MSG });
    const pick = runDestinationWrite('dl2', s.outside('map'));
    await vi.advanceTimersByTimeAsync(0);
    releaseRetry();
    expect(await settles(Promise.all([newer, pick]), 1000)).toBe(true);
    expect(s.state.value).toBe('S2+map');
    await vi.advanceTimersByTimeAsync(TWENTY_MINUTES);
    expect(s.state.value).toBe('S2+map');
    expect(integrationsSaveIdle('dl2')).toBe(true);
  });

  // A two-second outage as the author leaves Connect, and a pick one second
  // in. The save used to get a single early retry (which failed) and was
  // then declared lost, although the retry four seconds later would have
  // saved it.
  it('gives the failed save its whole retry schedule before the pick may go ahead', async () => {
    const s = store();
    s.state.down = true;
    void enqueueIntegrationsSave('rs1', s.snapshot('S1'), { messages: MSG });
    await vi.advanceTimersByTimeAsync(1000);
    const pick = runDestinationWrite('rs1', s.outside('map'));
    await vi.advanceTimersByTimeAsync(1000);
    s.state.down = false; // back after two seconds
    expect(await settles(pick, UNMOUNTED_RETRY_MS[0] + UNMOUNTED_RETRY_MS[1])).toBe(true);
    expect(s.state.value).toBe('S1+map');
    expect(readIntegrationsSave('rs1')).toMatchObject({ status: 'saved' });
    expect(readIntegrationsSave('rs1')?.lost).toBeFalsy();
  });

  it('with the API down for good: the save is reported lost once its retries run out, and the pick still gets its answer', async () => {
    const s = store();
    s.state.down = true;
    void enqueueIntegrationsSave('dn1', s.snapshot('S1'), { messages: MSG });
    await vi.advanceTimersByTimeAsync(0);
    const pick = runDestinationWrite('dn1', s.outside('map'));
    expect(await settles(pick, UNMOUNTED_RETRY_MS[0] + UNMOUNTED_RETRY_MS[1] + 10)).toBe(true);
    await expect(pick).resolves.toMatchObject({ ok: false, transport: true });
    // One first attempt plus the bounded retries, then the pick, and nothing after.
    expect(s.state.log).toEqual(['snapshot:S1', 'snapshot:S1', 'snapshot:S1', 'outside:map']);
    expect(readIntegrationsSave('dn1')).toMatchObject({ status: 'error', lost: true, detail: MSG.lost });
    s.state.down = false;
    await vi.advanceTimersByTimeAsync(TWENTY_MINUTES);
    expect(s.state.value).toBe('A'); // the lost snapshot is never written later
    expect(s.state.log).toHaveLength(4);
    expect(integrationsSaveIdle('dn1')).toBe(true);
  });

  it('two picks back to back run in the order made, one at a time', async () => {
    const s = store();
    let inside = 0;
    let overlap = false;
    const slowOutside = (tag: string) => async () => {
      inside += 1;
      if (inside > 1) overlap = true;
      await new Promise<void>((r) => setTimeout(r, 50));
      const out = await s.outside(tag)();
      inside -= 1;
      return out;
    };
    const one = runDestinationWrite('bb1', slowOutside('one'));
    const two = runDestinationWrite('bb1', slowOutside('two'));
    expect(await settles(Promise.all([one, two]), 200)).toBe(true);
    expect(overlap).toBe(false);
    expect(s.state.value).toBe('A+one+two');
    expect(integrationsSaveIdle('bb1')).toBe(true);
  });

  it('a pick that throws rejects its own promise and does not stop the lane', async () => {
    const s = store();
    const bad = runDestinationWrite('th1', async () => {
      throw new Error('boom');
    });
    const good = runDestinationWrite('th1', s.outside('map'));
    const saved = enqueueIntegrationsSave('th1', s.snapshot('S1'), { messages: MSG });
    await expect(bad).rejects.toThrow('boom');
    expect(await settles(Promise.all([good, saved]), 100)).toBe(true);
    expect(integrationsSaveIdle('th1')).toBe(true);
  });

  it('a snapshot that arrives while a pick is running waits for it, then lands', async () => {
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
  });

  // The editor leaving (or coming back) in the middle changes one thing only:
  // who retries a failed latest snapshot. It must never strand anything.
  describe('the tab unmounting in the middle', () => {
    it('with a save in flight and a pick queued behind it', async () => {
      const s = store();
      s.state.down = true;
      const unsubscribe = subscribeIntegrationsSave('um1');
      const save = enqueueIntegrationsSave('um1', async () => {
        await new Promise<void>((r) => setTimeout(r, 100));
        return s.snapshot('S1')();
      }, { messages: MSG });
      const pick = runDestinationWrite('um1', s.outside('map'));
      await vi.advanceTimersByTimeAsync(50);
      unsubscribe(); // the author leaves while the save is in flight
      await vi.advanceTimersByTimeAsync(1000);
      s.state.down = false;
      expect(await settles(Promise.all([save, pick]), 10_000)).toBe(true);
      // Failed with nobody on the tab: the queue retried it, then the pick ran.
      expect(s.state.value).toBe('S1+map');
      expect(integrationsSaveIdle('um1')).toBe(true);
    });

    it('with a retry scheduled and the author coming back', async () => {
      const s = store();
      s.state.failNext = 1;
      void enqueueIntegrationsSave('um2', s.snapshot('S1'), { messages: MSG });
      await vi.advanceTimersByTimeAsync(0);
      const unsubscribe = subscribeIntegrationsSave('um2');
      const pick = runDestinationWrite('um2', s.outside('map'));
      expect(await settles(pick, 10_000)).toBe(true);
      expect(s.state.value).toBe('S1+map');
      unsubscribe();
      expect(integrationsSaveIdle('um2')).toBe(true);
    });

    it('with a pick running', async () => {
      const s = store();
      const unsubscribe = subscribeIntegrationsSave('um3');
      const pick = runDestinationWrite('um3', async () => {
        await new Promise<void>((r) => setTimeout(r, 100));
        return s.outside('map')();
      });
      await vi.advanceTimersByTimeAsync(50);
      unsubscribe();
      const save = enqueueIntegrationsSave('um3', s.snapshot('S1'), { messages: MSG });
      expect(await settles(Promise.all([pick, save]), 1000)).toBe(true);
      expect(integrationsSaveIdle('um3')).toBe(true);
    });
  });

  /**
   * An outside write that has no screen of its own (a spreadsheet attached
   * after the tab was left) reports in the topbar. It is a partial merge, so
   * it must not behave like a snapshot.
   */
  describe('one that reports in the topbar', () => {
    const REPORT = { report: { lost: 'not attached' } };

    it('does not replace the save waiting behind a failed one, nor cancel its retry', async () => {
      const s = store();
      s.state.failNext = 1;
      // The tab's last save (Salesforce switched on) fails once...
      void enqueueIntegrationsSave('rp1', s.snapshot('SF'), { messages: MSG });
      await vi.advanceTimersByTimeAsync(0);
      // ...and the spreadsheet created before leaving is attached.
      const merge = runDestinationWrite('rp1', s.outside('sheet'), REPORT);
      expect(await settles(merge, UNMOUNTED_RETRY_MS[0])).toBe(true);
      // Both are stored: the Salesforce save was retried, the sheet merged on top.
      expect(s.state.value).toBe('SF+sheet');
      expect(readIntegrationsSave('rp1')).toMatchObject({ status: 'saved' });
    });

    it('says "Saving" while it runs and "Saved" when it lands', async () => {
      const s = store();
      let end!: () => void;
      const merge = runDestinationWrite(
        'rp2',
        async () => {
          await new Promise<void>((r) => (end = r));
          return s.outside('sheet')();
        },
        REPORT,
      );
      await vi.advanceTimersByTimeAsync(0);
      expect(readIntegrationsSave('rp2')).toMatchObject({ status: 'saving' });
      end();
      await merge;
      expect(readIntegrationsSave('rp2')).toMatchObject({ status: 'saved' });
    });

    it('reports a lost change when it fails, and never paints "Saved" over the snapshot\'s failure', async () => {
      const s = store();
      s.state.down = true;
      void enqueueIntegrationsSave('rp3', s.snapshot('SF'), { messages: MSG });
      const merge = runDestinationWrite('rp3', s.outside('sheet'), REPORT);
      expect(await settles(merge, 10_000)).toBe(true);
      expect(readIntegrationsSave('rp3')).toMatchObject({ status: 'error', lost: true });

      // The snapshot lost, then the merge lands: still not "saved".
      const t = store();
      t.state.down = true;
      void enqueueIntegrationsSave('rp4', t.snapshot('SF'), { messages: MSG });
      await vi.advanceTimersByTimeAsync(10_000);
      t.state.down = false;
      await runDestinationWrite('rp4', t.outside('sheet'), REPORT);
      expect(t.state.value).toBe('A+sheet');
      expect(readIntegrationsSave('rp4')).toMatchObject({ status: 'error', lost: true, detail: MSG.lost });
    });

    it('does not say "Saved" for a snapshot that arrived while it ran', async () => {
      const s = store();
      let end!: () => void;
      const merge = runDestinationWrite(
        'rp5',
        async () => {
          await new Promise<void>((r) => (end = r));
          return s.outside('sheet')();
        },
        REPORT,
      );
      await vi.advanceTimersByTimeAsync(0);
      let endSave!: () => void;
      const save = enqueueIntegrationsSave(
        'rp5',
        async () => {
          await new Promise<void>((r) => (endSave = r));
          return { ok: true as const };
        },
        { messages: MSG },
      );
      end();
      await merge;
      await vi.advanceTimersByTimeAsync(0);
      expect(readIntegrationsSave('rp5')).toMatchObject({ status: 'saving' });
      endSave();
      await save;
      expect(readIntegrationsSave('rp5')).toMatchObject({ status: 'saved' });
    });
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
