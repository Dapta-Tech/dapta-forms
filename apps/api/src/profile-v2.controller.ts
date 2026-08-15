import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Inject,
  NotFoundException,
  Optional,
  Post,
  Put,
  Req,
} from '@nestjs/common';
import type { Db } from '@quill/db';
import {
  casSetMemberProfile,
  fenceMemberProfile,
  getAccountMember,
  getMemberProfileState,
  type ProfileWriteResult,
} from '@quill/db';
import { memberProfileSchema } from '@quill/types';
import { ZodError } from 'zod';
import { DB, ENV } from './tokens';
import type { ServerEnv } from '@quill/config/env';
import { AuthService, type ReqLike } from './auth.service';

/**
 * The public page write contract, v2 — compare-and-set plus a fence.
 *
 * v1 could only say "the write was accepted". That is not enough for a browser
 * whose request timed out: the timeout does not abort the write, so the client
 * cannot tell "never applied" from "applied, answer lost", and rereading can
 * return pre-write state while the write is still in flight. Every mutation
 * here therefore names the revision it expects, and the fence lets a client
 * settle one ambiguous write by ordering itself after it.
 *
 * The version lives in the PATH, not in an optional field: an older API build
 * cannot recognise `/v2`, so it answers 404 rather than silently accepting a
 * new-web mutation without the guard. Missing or invalid revisions fail closed.
 */

/** A successful write: what is stored now, and the revision behind it. */
interface ProfileStateBody {
  ok: true;
  profile: unknown;
  revision: number;
}

const conflict = (r: { profile: unknown; revision: number }): never => {
  throw new ConflictException({
    error: 'REVISION_CONFLICT',
    message: 'The public page moved on. Reload the current state and try again.',
    profile: r.profile,
    revision: r.revision,
  });
};

const notFound = (): never => {
  throw new NotFoundException({ error: 'NOT_FOUND', message: 'Not found.' });
};

/**
 * The write neither landed nor lost. Distinct from a conflict on purpose: the
 * caller must keep writing blocked and ask again, and must not adopt state or
 * announce anything about the attempt.
 */
const unresolved = (): never => {
  throw new HttpException(
    {
      error: 'WRITE_UNRESOLVED',
      message: 'The write could not be resolved. Ask again before writing.',
    },
    HttpStatus.SERVICE_UNAVAILABLE,
  );
};

/**
 * NEW v2 writes are OFF until an operator confirms every API writer in the fleet
 * increments the revision. Until then a save is refused BEFORE it can touch the
 * row, and the read below advertises write admission as unavailable so a new web
 * build blocks instead of discovering it one failed save at a time.
 *
 * This gates saves ONLY. The fence is recovery, not a new write: a browser
 * holding an expectation from a save that was admitted earlier must still be
 * able to settle it, or turning the flag off would strand exactly the sessions
 * that are already in trouble.
 */
const writesDisabled = (): never => {
  throw new HttpException(
    {
      error: 'V2_WRITES_DISABLED',
      message: 'Revision-guarded writes are not enabled on this server.',
    },
    HttpStatus.NOT_IMPLEMENTED,
  );
};

/**
 * `expectedRevision` is REQUIRED and must be a safe non-negative integer.
 * Absent, null, "3", 3.5 and -1 are all rejected: a mutation that cannot name
 * its baseline is exactly the unguarded write this contract exists to stop.
 */
function requireExpectedRevision(body: unknown): number {
  const raw = (body as { expectedRevision?: unknown } | null | undefined)?.expectedRevision;
  if (typeof raw !== 'number' || !Number.isSafeInteger(raw) || raw < 0) {
    throw new BadRequestException({
      error: 'REVISION_REQUIRED',
      message: 'expectedRevision must be a non-negative integer.',
    });
  }
  return raw;
}

/** Turn a repository outcome into the HTTP contract. */
function respond(result: ProfileWriteResult): ProfileStateBody {
  if (result.status === 'not_found') return notFound();
  if (result.status === 'unresolved') return unresolved();
  if (result.status === 'conflict') return conflict(result);
  return { ok: true, profile: result.profile, revision: result.revision };
}

