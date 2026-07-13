import type {
  DestinationContext,
  DestinationResult,
  SubmissionDestination,
} from '../destination.port';

/**
 * The default destination. Logs that a submission *would* have been delivered,
 * without any transport — so a bare clone runs submission flows end-to-end with
 * nothing configured, and a destination whose required settings are missing
 * (no webhook URL, no HubSpot token) degrades here instead of crashing. Logs the
 * form + submission id and answer KEYS only, never values (avoids dumping PII).
 */
export class LogOnlyDestination implements SubmissionDestination {
  readonly type = 'log-only' as const;

  constructor(
    private readonly reason: string = 'no destination configured',
    private readonly logger: Pick<Console, 'log'> = console,
  ) {}

  deliver(ctx: DestinationContext): Promise<DestinationResult> {
    const keys = Object.keys(ctx.data);
    this.logger.log(
      `[destination:log-only] not delivered (${this.reason}) → form="${ctx.formName}" ` +
        `submission=${ctx.submissionId} phase=${ctx.phase} fields=[${keys.join(', ')}]`,
    );
    return Promise.resolve({ delivered: false, driver: 'log-only', detail: this.reason });
  }
}
