import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AutosaveController, type AutosaveStatus, type SaveOutcome } from './autosave-controller';
import { callAction, isTransportError } from './call-action';

/** Test harness: a controller over a mutable snapshot with a scripted save. */
function harness(overrides?: {
  save?: (s: string) => Promise<SaveOutcome>;
  validate?: (s: string) => { ok: true } | { ok: false; reason: string };
}) {
  const statuses: Array<{ status: AutosaveStatus; detail: string | null }> = [];
  const failures: Array<{ message: string; kind: string }> = [];
  let savedCount = 0;
  const state = { snapshot: 'v1' };
  const saves: string[] = [];
  const controller = new AutosaveController<string>({
    getSnapshot: () => state.snapshot,
    validate: overrides?.validate ?? (() => ({ ok: true })),
    save:
      overrides?.save ??
      (async (s) => {
        saves.push(s);
        return { ok: true };
      }),
    onStatus: (status, detail) => statuses.push({ status, detail }),
    onFailure: (message, kind) => failures.push({ message, kind }),
    onSaved: () => savedCount++,
    debounceMs: 100,
    initialBackoffMs: 1000,
    maxBackoffMs: 8000,
  });
  return {
    controller,
    state,
    saves,
    statuses,
    failures,
    savedCount: () => savedCount,
    lastStatus: () => statuses[statuses.length - 1]?.status,
  };
}

/** Let queued microtasks (the awaited save) settle. */
const settle = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('AutosaveController', () => {
  it('debounces edits into one save and reports saved', async () => {
    const h = harness();
    h.controller.markDirty();
    h.controller.markDirty();
    expect(h.lastStatus()).toBe('saving');
    await vi.advanceTimersByTimeAsync(100);
    expect(h.saves).toEqual(['v1']);
    expect(h.lastStatus()).toBe('saved');
    expect(h.savedCount()).toBe(1);
    expect(h.controller.dirty).toBe(false);
  });

  it('a transport failure never strands "saving": it retries with backoff until success', async () => {
    let attempts = 0;
    const h = harness({
      save: async () => {
        attempts++;
        if (attempts < 3) return { ok: false, transport: true, message: 'offline' };
        return { ok: true };
      },
    });
    h.controller.markDirty();
    await vi.advanceTimersByTimeAsync(100); // debounce → attempt 1 fails
    expect(h.lastStatus()).toBe('retrying');
    await vi.advanceTimersByTimeAsync(1000); // backoff 1 → attempt 2 fails
    expect(h.lastStatus()).toBe('retrying');
    await vi.advanceTimersByTimeAsync(2000); // backoff 2 (doubled) → attempt 3 succeeds
    expect(h.lastStatus()).toBe('saved');
    expect(attempts).toBe(3);
    expect(h.controller.dirty).toBe(false);
    // The user was told once, not once per retry.
    expect(h.failures).toHaveLength(1);
    expect(h.failures[0]).toEqual({ message: 'offline', kind: 'transport' });
  });

  it('a server rejection surfaces as error but still retries', async () => {
    let attempts = 0;
    const h = harness({
      save: async () => (++attempts === 1 ? { ok: false, message: 'boom' } : { ok: true }),
    });
    h.controller.markDirty();
    await vi.advanceTimersByTimeAsync(100);
    expect(h.lastStatus()).toBe('error');
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.lastStatus()).toBe('saved');
  });

  it('a save that THROWS (unwrapped rejection) is treated as transport, not a freeze', async () => {
    let attempts = 0;
    const h = harness({
      save: async () => {
        if (++attempts === 1) throw new Error('Failed to find Server Action');
        return { ok: true };
      },
    });
    h.controller.markDirty();
    await vi.advanceTimersByTimeAsync(100);
    expect(h.lastStatus()).toBe('retrying');
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.lastStatus()).toBe('saved');
  });

  it('edits during an in-flight save keep dirty=true and trigger a follow-up save', async () => {
    let release!: (o: SaveOutcome) => void;
    const gate = new Promise<SaveOutcome>((r) => (release = r));
    let attempts = 0;
    const h = harness({
      save: async (s) => {
        attempts++;
        if (attempts === 1) return gate; // slow first save
        h.saves.push(s);
        return { ok: true };
      },
    });
    h.controller.markDirty();
    await vi.advanceTimersByTimeAsync(100); // save of v1 now in flight
    h.state.snapshot = 'v2';
    h.controller.markDirty(); // edit lands mid-flight
    release({ ok: true }); // old save resolves AFTER the new edit
    await settle();
    // The old save must NOT clear the newer edit's dirtiness…
    // …and the follow-up save must carry v2.
    await vi.advanceTimersByTimeAsync(100);
    await settle();
    expect(h.saves).toContain('v2');
    expect(h.controller.dirty).toBe(false);
    expect(h.lastStatus()).toBe('saved');
    expect(attempts).toBe(2);
  });

  it('never runs overlapping saves', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const h = harness({
      save: async () => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 50));
        inFlight--;
        return { ok: true };
      },
    });
    h.controller.markDirty();
    await vi.advanceTimersByTimeAsync(100);
    h.controller.markDirty();
    h.controller.flush();
    h.controller.flush();
    await vi.advanceTimersByTimeAsync(500);
    expect(maxInFlight).toBe(1);
  });

  it('an invalid snapshot blocks the save with error and does NOT retry', async () => {
    const h = harness({ validate: () => ({ ok: false, reason: 'steps.0: bad' }) });
    h.controller.markDirty();
    await vi.advanceTimersByTimeAsync(100);
    expect(h.statuses[h.statuses.length - 1]).toEqual({ status: 'error', detail: 'steps.0: bad' });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.saves).toEqual([]); // nothing ever sent, nothing retried
    expect(h.controller.dirty).toBe(true); // the work is still owed
  });

  it('flush saves immediately without waiting out the debounce', async () => {
    const h = harness();
    h.controller.markDirty();
    h.controller.flush();
    await settle();
    expect(h.saves).toEqual(['v1']);
    expect(h.lastStatus()).toBe('saved');
  });

  it('flush is a no-op when clean', async () => {
    const h = harness();
    h.controller.flush();
    await settle();
    expect(h.saves).toEqual([]);
    expect(h.statuses).toEqual([]);
  });

  it('dispose stops the retry loop after one terminal attempt', async () => {
    let attempts = 0;
    const h = harness({
      save: async () => {
        attempts++;
        return { ok: false, transport: true, message: 'offline' };
      },
    });
    h.controller.markDirty();
    await vi.advanceTimersByTimeAsync(100);
    expect(attempts).toBe(1);
    h.controller.dispose();
    await settle(); // still dirty → dispose owes ONE fire-and-forget attempt
    expect(attempts).toBe(2);
    await vi.advanceTimersByTimeAsync(60_000); // …and never retries again
    expect(attempts).toBe(2);
  });

  it('dispose while CLEAN fires nothing', async () => {
    const h = harness();
    h.controller.markDirty();
    await vi.advanceTimersByTimeAsync(100); // saved
    h.controller.dispose();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.saves).toEqual(['v1']); // just the one debounced save
  });

  it('unmount during an in-flight save does NOT lose edits made mid-flight (terminal save)', async () => {
    let release!: (o: SaveOutcome) => void;
    const gate = new Promise<SaveOutcome>((r) => (release = r));
    let attempts = 0;
    const h = harness({
      save: async (s) => {
        attempts++;
        if (attempts === 1) return gate; // gen-1 save hangs in flight
        h.saves.push(s);
        return { ok: true };
      },
    });
    h.controller.markDirty();
    await vi.advanceTimersByTimeAsync(100); // save of v1 in flight
    h.state.snapshot = 'v2';
    h.controller.markDirty(); // edit lands mid-flight
    // SPA nav: cleanup runs flush (no-ops: in flight) then dispose.
    h.controller.flush();
    h.controller.dispose();
    await settle();
    // The terminal save carried the LATEST snapshot despite the in-flight save.
    expect(h.saves).toContain('v2');
    release({ ok: true });
    await settle(); // late resolution is inert — no status after disposal
  });

  it('a fresh edit resets the pending retry (debounce path takes over)', async () => {
    let attempts = 0;
    const h = harness({
      save: async () => (++attempts === 1 ? { ok: false, transport: true, message: 'x' } : { ok: true }),
    });
    h.controller.markDirty();
    await vi.advanceTimersByTimeAsync(100); // fails, retry scheduled at +1000
    h.controller.markDirty(); // user keeps typing
    await vi.advanceTimersByTimeAsync(100); // debounce fires the save instead
    expect(attempts).toBe(2);
    expect(h.lastStatus()).toBe('saved');
  });
});

