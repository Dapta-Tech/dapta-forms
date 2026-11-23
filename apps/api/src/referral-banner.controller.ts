import { Controller, HttpCode, Inject, Post, Req } from '@nestjs/common';
import { AuthService, isAgentPrincipal } from './auth.service';
import type { ReqLike } from './auth.provider';
import { keyNotAllowed } from './api-key-routes';
import { ReferralService } from './referral.service';

/**
 * The referral program's top banner (ADR 0005): closing it hides it for the
 * CALLER, as a person, in every workspace, for 7 days. It records nothing
 * about the workspace, so any role may call it.
 *
 * Session only: an API key or an MCP connection is an agent, it has no
 * dashboard and no banner to close, and the API key route allowlist leaves
 * this out too.
 */
@Controller('v1/me')
export class ReferralBannerController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(ReferralService) private readonly referrals: ReferralService,
  ) {}

  /**
   * `{ dismissedUntil }`: epoch ms the banner comes back, or null with the
   * program switched off (nothing is written then).
   */
  @Post('referral/banner/dismiss')
  @HttpCode(200)
  async dismiss(@Req() req: ReqLike): Promise<{ dismissedUntil: number | null }> {
    const p = await this.auth.resolveHost(req);
    if (isAgentPrincipal(p)) keyNotAllowed();
    return this.referrals.dismissBanner(p.accountId, p.memberId);
  }
}
