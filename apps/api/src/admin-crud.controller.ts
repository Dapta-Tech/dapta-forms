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
  Put,
  Req,
} from '@nestjs/common';
import type { Db } from '@quill/db';
import {
  changeMemberRole,
  createForm,
  deleteForm,
  duplicateForm,
  getAccountMember,
  getFormById,
  inviteMember,
  listForms,
  listMembers,
  removeMember,
  setMemberStatus,
  updateForm,
  type CrudResult,
} from '@quill/db';
import { formInputSchema, memberInviteSchema, memberPatchSchema } from '@quill/types';
import { ZodError } from 'zod';
import { AdminService } from './admin.service';
import { SubmissionService } from './submission.service';
import { AuthService, type ReqLike } from './auth.service';
import { assertAdmin, assertCanManageTarget, assertNotSelf } from './permissions';
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

/** Host-authed CRUD for forms + submissions + members, and identity/vanity. */
@Controller('v1')
export class AdminCrudController {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(AdminService) private readonly admin: AdminService,
    @Inject(SubmissionService) private readonly submissions: SubmissionService,
  ) {}

  // --- Identity ----------------------------------------------------------
  @Get('me')
  async me(@Req() req: ReqLike) {
    const p = await this.auth.resolveHost(req);
    return this.admin.me(p);
  }

  @Get('vanity')
  async vanity(@Req() req: ReqLike) {
    const p = await this.auth.resolveHost(req);
    return this.admin.vanityStatus(p);
  }

  @Put('vanity')
  async setVanity(@Req() req: ReqLike, @Body() body: { slug?: string | null }) {
    const p = await this.auth.resolveHost(req);
    assertAdmin(p);
    const out = await this.admin.setVanity(p, body?.slug ?? null);
    if (!out.ok) throw new ConflictException({ error: out.reason, message: 'Cannot set vanity slug.' });
    return out;
  }

  // --- Forms -------------------------------------------------------------
  @Get('forms')
  async listForms(@Req() req: ReqLike) {
    const p = await this.auth.resolveHost(req);
    return listForms(this.db, p.accountId);
  }

  @Get('forms/:id')
  async getForm(@Req() req: ReqLike, @Param('id') id: string) {
    const p = await this.auth.resolveHost(req);
    const f = await getFormById(this.db, p.accountId, id);
    if (!f) throw new NotFoundException({ error: 'NOT_FOUND', message: 'Not found.' });
    return f;
  }

  @Post('forms')
  @HttpCode(201)
  async createForm(@Req() req: ReqLike, @Body() body: unknown) {
    const p = await this.auth.resolveHost(req);
    const input = parse(formInputSchema, body);
    return unwrapCrud(await createForm(this.db, p.accountId, input));
  }

  @Put('forms/:id')
  async updateForm(@Req() req: ReqLike, @Param('id') id: string, @Body() body: unknown) {
    const p = await this.auth.resolveHost(req);
    const input = parse(formInputSchema.partial(), body);
    return unwrapCrud(await updateForm(this.db, p.accountId, id, input));
  }

  @Post('forms/:id/duplicate')
  @HttpCode(201)
  async duplicateForm(@Req() req: ReqLike, @Param('id') id: string) {
    const p = await this.auth.resolveHost(req);
    return unwrapCrud(await duplicateForm(this.db, p.accountId, id));
  }

  @Delete('forms/:id')
  @HttpCode(204)
  async deleteForm(@Req() req: ReqLike, @Param('id') id: string) {
    const p = await this.auth.resolveHost(req);
    const existing = await getFormById(this.db, p.accountId, id);
    if (!existing) return; // idempotent — already gone (204)
    await deleteForm(this.db, p.accountId, id);
  }

  @Get('forms/:id/submissions')
  async formSubmissions(@Req() req: ReqLike, @Param('id') id: string) {
    const p = await this.auth.resolveHost(req);
    const f = await getFormById(this.db, p.accountId, id);
    if (!f) throw new NotFoundException({ error: 'NOT_FOUND', message: 'Not found.' });
    return this.submissions.listSubmissions(id);
  }

  // --- Members (workspace roster; admin/owner-only) ----------------------
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
}
