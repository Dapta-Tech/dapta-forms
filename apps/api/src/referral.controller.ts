import { Body, Controller, HttpCode, Inject, Logger, Post, Req } from '@nestjs/common';
import { AuthService, isAgentPrincipal } from './auth.service';
import type { ReqLike } from './auth.provider';
import { keyNotAllowed } from './api-key-routes';
import { ReferralService } from './referral.service';

/**
 * The referral program's person-level routes (ADR 0005). The routes read and
 * write the CALLER's referral state only, keyed by their person, so any role
 * may call them: unlike `/v1/account/attribution` this records nothing about
 * the workspace.
 *
 * Session only: an API key or an MCP connection is an agent, not a person
 * signing up, and the API key route allowlist leaves these out too.
 */
@Controller('v1/me')
export class ReferralController {
  private readonly log = new Logger(ReferralController.name);

  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(ReferralService) private readonly referrals: ReferralService,
  ) {}

  /**
   * Credit the caller to the owner of a referral code: POSTed by the sign-in
   * callback with the `ref` the login parked, the moment a login completes.
   *
   * Every refusal is silent. An unknown code, a self-referral, a person who
   * already had dForms or was already credited, a junk body, the program
   * switched off, even a failing database: all answer `{ credited: false }`
   * with a 200. A referral is an observer of the signup, never a participant,
   * and the callback must never fail a login that already succeeded. Only the
   * principal checks (no session, an agent) answer with an error, and the
   * callback discards those too.
   */
  @Post('referral/claim')
  @HttpCode(200)
  async claim(@Req() req: ReqLike, @Body() body: unknown): Promise<{ credited: boolean }> {
    const p = await this.auth.resolveHost(req);
    if (isAgentPrincipal(p)) keyNotAllowed();
    const code = (body as { code?: unknown } | null | undefined)?.code;
    try {
      return await this.referrals.claimByLink(p, code);
    } catch (err) {
      this.log.warn(`referral claim failed for member ${p.memberId}: ${String(err)}`);
      return { credited: false };
    }
  }
}
