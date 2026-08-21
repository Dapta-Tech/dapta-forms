import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  claimDueOutbox,
  createDb,
  enqueueOutbox,
  listOutbox,
  markOutboxDone,
  markOutboxFailed,
  markOutboxRetry,
  markOutboxSkipped,
  migrate,
  sql,
  type Db,
} from '@quill/db';
import type { DestinationEffects } from './destination-effects';
import { EmailEffects, OutboxSkipError } from './email-effects';
import { OutboxWorker } from './outbox.worker';

let db: Db;

const TEST_LEASE_MS = 5 * 60_000;

type WorkerTestSeams = {
  clock: () => number;
  log: { log: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };
};

function setClock(worker: OutboxWorker, clock: () => number) {
  (worker as unknown as WorkerTestSeams).clock = clock;
}

function replaceLog(worker: OutboxWorker) {
  const log = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
  (worker as unknown as WorkerTestSeams).log = log;
  return log;
}

beforeEach(async () => {
  db = await createDb(process.env.DATABASE_URL ?? 'file::memory:');
  await migrate(db);
  await db.run(sql`DELETE FROM outbox`);
});

afterEach(async () => {
  await db.run(sql`DELETE FROM outbox`);
  await db.close();
});

describe('OutboxWorker claim fencing', () => {
  const claimedAt = 7_000_000;
  const reclaimedAt = claimedAt + 60_001;

  async function runStaleWorker(settlement: 'done' | 'retry' | 'skipped' | 'failed') {
    const id = await enqueueOutbox(db, {
      kind: 'email',
      action: 'a',
      now: claimedAt,
      payload: '{}',
      maxAttempts: settlement === 'failed' ? 1 : undefined,
    });
    let releaseDelivery: (() => void) | undefined;
    let deliveryStarted: (() => void) | undefined;
    const deliveryBlocked = new Promise<void>((resolve) => {
      releaseDelivery = resolve;
    });
    const deliveryStartedPromise = new Promise<void>((resolve) => {
      deliveryStarted = resolve;
    });
    const email = {
      deliver: async () => {
        deliveryStarted!();
        await deliveryBlocked;
        if (settlement === 'retry' || settlement === 'failed') throw new Error(settlement);
        if (settlement === 'skipped') throw new OutboxSkipError(settlement);
      },
    } as unknown as EmailEffects;
    const worker = new OutboxWorker(
      db,
      {
        OUTBOX_WORKER_ENABLED: false,
        OUTBOX_POLL_MS: 5_000,
        NODE_ENV: 'test',
      } as never,
      email,
      {} as DestinationEffects,
    );
    const log = replaceLog(worker);

    const draining = worker.drainOnce(claimedAt);
    await deliveryStartedPromise;
    const [reclaimed] = await claimDueOutbox(db, reclaimedAt, {
      workerId: 'B',
      staleClaimMs: 60_000,
    });
    expect(reclaimed).toBeDefined();
    releaseDelivery!();
    await draining;

    return {
      id,
      log,
      currentClaim: {
        claimedAt: reclaimed!.claimedAt!,
        claimedBy: reclaimed!.claimedBy!,
      },
    };
  }

  async function expectBStillOwns(
    id: string,
    currentClaim: { claimedAt: number; claimedBy: string },
  ) {
    const row = (await listOutbox(db)).find((candidate) => candidate.id === id);
    expect(row).toMatchObject({
      status: 'pending',
      attempts: 1,
      nextAttemptAt: claimedAt,
      lastError: null,
      claimedAt: currentClaim.claimedAt,
      claimedBy: currentClaim.claimedBy,
    });
  }

  it.each(['done', 'retry', 'skipped', 'failed'] as const)(
    'does not let a stale worker settle a reclaimed row as %s',
    async (settlement) => {
      const { id, currentClaim, log } = await runStaleWorker(settlement);
      await expectBStillOwns(id, currentClaim);

      const now = reclaimedAt + 2;
      if (settlement === 'done') {
        expect(await markOutboxDone(db, id, now, undefined, currentClaim)).toBe(true);
        expect((await listOutbox(db)).find((row) => row.id === id)).toMatchObject({
          status: 'done',
        });
      } else if (settlement === 'retry') {
        expect(
          await markOutboxRetry(db, id, { attempts: 1, error: 'current', now }, currentClaim),
        ).toBe(true);
        expect((await listOutbox(db)).find((row) => row.id === id)).toMatchObject({
          status: 'pending',
          attempts: 1,
          nextAttemptAt: now + 1_000,
          claimedAt: null,
          claimedBy: null,
        });
      } else if (settlement === 'skipped') {
        expect(await markOutboxSkipped(db, id, { reason: 'current', now }, currentClaim)).toBe(true);
        expect((await listOutbox(db)).find((row) => row.id === id)).toMatchObject({
          status: 'skipped',
          lastError: 'current',
        });
      } else {
        expect(
          await markOutboxFailed(db, id, { attempts: 1, error: 'current', now }, currentClaim),
        ).toBe(true);
        expect((await listOutbox(db)).find((row) => row.id === id)).toMatchObject({
          status: 'failed',
          attempts: 1,
          lastError: 'current',
        });
      }

      const messages = [...log.log.mock.calls, ...log.warn.mock.calls, ...log.error.mock.calls].map(
        ([message]) => String(message),
      );
      expect(messages.some((message) => message.includes('lease lost'))).toBe(true);
      expect(messages.some((message) => message.includes('will retry'))).toBe(false);
      expect(messages.some((message) => message.includes('skipped:'))).toBe(false);
      expect(messages.some((message) => message.includes('gave up after'))).toBe(false);
    },
  );

  it('claims each row immediately before execution so a slow drain cannot replay a reclaimed row', async () => {
    const startedAt = 9_000_000;
    const reclaimedAt = startedAt + TEST_LEASE_MS + 1;
    let now = startedAt;
    const aDeliveries: number[] = [];
    const bDeliveries: number[] = [];

    for (let sequence = 1; sequence <= 6; sequence++) {
      await enqueueOutbox(db, {
        kind: 'email',
        action: 'slow',
        payload: JSON.stringify({ sequence }),
        now: startedAt,
      });
    }

    const emailA = {
      deliver: async (_action: string, payload: string) => {
        aDeliveries.push((JSON.parse(payload) as { sequence: number }).sequence);
      },
    } as unknown as EmailEffects;
    const emailB = {
      deliver: async (_action: string, payload: string) => {
        bDeliveries.push((JSON.parse(payload) as { sequence: number }).sequence);
      },
    } as unknown as EmailEffects;
    const env = { OUTBOX_WORKER_ENABLED: false, OUTBOX_POLL_MS: 5_000, NODE_ENV: 'test' } as never;
    const workerB = new OutboxWorker(db, env, emailB, {} as DestinationEffects);
    setClock(workerB, () => now);

    let settlements = 0;
    const aDb: Db = {
      ...db,
      async get<T>(query: Parameters<Db['get']>[0]) {
        const row = await db.get<T>(query);
        await afterSettlement();
        return row;
      },
      async run(query: Parameters<Db['run']>[0]) {
        await db.run(query);
        await afterSettlement();
      },
    };
    const workerA = new OutboxWorker(aDb, env, emailA, {} as DestinationEffects);
    setClock(workerA, () => now);

    async function afterSettlement() {
      settlements += 1;
      if (settlements !== 4) return;
      now = reclaimedAt;
      await workerB.drainOnce(now);
    }

    expect(await workerA.drainOnce(startedAt)).toBe(4);
    expect(aDeliveries).toEqual([1, 2, 3, 4]);
    expect(bDeliveries).toEqual([5, 6]);
  });

  it('does not start an effect once its claim has expired', async () => {
    const claimedAt = 10_000_000;
    let deliveries = 0;
    await enqueueOutbox(db, { kind: 'email', action: 'a', payload: '{}', now: claimedAt });
    const worker = new OutboxWorker(
      db,
      { OUTBOX_WORKER_ENABLED: false, OUTBOX_POLL_MS: 5_000, NODE_ENV: 'test' } as never,
      {
        deliver: async () => {
          deliveries += 1;
        },
      } as unknown as EmailEffects,
      {} as DestinationEffects,
    );
    setClock(worker, () => claimedAt + TEST_LEASE_MS);

    await worker.drainOnce(claimedAt);
    expect(deliveries).toBe(0);
  });

  it('marks an exhausted reclaimed generation failed without a third effect', async () => {
    const now = 10_500_000;
    const id = await enqueueOutbox(db, { kind: 'email', action: 'a', payload: '{}', now, maxAttempts: 2 });
    await claimDueOutbox(db, now, { workerId: 'A' });
    await claimDueOutbox(db, now + 60_001, { workerId: 'B', staleClaimMs: 60_000 });
    const [third] = await claimDueOutbox(db, now + 120_002, { workerId: 'C', staleClaimMs: 60_000 });
    let effects = 0;
    const worker = new OutboxWorker(
      db,
      { OUTBOX_WORKER_ENABLED: false, OUTBOX_POLL_MS: 5_000, NODE_ENV: 'test' } as never,
      { deliver: async () => { effects += 1; } } as unknown as EmailEffects,
      {} as DestinationEffects,
    );
    setClock(worker, () => now + 120_003);

    await (worker as unknown as { process: (row: typeof third, now: () => number) => Promise<boolean> }).process(
      third!,
      () => now + 120_003,
    );
    expect(effects).toBe(0);
    expect((await listOutbox(db)).find((row) => row.id === id)).toMatchObject({
      status: 'failed',
      attempts: 2,
    });
  });

  it('allows one clean maxAttempts=1 effect but blocks its over-lease reclaim', async () => {
    const now = 10_750_000;
    const id = await enqueueOutbox(db, { kind: 'email', action: 'a', payload: '{}', now, maxAttempts: 1 });
    const [first] = await claimDueOutbox(db, now, { workerId: 'A' });
    let effects = 0;
    const worker = new OutboxWorker(
      db,
      { OUTBOX_WORKER_ENABLED: false, OUTBOX_POLL_MS: 5_000, NODE_ENV: 'test' } as never,
      { deliver: async () => { effects += 1; } } as unknown as EmailEffects,
      {} as DestinationEffects,
    );
    await (worker as unknown as { execute: (row: typeof first) => Promise<unknown> }).execute(first!);
    const [reclaimed] = await claimDueOutbox(db, now + 60_001, {
      workerId: 'B',
      staleClaimMs: 60_000,
    });
    setClock(worker, () => now + 60_002);

    await (worker as unknown as { process: (row: typeof reclaimed, now: () => number) => Promise<boolean> }).process(
      reclaimed!,
      () => now + 60_002,
    );
    expect(effects).toBe(1);
    expect(reclaimed!.attempts).toBe(1);
    expect((await listOutbox(db)).find((row) => row.id === id)).toMatchObject({
      status: 'failed',
      attempts: 1,
      lastError: 'delivery exceeded its claim lease; outcome unknown',
    });
  });


  it('keeps the existing 50-row drain bound', async () => {
    const now = 12_000_000;
    let deliveries = 0;
    for (let sequence = 0; sequence < 51; sequence++) {
      await enqueueOutbox(db, { kind: 'email', action: 'a', payload: '{}', now });
    }
    const worker = new OutboxWorker(
      db,
      { OUTBOX_WORKER_ENABLED: false, OUTBOX_POLL_MS: 5_000, NODE_ENV: 'test' } as never,
      {
        deliver: async () => {
          deliveries += 1;
        },
      } as unknown as EmailEffects,
      {} as DestinationEffects,
    );

    expect(await worker.drainOnce(now)).toBe(50);
    expect(deliveries).toBe(50);
  });
});
