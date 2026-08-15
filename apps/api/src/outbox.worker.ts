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
  renewOutboxClaim,
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

// Not every pluggable provider has a transport timeout. Renew halfway through
// the existing lease so an in-flight effect remains owned until it settles.
const OUTBOX_CLAIM_RENEWAL_MS = Math.floor(DEFAULT_STALE_CLAIM_MS / 2);

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
  /** Kept mutable so the lease heartbeat can be exercised without long waits. */
  private claimRenewalMs = OUTBOX_CLAIM_RENEWAL_MS;

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
    let claim = claimIdentityOf(row);
    if (now() - claim.claimedAt >= DEFAULT_STALE_CLAIM_MS) {
      this.logLostLease(row);
      return false;
    }

    let lostLease = false;
    let renewal = Promise.resolve();
    const renew = async () => {
      if (lostLease) return;
      try {
        const renewed = await renewOutboxClaim(this.db, row.id, claim, now());
        if (renewed) claim = renewed;
        else lostLease = true;
      } catch (err) {
        lostLease = true;
        this.log.warn(`outbox ${row.kind}:${row.action} (${row.id}) lease renewal failed: ${String(err)}`);
      }
    };
    const renewalTimer = setInterval(() => {
      renewal = renewal.then(renew);
    }, this.claimRenewalMs);
    renewalTimer.unref?.();
    const stopRenewing = async () => {
      clearInterval(renewalTimer);
      await renewal;
    };

    try {
      const transcript = await this.execute(row);
      await stopRenewing();
      if (lostLease || !(await markOutboxDone(this.db, row.id, now(), transcript, claim))) {
        this.logLostLease(row);
      }
      return true;
    } catch (err) {
      await stopRenewing();
      if (lostLease) {
        this.logLostLease(row);
        return true;
      }
      if (err instanceof OutboxSkipError) {
        // A decision, not a failure: record the reason ONCE and stop — waiting
        // and retrying cannot change the outcome.
        if (
          !(await markOutboxSkipped(this.db, row.id, { reason: err.message, now: now() }, claim))
        ) {
          this.logLostLease(row);
          return true;
        }
        this.log.warn(`outbox ${row.kind}:${row.action} (${row.id}) skipped: ${err.message}`);
        return true;
      }
      const attempts = row.attempts + 1;
      const message = err instanceof Error ? err.message : String(err);
      // A failure is the transcript anyone actually needs to read back, and it
      // arrives on the thrown error rather than a returned value.
      const transcript = transcriptOfError(err);
      if (attempts >= row.maxAttempts) {
        if (
          !(await markOutboxFailed(
            this.db,
            row.id,
            { attempts, error: message, now: now(), transcript },
            claim,
          ))
        ) {
          this.logLostLease(row);
          return true;
        }
        this.log.error(
          `outbox ${row.kind}:${row.action} (${row.id}) gave up after ${attempts} attempts: ${message}`,
        );
      } else {
        if (
          !(await markOutboxRetry(
            this.db,
            row.id,
            { attempts, error: message, now: now(), transcript },
            claim,
          ))
        ) {
          this.logLostLease(row);
          return true;
        }
        this.log.warn(
          `outbox ${row.kind}:${row.action} (${row.id}) failed (attempt ${attempts}/${row.maxAttempts}), will retry: ${message}`,
        );
      }
      return true;
    }
  }

  /**
   * If renewal or settlement loses ownership, the side effect may have happened
   * but this worker must not claim a durable result.
   */
  private logLostLease(row: OutboxRow): void {
    this.log.warn(`outbox ${row.kind}:${row.action} (${row.id}) lease lost before settlement`);
  }

  /**
   * Perform the row's side-effect, reporting what crossed the wire when the
   * handler can say. Throws on failure so `process` can retry.
   */
  private async execute(row: OutboxRow): Promise<DeliveryTranscript | undefined> {
    if (row.kind === 'email') {
      if (row.payload == null) throw new Error('email outbox row missing payload');
      await this.email.deliver(row.action, row.payload, row.accountId);
      return undefined;
    }
    if (row.kind === 'webhook' || row.kind === 'hubspot') {
      if (row.payload == null) throw new Error(`${row.kind} outbox row missing payload`);
      return await this.destinations.deliver(row.action, row.payload);
    }
    if (row.kind === 'booking_sync') {
      if (row.payload == null) throw new Error('booking_sync outbox row missing payload');
      if (!this.bookingSync) throw new Error('booking_sync handler not wired');
      await this.bookingSync.deliver(row.action, row.payload);
      return undefined;
    }
    if (row.kind === 'analytics') {
      if (row.payload == null) throw new Error('analytics outbox row missing payload');
      // Skip, not throw: an unwired handler is a deployment that does not do
      // product analytics, and telemetry must never accumulate permanent
      // failures in a queue shared with emails and CRM deliveries.
      if (!this.analytics) throw new OutboxSkipError('analytics handler not wired');
      await this.analytics.deliver(row.action, row.payload);
      return undefined;
    }
    if (row.kind === 'dapta_sync') {
      if (row.payload == null) throw new Error('dapta_sync outbox row missing payload');
      // Same reasoning as analytics: an unwired handler is a deployment that
      // does not sync into the Dapta estate, never a delivery failure.
      if (!this.daptaSync) throw new OutboxSkipError('dapta_sync handler not wired');
      await this.daptaSync.deliver(row.action, row.payload);
      return undefined;
    }
    throw new Error(`unknown outbox kind: ${String(row.kind)}`);
  }
}
