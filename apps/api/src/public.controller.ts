import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Optional,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ZodError } from 'zod';
import type { ServerEnv } from '@quill/config/env';
import { SubmissionService } from './submission.service';
import { UploadService } from './upload.service';
import { unwrap } from './http';
import { RateLimitGuard, clientKey, resolveTrustProxyHops } from './rate-limit';
import { ENV } from './tokens';
import { uploadPresignSchema } from '@quill/types';

function badReq(err: unknown): never {
  if (err instanceof ZodError)
    throw new BadRequestException({ error: 'BAD_REQUEST', message: err.issues[0]?.message });
  throw err;
}

/**
 * Public, unauthenticated forms surface: fetch a published form, submit answers,
 * record a funnel event. Rate-limited per IP (P1-5) — this is the only surface an
 * anonymous client can hit, so submission spam is throttled.
 */
@UseGuards(RateLimitGuard)
@Controller('v1/public')
export class PublicController {
  private readonly trustProxyHops: number;

  constructor(
    @Inject(SubmissionService) private readonly svc: SubmissionService,
    @Inject(UploadService) private readonly uploads: UploadService,
    // Only for the proxy depth the client address is read at. Optional so a
    // construction without it trusts the socket peer alone, the safe default.
    @Optional() @Inject(ENV) env?: ServerEnv,
  ) {
    this.trustProxyHops = env ? resolveTrustProxyHops(env) : 0;
  }

  /** The published form config for the public renderer. */
  @Get('forms/:accountCode/:slug')
  async form(@Param('accountCode') accountCode: string, @Param('slug') slug: string) {
    const f = await this.svc.publicForm(accountCode, slug);
    if (!f) throw new NotFoundException({ error: 'NOT_FOUND', message: 'Form not found.' });
    return f;
  }

  /** A member's public page, or 404 when they have not turned one on. */
  @Get('profiles/:accountCode/:handle')
  async profile(@Param('accountCode') accountCode: string, @Param('handle') handle: string) {
    const p = await this.svc.publicProfile(accountCode, handle);
    if (!p) throw new NotFoundException({ error: 'NOT_FOUND', message: 'Page not found.' });
    return p;
  }

  /**
   * Authorize one file upload: returns a presigned PUT the browser uses to send
   * the file straight to the bucket.
   *
   * Behind the same per-IP rate limit as the rest of this controller, which is
   * what keeps an anonymous client from minting signatures in a loop. The URL
   * it hands back can write exactly one key, for minutes, with one content
   * type; the object is checked again when the submission arrives.
   */
  @Post('forms/:accountCode/:slug/uploads')
  @HttpCode(200)
  async presignUpload(
    @Param('accountCode') accountCode: string,
    @Param('slug') slug: string,
    @Body() body: unknown,
  ) {
    try {
      const input = uploadPresignSchema.parse(body);
      return unwrap(await this.uploads.presign(accountCode, slug, input));
    } catch (err) {
      badReq(err);
    }
  }

  /**
   * Persist a submission (partial or complete); the score is recomputed
   * server-side. The client address travels with it for spam protection's token
   * check, resolved exactly as the rate limiter resolves it: the same trusted
   * proxy depth, so a spoofed `X-Forwarded-For` entry is never the one sent.
   */
  @Post('forms/:accountCode/:slug/submissions')
  @HttpCode(201)
  async submit(
    @Param('accountCode') accountCode: string,
    @Param('slug') slug: string,
    @Body() body: unknown,
    @Req() req: { headers?: Record<string, unknown>; ip?: string; socket?: { remoteAddress?: string } },
  ) {
    try {
      const remoteIp = clientKey(req ?? {}, this.trustProxyHops);
      return unwrap(await this.svc.submit(accountCode, slug, body, { remoteIp }));
    } catch (err) {
      badReq(err);
    }
  }

  /** Record a funnel event (view/start/step_view/step_complete/partial_submit/submit). */
  @Post('forms/:accountCode/:slug/events')
  @HttpCode(202)
  async event(
    @Param('accountCode') accountCode: string,
    @Param('slug') slug: string,
    @Body() body: unknown,
  ) {
    try {
      return unwrap(await this.svc.event(accountCode, slug, body));
    } catch (err) {
      badReq(err);
    }
  }

  /** Record a scheduling callback (meeting booked via an outcome's embed). */
  @Post('forms/:accountCode/:slug/booking')
  @HttpCode(202)
  async booking(
    @Param('accountCode') accountCode: string,
    @Param('slug') slug: string,
    @Body() body: unknown,
  ) {
    try {
      return unwrap(await this.svc.booking(accountCode, slug, body));
    } catch (err) {
      badReq(err);
    }
  }
}
