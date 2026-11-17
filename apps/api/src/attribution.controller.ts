import { BadRequestException, Body, Controller, ForbiddenException, Get, Inject, Put, Req } from '@nestjs/common';
import { AuthService, type ReqLike } from './auth.service';
import { AttributionService, DAPTA_SUBSCRIPTION_REQUIRED } from './attribution.service';
import { assertAdmin } from './permissions';

/**
 * The workspace's "Made with dForms" attribution switch (Brand kit).
 *
 * `attribution-badge`, not `attribution`: `POST /v1/account/attribution` is
 * the signup's acquisition record (UTM first touch), an unrelated thing that
 * happens to share the word.
 *
 * Every member reads it (members see the row read-only); only owners and
 * admins change it. Dashboard only: an API key gets 403 `KEY_NOT_ALLOWED`
 * (the allowlist in `api-key-routes.ts` does not name it), as for every other
 * workspace setting that is not form building.
 */
@Controller('v1/account')
export class AttributionController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(AttributionService) private readonly attribution: AttributionService,
  ) {}

  @Get('attribution-badge')
  async status(@Req() req: ReqLike) {
    const p = await this.auth.resolveHost(req);
    return this.attribution.status(p.accountId);
  }

  @Put('attribution-badge')
  async set(@Req() req: ReqLike, @Body() body: { hideAttribution?: unknown } | null) {
    const p = await this.auth.resolveHost(req);
    assertAdmin(p);
    if (typeof body?.hideAttribution !== 'boolean') {
      throw new BadRequestException({ error: 'BAD_REQUEST', message: 'hideAttribution (boolean) required' });
    }
    const out = await this.attribution.set(p, body.hideAttribution);
    if (!out.ok) {
      throw new ForbiddenException({
        error: DAPTA_SUBSCRIPTION_REQUIRED,
        message: 'Hiding the dForms attribution is only for Dapta AI subscribers.',
      });
    }
    return out.status;
  }
}
