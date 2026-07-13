import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Db } from '@slate/db';
import {
  addTeamMember,
  changeMemberRole,
  createEventType,
  createSchedule,
  createTeam,
  deleteEventType,
  deleteSchedule,
  deleteTeam,
  getAccountMember,
  getEventTypeById,
  getSchedule,
  getTeamById,
  inviteMember,
  listEventTypes,
  listMembers,
  listSchedules,
  listTeamMembers,
  listTeams,
  removeMember,
  removeTeamMember,
  setMemberStatus,
  updateEventType,
  updateSchedule,
  updateTeam,
  updateTeamMemberRole,
  type CrudResult,
} from '@slate/db';
import {
  eventTypeInputSchema,
  memberInviteSchema,
  memberPatchSchema,
  scheduleInputSchema,
  teamInputSchema,
  teamMemberInputSchema,
} from '@slate/types';
import { ZodError } from 'zod';
import { AuthService, type ReqLike } from './auth.service';
import { assertAdmin, assertCanManageTarget, assertNotSelf, assertOwnsOrAdmin } from './permissions';
import { DB } from './tokens';

function parse<T>(schema: { parse: (v: unknown) => T }, body: unknown): T {
  try {
    return schema.parse(body);
  } catch (err) {
    if (err instanceof ZodError)
      throw new BadRequestException({ error: 'BAD_REQUEST', message: err.issues[0]?.message });
    throw err;
  }
}

function unwrapCrud<T>(r: CrudResult<T>): T {
  if (r.ok) return r.value;
  if (r.reason === 'NOT_FOUND') throw new NotFoundException({ error: 'NOT_FOUND', message: 'Not found.' });
  throw new ConflictException({ error: r.reason, message: r.message ?? 'Conflict.' });
}

