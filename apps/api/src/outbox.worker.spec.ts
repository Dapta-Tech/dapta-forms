import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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
      attempts: 0,
      nextAttemptAt: claimedAt,
      lastError: null,
      claimedAt: currentClaim.claimedAt,
      claimedBy: currentClaim.claimedBy,
    });
  }

  it.each(['done', 'retry', 'skipped', 'failed'] as const)(
    'does not let a stale worker settle a reclaimed row as %s',
    async (settlement) => {
      const { id, currentClaim } = await runStaleWorker(settlement);
      await expectBStillOwns(id, currentClaim);

      const now = reclaimedAt + 2;
      if (settlement === 'done') {
        await markOutboxDone(db, id, now, undefined, currentClaim);
        expect((await listOutbox(db)).find((row) => row.id === id)).toMatchObject({
          status: 'done',
        });
      } else if (settlement === 'retry') {
        await markOutboxRetry(db, id, { attempts: 1, error: 'current', now }, currentClaim);
        expect((await listOutbox(db)).find((row) => row.id === id)).toMatchObject({
          status: 'pending',
          attempts: 1,
          nextAttemptAt: now + 1_000,
          claimedAt: null,
          claimedBy: null,
        });
      } else if (settlement === 'skipped') {
        await markOutboxSkipped(db, id, { reason: 'current', now }, currentClaim);
        expect((await listOutbox(db)).find((row) => row.id === id)).toMatchObject({
          status: 'skipped',
          lastError: 'current',
        });
      } else {
        await markOutboxFailed(db, id, { attempts: 1, error: 'current', now }, currentClaim);
        expect((await listOutbox(db)).find((row) => row.id === id)).toMatchObject({
          status: 'failed',
          attempts: 1,
          lastError: 'current',
        });
      }
    },
  );
});