describe('callActionWithRetry', () => {
  it('retries transport failures with doubling delay until one lands', async () => {
    const { callActionWithRetry } = await import('./call-action');
    let attempts = 0;
    const p = callActionWithRetry(
      async () => {
        attempts++;
        if (attempts < 3) throw new Error('network down');
        return { ok: true as const };
      },
      { attempts: 3, baseDelayMs: 100 },
    );
    await settle(); // attempt 1 fails
    expect(attempts).toBe(1);
    await vi.advanceTimersByTimeAsync(100); // delay 1 → attempt 2 fails
    expect(attempts).toBe(2);
    await vi.advanceTimersByTimeAsync(200); // delay doubled → attempt 3 lands
    expect(await p).toEqual({ ok: true });
  });

  it('a server verdict — ok or not — returns immediately, no retry', async () => {
    const { callActionWithRetry } = await import('./call-action');
    let attempts = 0;
    const res = await callActionWithRetry(async () => {
      attempts++;
      return { ok: false as const, message: 'validation failed' };
    });
    expect(attempts).toBe(1); // the server answered; retrying cannot change it
    expect(res).toEqual({ ok: false, message: 'validation failed' });
  });

  it('returns the last TransportError once attempts are exhausted', async () => {
    const { callActionWithRetry } = await import('./call-action');
    let attempts = 0;
    const p = callActionWithRetry(
      async () => {
        attempts++;
        throw new Error('still down');
      },
      { attempts: 2, baseDelayMs: 50 },
    );
    await settle();
    await vi.advanceTimersByTimeAsync(50);
    const res = await p;
    expect(attempts).toBe(2);
    expect(isTransportError(res)).toBe(true);
    if (isTransportError(res)) expect(res.message).toBe('still down');
  });
});

describe('callAction', () => {
  it('passes a resolved value through untouched', async () => {
    const res = await callAction(async () => ({ ok: true as const }));
    expect(res).toEqual({ ok: true });
    expect(isTransportError(res)).toBe(false);
  });

  it('converts a rejection into a TransportError instead of throwing', async () => {
    const res = await callAction(async () => {
      throw new Error('Failed to find Server Action "abc123"');
    });
    expect(isTransportError(res)).toBe(true);
    if (isTransportError(res)) expect(res.message).toContain('Failed to find Server Action');
  });

  it('times out a hung invocation', async () => {
    vi.useFakeTimers();
    const hang = callAction(() => new Promise<never>(() => {}), { timeoutMs: 1000 });
    await vi.advanceTimersByTimeAsync(1001);
    const res = await hang;
    expect(isTransportError(res)).toBe(true);
    if (isTransportError(res)) expect(res.message).toContain('timed out');
    vi.useRealTimers();
  });
});