/** Host-authed CRUD for event-types, schedules, teams, members. */
@Controller('v1')
export class AdminCrudController {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}

  // --- Members (workspace roster) ---------------------------------------
  // The whole roster (role + status) is admin/owner-only — it doubles as the
  // host picker for team round-robin selection (also an admin activity).
  @Get('members')
  async members(@Req() req: ReqLike) {
    const p = await this.auth.resolveHost(req);
    assertAdmin(p);
    return listMembers(this.db, p.accountId);
  }

  @Post('members')
  @HttpCode(201)
  async inviteMember(@Req() req: ReqLike, @Body() body: unknown) {
    const p = await this.auth.resolveHost(req);
    assertAdmin(p);
    const input = parse(memberInviteSchema, body);
    return unwrapCrud(await inviteMember(this.db, p.accountId, input));
  }

  @Patch('members/:id')
  async updateMember(@Req() req: ReqLike, @Param('id') id: string, @Body() body: unknown) {
    const p = await this.auth.resolveHost(req);
    assertAdmin(p);
    assertNotSelf(p, id);
    const input = parse(memberPatchSchema, body);
    const target = await getAccountMember(this.db, p.accountId, id);
    if (!target) throw new NotFoundException({ error: 'NOT_FOUND', message: 'Not found.' });
    // Admins may not act on owners, nor promote anyone to owner — owner-only.
    assertCanManageTarget(p, target, { toRole: input.role });
    let updated = target;
    if (input.role !== undefined) updated = unwrapCrud(await changeMemberRole(this.db, p.accountId, id, input.role));
    if (input.status !== undefined) updated = unwrapCrud(await setMemberStatus(this.db, p.accountId, id, input.status));
    return updated;
  }

  @Delete('members/:id')
  @HttpCode(200)
  async removeMember(@Req() req: ReqLike, @Param('id') id: string) {
    const p = await this.auth.resolveHost(req);
    assertAdmin(p);
    assertNotSelf(p, id);
    const target = await getAccountMember(this.db, p.accountId, id);
    if (!target) return { ok: true }; // idempotent — already gone
    assertCanManageTarget(p, target);
    unwrapCrud(await removeMember(this.db, p.accountId, id));
    return { ok: true };
  }

  // --- Event types -------------------------------------------------------
  @Get('event-types')
  async listEventTypes(@Req() req: ReqLike, @Query('teamId') teamId?: string) {
    const p = await this.auth.resolveHost(req);
    return listEventTypes(this.db, p.accountId, teamId ? { teamId } : { memberId: p.memberId });
  }

  @Get('event-types/:id')
  async getEventType(@Req() req: ReqLike, @Param('id') id: string) {
    const p = await this.auth.resolveHost(req);
    const et = await getEventTypeById(this.db, p.accountId, id);
    if (!et) throw new NotFoundException({ error: 'NOT_FOUND', message: 'Not found.' });
    // A member sees only their own; admin/owner see anyone's (team events too).
    assertOwnsOrAdmin(p, et.memberId);
    return et;
  }

  @Post('event-types')
  @HttpCode(201)
  async createEventType(@Req() req: ReqLike, @Body() body: unknown) {
    const p = await this.auth.resolveHost(req);
    const input = parse(eventTypeInputSchema, body);
    // A team event-type is a cross-member resource → admin/owner only. A plain
    // member may only create their OWN personal event-type.
    if (input.teamId) assertAdmin(p);
    return unwrapCrud(await createEventType(this.db, p.accountId, p.memberId, input));
  }

  @Patch('event-types/:id')
  async updateEventType(@Req() req: ReqLike, @Param('id') id: string, @Body() body: unknown) {
    const p = await this.auth.resolveHost(req);
    const existing = await getEventTypeById(this.db, p.accountId, id);
    if (!existing) throw new NotFoundException({ error: 'NOT_FOUND', message: 'Not found.' });
    assertOwnsOrAdmin(p, existing.memberId);
    const input = parse(eventTypeInputSchema.partial(), body);
    return unwrapCrud(await updateEventType(this.db, p.accountId, id, input));
  }

  @Delete('event-types/:id')
  @HttpCode(204)
  async deleteEventType(@Req() req: ReqLike, @Param('id') id: string) {
    const p = await this.auth.resolveHost(req);
    const existing = await getEventTypeById(this.db, p.accountId, id);
    if (!existing) return; // idempotent — already gone (204)
    assertOwnsOrAdmin(p, existing.memberId);
    await deleteEventType(this.db, p.accountId, id);
  }

  // --- Schedules ---------------------------------------------------------
  @Get('schedules')
  async listSchedules(@Req() req: ReqLike) {
    const p = await this.auth.resolveHost(req);
    return listSchedules(this.db, p.memberId);
  }

  @Get('schedules/:id')
  async getSchedule(@Req() req: ReqLike, @Param('id') id: string) {
    const p = await this.auth.resolveHost(req);
    const s = await getSchedule(this.db, p.accountId, id);
    if (!s) throw new NotFoundException({ error: 'NOT_FOUND', message: 'Not found.' });
    assertOwnsOrAdmin(p, s.memberId);
    return s;
  }

  @Post('schedules')
  @HttpCode(201)
  async createSchedule(@Req() req: ReqLike, @Body() body: unknown) {
    const p = await this.auth.resolveHost(req);
    const input = parse(scheduleInputSchema, body);
    // A schedule is always created under the caller — nothing cross-member here.
    return createSchedule(this.db, p.accountId, p.memberId, input);
  }

  @Patch('schedules/:id')
  async updateSchedule(@Req() req: ReqLike, @Param('id') id: string, @Body() body: unknown) {
    const p = await this.auth.resolveHost(req);
    const existing = await getSchedule(this.db, p.accountId, id);
    if (!existing) throw new NotFoundException({ error: 'NOT_FOUND', message: 'Not found.' });
    assertOwnsOrAdmin(p, existing.memberId);
    const input = parse(scheduleInputSchema.partial(), body);
    return unwrapCrud(await updateSchedule(this.db, p.accountId, id, input));
  }

  @Delete('schedules/:id')
  @HttpCode(204)
  async deleteSchedule(@Req() req: ReqLike, @Param('id') id: string) {
    const p = await this.auth.resolveHost(req);
    const existing = await getSchedule(this.db, p.accountId, id);
    if (!existing) return; // idempotent — already gone (204)
    assertOwnsOrAdmin(p, existing.memberId);
    await deleteSchedule(this.db, p.accountId, id);
  }

  // --- Teams -------------------------------------------------------------
  @Get('teams')
  async listTeams(@Req() req: ReqLike) {
    const p = await this.auth.resolveHost(req);
    return listTeams(this.db, p.accountId);
  }

  @Post('teams')
  @HttpCode(201)
  async createTeam(@Req() req: ReqLike, @Body() body: unknown) {
    const p = await this.auth.resolveHost(req);
    assertAdmin(p);
    const input = parse(teamInputSchema, body);
    const team = unwrapCrud(await createTeam(this.db, p.accountId, input));
    // The creator is the first OWNER (so a team always has ≥1 owner — F14).
    await addTeamMember(this.db, p.accountId, team.id, p.memberId, 'owner');
    return team;
  }

  @Patch('teams/:id')
  async updateTeam(@Req() req: ReqLike, @Param('id') id: string, @Body() body: unknown) {
    const p = await this.auth.resolveHost(req);
    assertAdmin(p);
    const input = parse(teamInputSchema.partial(), body);
    return unwrapCrud(await updateTeam(this.db, p.accountId, id, input));
  }

  @Delete('teams/:id')
  @HttpCode(200)
  async deleteTeam(@Req() req: ReqLike, @Param('id') id: string) {
    const p = await this.auth.resolveHost(req);
    assertAdmin(p);
    return unwrapCrud(await deleteTeam(this.db, p.accountId, id));
  }

  @Get('teams/:id/members')
  async teamMembers(@Req() req: ReqLike, @Param('id') id: string) {
    const p = await this.auth.resolveHost(req);
    const team = await getTeamById(this.db, p.accountId, id);
    if (!team) throw new NotFoundException({ error: 'NOT_FOUND', message: 'Not found.' });
    return listTeamMembers(this.db, p.accountId, id);
  }

  @Post('teams/:id/members')
  @HttpCode(201)
  async addMember(@Req() req: ReqLike, @Param('id') id: string, @Body() body: unknown) {
    const p = await this.auth.resolveHost(req);
    assertAdmin(p);
    const input = parse(teamMemberInputSchema, body);
    unwrapCrud(await addTeamMember(this.db, p.accountId, id, input.memberId, input.role));
    return { ok: true };
  }

  @Patch('teams/:id/members/:memberId')
  async updateMemberRole(
    @Req() req: ReqLike,
    @Param('id') id: string,
    @Param('memberId') memberId: string,
    @Body() body: { role?: 'owner' | 'member' },
  ) {
    const p = await this.auth.resolveHost(req);
    assertAdmin(p);
    const role = body?.role === 'owner' ? 'owner' : 'member';
    unwrapCrud(await updateTeamMemberRole(this.db, p.accountId, id, memberId, role));
    return { ok: true };
  }

  @Delete('teams/:id/members/:memberId')
  async removeTeamMember(@Req() req: ReqLike, @Param('id') id: string, @Param('memberId') memberId: string) {
    const p = await this.auth.resolveHost(req);
    assertAdmin(p);
    // Owner-protection: refuses to remove the last owner (409 LAST_OWNER).
    unwrapCrud(await removeTeamMember(this.db, p.accountId, id, memberId));
    return { ok: true };
  }

  @Get('teams/:id/event-types')
  async teamEventTypes(@Req() req: ReqLike, @Param('id') id: string) {
    const p = await this.auth.resolveHost(req);
    return listEventTypes(this.db, p.accountId, { teamId: id });
  }
}
