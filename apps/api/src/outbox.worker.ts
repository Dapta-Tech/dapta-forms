import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import {
  claimDueOutbox,
  markOutboxDone,
  markOutboxFailed,
  markOutboxRetry,
  markOutboxSkipped,
  type Db,
  type OutboxRow,
} from '@quill/db';
import type { ServerEnv } from '@quill/config/env';
import { EmailEffects, OutboxSkipError } from './email-effects';
import { DestinationEffects } from './destination-effects';
import { DB, ENV } from './tokens';

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
  /** Injectable for tests; defaults to global fetch for webhook delivery. */
  fetchImpl: typeof fetch = fetch;

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: ServerEnv,
    // Explicit token: esbuild/tsx elides type-only imports, so relying on
    // reflected metadata for this class dep injects `undefined`. @Inject keeps
    // the class a value and gives Nest the token directly.
    @Inject(EmailEffects) private readonly email: EmailEffects,
    @Inject(DestinationEffects) private readonly destinations: DestinationEffects,
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
   * Process every currently-due row once. Returns the number of rows processed
   * (attempted), regardless of success. Deterministic for tests via `now`.
   */
  async drainOnce(now = Date.now()): Promise<number> {
    const rows = await claimDueOutbox(this.db, now);
    for (const row of rows) {
      await this.process(row, now);
    }
    return rows.length;
  }

  private async process(row: OutboxRow, now: number): Promise<void> {
    try {
      await this.execute(row);
      await markOutboxDone(this.db, row.id, now);
    } catch (err) {
      if (err instanceof OutboxSkipError) {
        // A decision, not a failure: record the reason ONCE and stop — waiting
        // and retrying cannot change the outcome.
        await markOutboxSkipped(this.db, row.id, { reason: err.message, now });
        this.log.warn(`outbox ${row.kind}:${row.action} (${row.id}) skipped: ${err.message}`);
        return;
      }
      const attempts = row.attempts + 1;
      const message = err instanceof Error ? err.message : String(err);
      if (attempts >= row.maxAttempts) {
        await markOutboxFailed(this.db, row.id, { attempts, error: message, now });
        this.log.error(
          `outbox ${row.kind}:${row.action} (${row.id}) gave up after ${attempts} attempts: ${message}`,
        );
      } else {
        await markOutboxRetry(this.db, row.id, { attempts, error: message, now });
        this.log.warn(
          `outbox ${row.kind}:${row.action} (${row.id}) failed (attempt ${attempts}/${row.maxAttempts}), will retry: ${message}`,
        );
      }
    }
  }

  /** Perform the row's side-effect. Throws on failure so `process` can retry. */
  private async execute(row: OutboxRow): Promise<void> {
    if (row.kind === 'email') {
      if (row.payload == null) throw new Error('email outbox row missing payload');
      await this.email.deliver(row.action, row.payload, row.accountId);
      return;
    }
    if (row.kind === 'webhook' || row.kind === 'hubspot') {
      if (row.payload == null) throw new Error(`${row.kind} outbox row missing payload`);
      await this.destinations.deliver(row.action, row.payload);
      return;
    }
    throw new Error(`unknown outbox kind: ${String(row.kind)}`);
  }
}
