import {
  Inject,
  Injectable,
  Logger,
  Optional,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { hostname } from 'node:os';
import { randomUUID } from 'node:crypto';
import {
  claimIdentityOf,
  claimDueOutbox,
  DEFAULT_OUTBOX_CLAIM_LIMIT,
  DEFAULT_STALE_CLAIM_MS,
  markOutboxDone,
  markOutboxFailed,
  markOutboxRetry,
  markOutboxSkipped,
  markOutboxTimedOut,
  type Db,
  type OutboxRow,
} from '@quill/db';
import { transcriptOfError, type DeliveryTranscript } from '@quill/destinations';
import type { ServerEnv } from '@quill/config/env';
import { EmailEffects, OutboxSkipError } from './email-effects';
import { DestinationEffects } from './destination-effects';
import { BookingSyncEffects } from './booking-sync';
import { AnalyticsCapture } from './analytics-capture';
import { DaptaSyncDelivery } from './dapta-sync';
import { DB, ENV } from './tokens';

const PAUSE_REMINDER_MS = 60_000;

export interface OutboxRuntimeStatus {
  orphanCount: number;
  oldestOrphanAgeMs: number | null;
  timeoutCountByKindAction: Record<string, number>;
  settledCountByKindAction: Record<string, number>;
  paused: boolean;
  sustainedPaused: boolean;
}

/**
 * The OUTBOX WORKER (B7 / audit DM1). Polls the `outbox` table and drains due
 * rows, executing each durable side-effect and retrying with exponential
 * backoff until it succeeds or exhausts its attempts. This is what turns
 * fire-and-forget side-effects into no-silent-loss delivery.
 *
 *   - Success → the row is marked `done`.
 *   - Failure → attempts++ and the row is rescheduled (backoff); once attempts
 *     reach `max_attempts` it is marked `failed` and logged (the row remains as
 *     the delivery-log record — nothing is silently dropped).
 *
 * The poll loop starts on module init (unless disabled or under `NODE_ENV=test`)
 * and stops on destroy. `drainOnce` is public so tests can pump the queue
 * deterministically without waiting on the interval; `fetchImpl` is swappable
 * for webhook-delivery tests.
 */
@Injectable()
export class OutboxWorker implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('OutboxWorker');
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  /** Stable per-process id so a claim is attributable to this replica. */
  private readonly workerId = `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;
  /** Injectable for tests; defaults to global fetch for webhook delivery. */
  fetchImpl: typeof fetch = fetch;
  /** Injectable clock for deterministic claim-age tests. */
  private clock: () => number = Date.now;
  private readonly orphans = new Map<string, { startedAt: number; row: OutboxRow }>();
  private readonly timeoutCount = new Map<string, number>();
  private readonly settledCount = new Map<string, number>();
  private pausedAt: number | null = null;
  private lastPauseReminderAt = 0;

  private get maxDeliveryMs(): number {
    return this.env.OUTBOX_MAX_DELIVERY_MS ?? 120_000;
  }

  private get maxOrphans(): number {
    return this.env.OUTBOX_MAX_ORPHANS ?? 8;
  }

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: ServerEnv,
    // Explicit token: esbuild/tsx elides type-only imports, so relying on
    // reflected metadata for this class dep injects `undefined`. @Inject keeps
    // the class a value and gives Nest the token directly.
    @Inject(EmailEffects) private readonly email: EmailEffects,
    @Inject(DestinationEffects) private readonly destinations: DestinationEffects,
    // Optional so existing direct constructions (tests) keep working.
    @Optional() @Inject(BookingSyncEffects) private readonly bookingSync?: BookingSyncEffects,
    @Optional() @Inject(AnalyticsCapture) private readonly analytics?: AnalyticsCapture,
    @Optional() @Inject(DaptaSyncDelivery) private readonly daptaSync?: DaptaSyncDelivery,
  ) {}

  onModuleInit(): void {
    if (!this.env.OUTBOX_WORKER_ENABLED || this.env.NODE_ENV === 'test') return;
    this.timer = setInterval(() => {
      void this.tick();
    }, this.env.OUTBOX_POLL_MS);
    // Don't keep the process alive solely for the poll loop.
    this.timer.unref?.();
    this.log.log(`outbox worker started (poll ${this.env.OUTBOX_POLL_MS}ms)`);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** One poll tick, guarded so ticks never overlap in-process. */
  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.drainOnce();
    } catch (err) {
      this.log.error(`outbox drain failed: ${String(err)}`);
    } finally {
      this.running = false;
    }
  }

  /**
   * Claim and process up to the existing batch bound. Each row is claimed
   * immediately before its effect so a slow earlier row cannot age its lease.
   * Returns claimed rows inspected, regardless of settlement. Deterministic for
   * tests via `now`.
   */
  async drainOnce(now?: number): Promise<number> {
    let processed = 0;
    let claimNow = now ?? this.clock();
    const rowNow = () => (now !== undefined && this.clock === Date.now ? claimNow : this.clock());
    while (processed < DEFAULT_OUTBOX_CLAIM_LIMIT) {
      if (this.orphans.size >= this.maxOrphans) {
        this.notePaused(rowNow());
        return processed;
      }
      this.noteResumed(rowNow());
      const [row] = await claimDueOutbox(this.db, claimNow, {
        workerId: this.workerId,
        limit: 1,
      });
      if (!row) break;
      const executed = await this.process(row, rowNow);
      processed += 1;
      if (!executed) break;
      claimNow = rowNow();
    }
    return processed;
  }

  private async process(row: OutboxRow, now: () => number): Promise<boolean> {
    const claim = claimIdentityOf(row);
    if (now() - claim.claimedAt >= DEFAULT_STALE_CLAIM_MS) {
      this.logLostLease(row);
      return false;
    }
    if (row.attempts >= row.maxAttempts) {
      if (await markOutboxFailed(this.db, row.id, { attempts: row.attempts, error: 'attempt limit reached', now: now() }, claim)) {
        this.increment(this.settledCount, row);
      } else {
        this.logLostLease(row);
      }
      return true;
    }
    const controller = new AbortController();
    const startedAt = now();
    let effectSettled = false;
    const effect = this.execute(row, controller.signal).then(
      (transcript) => {
        effectSettled = true;
        return { kind: 'success' as const, transcript };
      },
      (err) => {
        effectSettled = true;
        return { kind: 'error' as const, err };
      },
    );
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
    const timedOut = new Promise<{ kind: 'timeout' }>((resolve) => {
      timeoutHandle = setTimeout(() => resolve({ kind: 'timeout' }), this.maxDeliveryMs);
      timeoutHandle.unref?.();
    });
    const outcome = await Promise.race([effect, timedOut]);
    if (timeoutHandle) clearTimeout(timeoutHandle);

    if (outcome.kind === 'timeout') {
      controller.abort(new Error(`outbox delivery timed out after ${this.maxDeliveryMs}ms`));
      this.increment(this.timeoutCount, row);
      await Promise.resolve();
      if (!effectSettled) this.trackOrphan(row, claim, startedAt, now, effect);
      const attempts = row.attempts + 1;
      const timeoutError = new Error(`outbox delivery timed out after ${this.maxDeliveryMs}ms`);
      const settled = await markOutboxTimedOut(
        this.db,
        row.id,
        { attempts, error: timeoutError.message, now: now(), transcript: transcriptOfError(timeoutError) },
        claim,
      );
      if (settled) this.increment(this.settledCount, row);
      else this.logLostLease(row);
      return true;
    }
    if (outcome.kind === 'success') {
      if (await markOutboxDone(this.db, row.id, now(), outcome.transcript, claim)) {
        this.increment(this.settledCount, row);
      } else {
        this.logLostLease(row);
      }
      return true;
    }
    if (outcome.err instanceof OutboxSkipError) {
      if (await markOutboxSkipped(this.db, row.id, { reason: outcome.err.message, now: now() }, claim)) {
        this.increment(this.settledCount, row);
        this.log.warn(`outbox ${row.kind}:${row.action} (${row.id}) skipped: ${outcome.err.message}`);
      } else {
        this.logLostLease(row);
      }
      return true;
    }
    await this.settleFailure(row, claim, now, outcome.err);
    return true;
  }

  private async settleFailure(
    row: OutboxRow,
    claim: ReturnType<typeof claimIdentityOf>,
    now: () => number,
    err: unknown,
    attemptAlreadyCounted = false,
  ): Promise<void> {
    const attempts = attemptAlreadyCounted ? row.attempts : row.attempts + 1;
    const message = err instanceof Error ? err.message : String(err);
    const transcript = transcriptOfError(err);
    const settled =
      attempts >= row.maxAttempts
        ? await markOutboxFailed(this.db, row.id, { attempts, error: message, now: now(), transcript }, claim)
        : await markOutboxRetry(this.db, row.id, { attempts, error: message, now: now(), transcript }, claim);
    if (!settled) {
      this.logLostLease(row);
      return;
    }
    this.increment(this.settledCount, row);
    if (attempts >= row.maxAttempts) {
      this.log.error(
        `outbox ${row.kind}:${row.action} (${row.id}) gave up after ${attempts} attempts: ${message}`,
      );
    } else {
      this.log.warn(
        `outbox ${row.kind}:${row.action} (${row.id}) failed (attempt ${attempts}/${row.maxAttempts}), will retry: ${message}`,
      );
    }
  }

  private trackOrphan(
    row: OutboxRow,
    claim: ReturnType<typeof claimIdentityOf>,
    startedAt: number,
    now: () => number,
    effect: Promise<{ kind: 'success'; transcript: DeliveryTranscript | undefined } | { kind: 'error'; err: unknown }>,
  ): void {
    const key = `${row.id}:${row.claimedBy}`;
    this.orphans.set(key, { startedAt, row });
    if (this.orphans.size >= this.maxOrphans) this.notePaused(this.clock());
    void effect
      .then((outcome) => {
        if (outcome.kind === 'success') {
          return markOutboxDone(this.db, row.id, now(), outcome.transcript, claim).then((settled) => {
            if (settled) this.increment(this.settledCount, row);
            else this.logLostLease(row);
          });
        }
        return this.settleFailure(row, claim, now, outcome.err, true);
      })
      .finally(() => {
        this.orphans.delete(key);
        if (this.orphans.size < this.maxOrphans) this.noteResumed(this.clock());
      });
  }

  private increment(counter: Map<string, number>, row: OutboxRow): void {
    const key = `${row.kind}:${row.action}`;
    counter.set(key, (counter.get(key) ?? 0) + 1);
  }

  private notePaused(now: number): void {
    if (this.pausedAt === null) {
      this.pausedAt = now;
      this.lastPauseReminderAt = now;
      this.log.warn(
        `outbox paused: ${this.orphans.size}/${this.maxOrphans} timed-out effects remain pending`,
      );
      return;
    }
    if (now - this.lastPauseReminderAt >= PAUSE_REMINDER_MS) {
      this.lastPauseReminderAt = now;
      this.log.warn(
        `outbox remains paused: ${this.orphans.size}/${this.maxOrphans} timed-out effects remain pending`,
      );
    }
  }

  private noteResumed(_now: number): void {
    if (this.pausedAt === null) return;
    this.log.log(`outbox resumed: ${this.orphans.size}/${this.maxOrphans} timed-out effects pending`);
    this.pausedAt = null;
  }

  getRuntimeStatus(): OutboxRuntimeStatus {
    const now = this.clock();
    const oldest = [...this.orphans.values()].reduce<number | null>(
      (age, orphan) => (age === null ? now - orphan.startedAt : Math.max(age, now - orphan.startedAt)),
      null,
    );
    return {
      orphanCount: this.orphans.size,
      oldestOrphanAgeMs: oldest,
      timeoutCountByKindAction: Object.fromEntries(this.timeoutCount),
      settledCountByKindAction: Object.fromEntries(this.settledCount),
      paused: this.pausedAt !== null,
      sustainedPaused:
        this.pausedAt !== null && now - this.pausedAt > this.env.OUTBOX_POLL_MS * 2,
    };
  }

  /**
   * If settlement loses ownership, the side effect may have happened but this
   * worker must not claim a durable result.
   */
  private logLostLease(row: OutboxRow): void {
    const token = row.claimedBy ?? '';
    const prefixEnd = token.lastIndexOf('#');
    const owner = prefixEnd > 0 ? token.slice(0, prefixEnd) : 'unknown';
    this.log.warn(
      `outbox ${row.kind}:${row.action} (${row.id}) lease lost before settlement (worker ${owner})`,
    );
  }

  /**
   * Perform the row's side-effect, reporting what crossed the wire when the
   * handler can say. Throws on failure so `process` can retry.
   */
  private async execute(row: OutboxRow, signal: AbortSignal): Promise<DeliveryTranscript | undefined> {
    if (row.kind === 'email') {
      if (row.payload == null) throw new Error('email outbox row missing payload');
      await this.email.deliver(row.action, row.payload, row.accountId, signal);
      return undefined;
    }
    if (row.kind === 'webhook' || row.kind === 'hubspot') {
      if (row.payload == null) throw new Error(`${row.kind} outbox row missing payload`);
      return await this.destinations.deliver(row.action, row.payload, signal);
    }
    if (row.kind === 'booking_sync') {
      if (row.payload == null) throw new Error('booking_sync outbox row missing payload');
      if (!this.bookingSync) throw new Error('booking_sync handler not wired');
      await this.bookingSync.deliver(row.action, row.payload, signal);
      return undefined;
    }
    if (row.kind === 'analytics') {
      if (row.payload == null) throw new Error('analytics outbox row missing payload');
      // Skip, not throw: an unwired handler is a deployment that does not do
      // product analytics, and telemetry must never accumulate permanent
      // failures in a queue shared with emails and CRM deliveries.
      if (!this.analytics) throw new OutboxSkipError('analytics handler not wired');
      await this.analytics.deliver(row.action, row.payload, signal);
      return undefined;
    }
    if (row.kind === 'dapta_sync') {
      if (row.payload == null) throw new Error('dapta_sync outbox row missing payload');
      // Same reasoning as analytics: an unwired handler is a deployment that
      // does not sync into the Dapta estate, never a delivery failure.
      if (!this.daptaSync) throw new OutboxSkipError('dapta_sync handler not wired');
      await this.daptaSync.deliver(row.action, row.payload, signal);
      return undefined;
    }
    throw new Error(`unknown outbox kind: ${String(row.kind)}`);
  }
}
