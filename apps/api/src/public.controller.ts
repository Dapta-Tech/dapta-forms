import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ZodError } from 'zod';
import { BookingService } from './booking.service';
import { unwrap } from './http';
import { RateLimitGuard } from './rate-limit';

function badReq(err: unknown): never {
  if (err instanceof ZodError)
    throw new BadRequestException({ error: 'BAD_REQUEST', message: err.issues[0]?.message });
  throw err;
}

/**
 * Resolve the manage token from the least-leaky source available. Prefer the
 * `X-Manage-Token` header, then a POST body field, and only then the `?token=`
 * query param — kept for backward-compat because links already in the wild
 * (emails, calendar invites) carry the token in the query string. New links
 * should use the header/body so the token stays out of access logs and Referer.
 */
function manageToken(sources: {
  headerToken?: string;
  bodyToken?: string;
  queryToken?: string;
}): string {
  return (sources.headerToken || sources.bodyToken || sources.queryToken || '').trim();
}

/**
 * Public, unauthenticated booking surface (personal + team + manage).
 * Rate-limited per IP (P1-5) — this is the only surface an anonymous client can
 * hit, so booking spam / availability scraping / uid-token probing are throttled.
 */
@UseGuards(RateLimitGuard)
@Controller('v1')
export class PublicController {
  constructor(@Inject(BookingService) private readonly svc: BookingService) {}

  @Get('profiles/:accountCode/:handle')
  async profile(@Param('accountCode') accountCode: string, @Param('handle') handle: string) {
    const p = await this.svc.profile(accountCode, handle);
    if (!p) throw new NotFoundException({ error: 'NOT_FOUND', message: 'Booking page not found.' });
    return p;
  }

  @Get('availability')
  async availability(@Query() query: Record<string, string>) {
    try {
      const r = await this.svc.availability(query);
      if (!r) throw new NotFoundException({ error: 'NOT_FOUND', message: 'Booking page not found.' });
      return r;
    } catch (err) {
      badReq(err);
    }
  }

  @Post('reservations')
  @HttpCode(201)
  async reserve(@Body() body: unknown) {
    try {
      return unwrap(await this.svc.reserve(body));
    } catch (err) {
      badReq(err);
    }
  }

  @Post('bookings')
  @HttpCode(201)
  async book(@Body() body: unknown) {
    try {
      return unwrap(await this.svc.book(body));
    } catch (err) {
      badReq(err);
    }
  }

  @Get('bookings/:uid')
  async manageView(
    @Param('uid') uid: string,
    @Headers('x-manage-token') headerToken: string | undefined,
    @Query('token') queryToken: string | undefined,
  ) {
    return unwrap(await this.svc.manageView(uid, manageToken({ headerToken, queryToken })));
  }

  @Post('bookings/:uid/cancel')
  @HttpCode(200)
  async cancel(
    @Param('uid') uid: string,
    @Headers('x-manage-token') headerToken: string | undefined,
    @Query('token') queryToken: string | undefined,
    @Body() body: { reason?: string; token?: string },
  ) {
    const token = manageToken({ headerToken, bodyToken: body?.token, queryToken });
    return unwrap(await this.svc.cancel(uid, { token, reason: body?.reason }));
  }

  @Post('bookings/:uid/reschedule')
  @HttpCode(200)
  async reschedule(
    @Param('uid') uid: string,
    @Headers('x-manage-token') headerToken: string | undefined,
    @Query('token') queryToken: string | undefined,
    @Body() body: { newStartUtc: string; token?: string },
  ) {
    if (!body?.newStartUtc)
      throw new BadRequestException({ error: 'BAD_REQUEST', message: 'newStartUtc required' });
    const token = manageToken({ headerToken, bodyToken: body?.token, queryToken });
    return unwrap(await this.svc.reschedule(uid, { token, newStartUtc: body.newStartUtc }));
  }

  // --- Teams (public) -----------------------------------------------------

  @Get('public/teams/:accountCode/:teamSlug')
  async teamProfile(@Param('accountCode') accountCode: string, @Param('teamSlug') teamSlug: string) {
    const p = await this.svc.teamProfile(accountCode, teamSlug);
    if (!p) throw new NotFoundException({ error: 'NOT_FOUND', message: 'Team not found.' });
    return p;
  }

  @Get('public/teams/:accountCode/:teamSlug/availability')
  async teamAvailability(
    @Param('accountCode') accountCode: string,
    @Param('teamSlug') teamSlug: string,
    @Query() q: Record<string, string>,
  ) {
    if (!q.slug || !q.from || !q.to)
      throw new BadRequestException({ error: 'BAD_REQUEST', message: 'slug, from, to required' });
    const r = await this.svc.teamAvailability(accountCode, teamSlug, q.slug, q.from, q.to, q.timeZone);
    if (!r) throw new NotFoundException({ error: 'NOT_FOUND', message: 'Team event not found.' });
    return r;
  }

  @Post('public/teams/:accountCode/:teamSlug/bookings')
  @HttpCode(201)
  async teamBook(
    @Param('accountCode') accountCode: string,
    @Param('teamSlug') teamSlug: string,
    @Body() body: { slug: string; startUtc: string; attendee: never; answers?: Record<string, unknown> },
  ) {
    return unwrap(await this.svc.teamBook(accountCode, teamSlug, body));
  }
}
