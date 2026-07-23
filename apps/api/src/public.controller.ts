import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ZodError } from 'zod';
import { SubmissionService } from './submission.service';
import { unwrap } from './http';
import { RateLimitGuard } from './rate-limit';

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
  constructor(@Inject(SubmissionService) private readonly svc: SubmissionService) {}

  /** The published form config for the public renderer. */
  @Get('forms/:accountCode/:slug')
  async form(@Param('accountCode') accountCode: string, @Param('slug') slug: string) {
    const f = await this.svc.publicForm(accountCode, slug);
    if (!f) throw new NotFoundException({ error: 'NOT_FOUND', message: 'Form not found.' });
    return f;
  }

  /** Persist a submission (partial or complete); the score is recomputed server-side. */
  @Post('forms/:accountCode/:slug/submissions')
  @HttpCode(201)
  async submit(
    @Param('accountCode') accountCode: string,
    @Param('slug') slug: string,
    @Body() body: unknown,
  ) {
    try {
      return unwrap(await this.svc.submit(accountCode, slug, body));
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