@Controller('v2/me/profile')
export class ProfileV2Controller {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(AuthService) private readonly auth: AuthService,
    /**
     * Optional so direct constructions in tests keep working; absent means the
     * gate is CLOSED, which is the safe default for anything that did not
     * deliberately turn revision-guarded writes on.
     */
    @Optional() @Inject(ENV) private readonly env?: Pick<ServerEnv, 'PROFILE_V2_WRITES_ENABLED'>,
  ) {}

  private get writesEnabled(): boolean {
    return this.env?.PROFILE_V2_WRITES_ENABLED === true;
  }

  /**
   * The caller's own public page plus the revision to write against. The same
   * body as `GET /v1/me/profile`; a client that gets no numeric `revision` from
   * either route is talking to an API that cannot guard writes, and must not
   * write at all.
   */
  @Get()
  async read(@Req() req: ReqLike) {
    const p = await this.auth.resolveHost(req);
    const member = await getAccountMember(this.db, p.accountId, p.memberId);
    if (!member) return notFound();
    const state = await getMemberProfileState(this.db, p.accountId, p.memberId);
    if (!state) return notFound();
    // Reads are never gated: a client must be able to see its page, and to see
    // that it may not write to it.
    return {
      handle: member.handle,
      profile: state.profile,
      revision: state.revision,
      /** May a NEW save start here? */
      writesEnabled: this.writesEnabled,
      /**
       * May an ambiguous save be settled here? True on every revision-aware
       * build, independently of write admission. An older API reports neither
       * field and supports neither.
       */
      fenceSupported: true,
    };
  }

  /**
   * Replace the caller's own public page if the row is still at
   * `expectedRevision`. Scoped to the CALLER's member row, never an id from the
   * request. A stale expectation is a 409 carrying authoritative state and
   * burns no revision, so retrying after adopting it is safe.
   */
  @Put()
  async save(@Req() req: ReqLike, @Body() body: unknown) {
    // Identify the caller BEFORE deciding anything else, including whether this
    // deployment admits guarded writes at all. Write-gate posture describes how
    // far along an operator's rollout is, and an anonymous caller has no
    // business learning it — so an unauthenticated request gets the ordinary
    // auth refusal here, exactly as it would from any other admin route.
    const p = await this.auth.resolveHost(req);
    // Still the FIRST decision after identity: an admitted caller learns only
    // that writes are closed, never whether its revision or its profile would
    // have been acceptable, and nothing reaches the row.
    if (!this.writesEnabled) return writesDisabled();
    const expectedRevision = requireExpectedRevision(body);
    const raw = (body as { profile?: unknown } | null)?.profile ?? null;
    let profile: unknown = null;
    try {
      profile = raw == null ? null : memberProfileSchema.parse(raw);
    } catch (err) {
      if (err instanceof ZodError) {
        throw new BadRequestException({ error: 'BAD_REQUEST', message: err.issues[0]?.message });
      }
      throw err;
    }
    return respond(
      await casSetMemberProfile(this.db, p.accountId, p.memberId, profile, expectedRevision),
    );
  }

  /**
   * Order one ambiguous save. Advances the revision without touching content:
   * winning proves the ambiguous write never landed and never can, losing
   * returns the state that beat it.
   *
   * POST, not GET: it mutates. Repeating it with the SAME original expectation
   * is naturally idempotent — the first call spends that revision, so every
   * repeat conflicts instead of advancing the counter again.
   */
  @Post('fence')
  async fence(@Req() req: ReqLike, @Body() body: unknown) {
    // Deliberately NOT gated by write admission — see `writesDisabled`.
    const p = await this.auth.resolveHost(req);
    const expectedRevision = requireExpectedRevision(body);
    return respond(await fenceMemberProfile(this.db, p.accountId, p.memberId, expectedRevision));
  }
}
