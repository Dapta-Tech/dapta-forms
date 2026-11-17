import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
  getAttributionSwitch,
  setHideAttribution,
  type AttributionSwitchRow,
  type Db,
} from '@quill/db';
import { canHideAttribution, showAttribution, type PremiumMode } from '@quill/shared';
import { AnalyticsEffects } from './analytics-effects';
import { ATTRIBUTION_MODE, DB } from './tokens';

/** What the Brand kit row reads (`GET /v1/account/attribution-badge`). */
export interface AttributionStatus {
  /** The stored choice, kept even while it is not honoured (a lapsed subscription). */
  hideAttribution: boolean;
  /** The workspace may turn the attribution off now: paid, or an open deployment. */
  canHide: boolean;
  /** What the public surfaces carry right now (before the deployment's own rule). */
  showing: boolean;
  /**
   * Whether the identity service ever gave this workspace a paid verdict
   * (paid or not). The row tells "your subscription ended" (a verdict was
   * seen) apart from "only for subscribers" (none ever was), so it never
   * claims a subscription that did not exist. A boolean only.
   */
  verdictSeen: boolean;
}

/** The stable error code a refused "turn it off" answers with. */
export const DAPTA_SUBSCRIPTION_REQUIRED = 'DAPTA_SUBSCRIPTION_REQUIRED';

/**
 * The workspace's "Made with dForms" attribution, read and written in one
 * place so every surface agrees: the public form and link page payloads, the
 * submission emails (decided at send time), the builder (through `/v1/me`)
 * and the Brand kit row.
 *
 * The paid verdict is NOT fetched here. dForms holds no credential for the
 * identity service (ADR 0003), so the verdict is whatever the workspace
 * projection last cached from the rows it reads with a member's own token
 * (`paidVerdictOf`). Every decision reads that cache as it stands and never
 * waits on anything upstream; a verdict past `ATTRIBUTION_VERDICT_MAX_AGE_MS`
 * counts as not paid (`showAttribution`).
 *
 * The mode is `attributionPremiumMode(env)`: `open` lets any workspace hide
 * it, `locked` needs the paid verdict. Only turning the attribution OFF needs
 * it; turning it back ON never does.
 */
@Injectable()
export class AttributionService {
  private readonly log = new Logger('Attribution');
  /** Test seam: the clock every decision reads. */
  now: () => number = Date.now;

  constructor(
    @Inject(DB) private readonly db: Db,
    // Optional so a direct construction (tests, a fork) behaves as an open
    // deployment: the switch works and nothing is gated.
    @Optional() @Inject(ATTRIBUTION_MODE) private readonly mode: PremiumMode = 'open',
    @Optional() @Inject(AnalyticsEffects) private readonly analytics?: AnalyticsEffects,
  ) {}

  get premiumMode(): PremiumMode {
    return this.mode;
  }

  /** Does this row's workspace carry the attribution? No row shows it. */
  showForRow(row: AttributionSwitchRow | null): boolean {
    if (!row) return true;
    return showAttribution({
      hideAttribution: row.hideAttribution,
      paid: row.paid,
      checkedAt: row.paidCheckedAt,
      premiumMode: this.mode,
      now: this.now(),
    });
  }

  /**
   * Public path: does this workspace's surface carry the attribution? Never
   * throws: a read that fails shows the attribution (fail closed), so a public
   * page or an email never breaks over it.
   */
  async showFor(accountId: string | null | undefined): Promise<boolean> {
    if (!accountId) return true;
    try {
      return this.showForRow(await getAttributionSwitch(this.db, accountId));
    } catch (err) {
      this.log.warn(`attribution read failed, showing it account=${accountId}: ${String(err)}`);
      return true;
    }
  }

  private canHide(row: AttributionSwitchRow | null): boolean {
    return canHideAttribution({
      paid: row?.paid ?? null,
      checkedAt: row?.paidCheckedAt ?? null,
      premiumMode: this.mode,
      now: this.now(),
    });
  }

  /** The Brand kit row's view of the switch. Every member reads it. */
  async status(accountId: string): Promise<AttributionStatus> {
    const row = await getAttributionSwitch(this.db, accountId);
    return {
      hideAttribution: row?.hideAttribution ?? false,
      canHide: this.canHide(row),
      showing: this.showForRow(row),
      verdictSeen: row?.paid != null,
    };
  }

  /**
   * Store the workspace's choice. Turning the attribution OFF needs a paid
   * verdict in locked mode and is refused otherwise, storing nothing; turning
   * it back ON never needs one. The caller enforces the admin role.
   */
  async set(
    p: { accountId: string; memberId: string },
    hideAttribution: boolean,
  ): Promise<{ ok: true; status: AttributionStatus } | { ok: false; reason: typeof DAPTA_SUBSCRIPTION_REQUIRED }> {
    const before = await getAttributionSwitch(this.db, p.accountId);
    if (hideAttribution && !this.canHide(before)) return { ok: false, reason: DAPTA_SUBSCRIPTION_REQUIRED };
    await setHideAttribution(this.db, p.accountId, hideAttribution);
    // A save that changes nothing is not a toggle.
    if (before && before.hideAttribution !== hideAttribution) {
      await this.analytics?.captureForMember('attribution_hidden_toggled', p, { hidden: hideAttribution });
    }
    return { ok: true, status: await this.status(p.accountId) };
  }
}
