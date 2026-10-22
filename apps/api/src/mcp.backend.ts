import { HttpException, Logger } from '@nestjs/common';
import {
  findApiKeyPrincipal,
  getAccountByExternalId,
  getFormById,
  grantStaffAccess,
  listLiveStepCounts,
  listWorkspacesForIdentity,
  searchProjectedAccounts,
  sql,
  StaffGrantRefused,
  type Db,
} from '@quill/db';
import {
  formatAnswerValue,
  nameFields,
  resolveOutcome,
  summarizeAnswersByStep,
  type Answers,
  type FormConfig as EngineConfig,
  type FormStep,
} from '@quill/engine';
import {
  BackendError,
  DoorRefusal,
  DoorUnavailable,
  ToolFailure,
  normalizeWorkspaceSearch,
  openDFormsOnce,
  type McpStaffAccess,
  type StaffWorkspaceHit,
  type AnalyticsQuery,
  type CoreFormsBackend,
  type CreateFormInput,
  type FormAnalytics,
  type FormDetail,
  type FormListItem,
  type McpCaller,
  type McpConnection,
  type ResponseAnswer,
  type ResponsesPage,
  type ResponsesQuery,
  type UpdateFormInput,
  type WhoAmI,
} from '@quill/mcp';
import type { AdminCrudController } from './admin-crud.controller';
import type { AnalyticsController } from './analytics.controller';
import { API_KEY_PREFIX, hashApiKey } from './api-keys';
import { isKeyAllowedRoute, routeOf } from './api-key-routes';
import type { ReqLike } from './auth.provider';
import { inProcessRequest } from './in-process-principal';
import { IssuerUnavailable, type McpOAuth } from './mcp-oauth';
import { lookUpPerson, type Person, type PersonDirectory } from './person-directory';
import { isStaffEmail, MEMBERSHIP_NOT_ACTIVE_MESSAGE, upstreamWorkspaceIdOf } from './staff';

/**
 * forms-api's side of the MCP port (`FormsBackend` in `@quill/mcp`).
 *
 * Every tool call runs the SAME handler the REST route runs, in process, with
 * a request that carries the caller's in-process principal (see
 * `in-process-principal.ts`): the member and workspace it acts as, and for an
 * API key the key's hash. So nothing here re-states a rule: the handler
 * resolves the principal on every call (a key revoked, or a member disabled or
 * removed, mid-session stops working at once), counts a key against its 120
 * calls a minute, scopes every read and write to the principal's workspace,
 * applies the member's live role, the strict agent validation, the config
 * normalization and the brand kit, emits the product events, and adds
 * `publicUrl` and `editorUrl`. There is no second implementation to drift.
 *
 * The principal also makes a form it creates record `created_via = 'mcp'`. The
 * request carries no credential and no `x-quill-workspace` header: the
 * workspace is always the principal's.
 */

/** What the authenticator hands the backend for one caller. Never logged, never returned. */
interface ApiCallerContext {
  req: ReqLike;
}

/**
 * Every controller handler the MCP calls, by name. The single list both the
 * types below and the route check derive from: a handler can only be called
 * if it is named here, and naming it here is checked against the API-key
 * route allowlist (`keyAllowedRoutes`).
 */
export const MCP_FORM_HANDLERS = [
  'me',
  'listForms',
  'getForm',
  'createForm',
  'updateForm',
  'publishForm',
  'revertForm',
  'discardDraft',
  'formSubmissions',
] as const;
export const MCP_ANALYTICS_HANDLERS = ['formAnalytics'] as const;

/** The handlers the backend calls. The controllers themselves in the app; fakes in a spec. */
export interface McpHandlers {
  forms: Pick<AdminCrudController, (typeof MCP_FORM_HANDLERS)[number]>;
  analytics: Pick<AnalyticsController, (typeof MCP_ANALYTICS_HANDLERS)[number]>;
}

/**
 * The routes of `names` on `controller`, each proven callable with an API key.
 *
 * The MCP calls handlers in process, so the app-wide `ApiKeyRouteGuard` never
 * runs for it. This is the same check, made once at boot: a handler with no
 * route metadata, or whose route is not on `API_KEY_ALLOWED_ROUTES`, throws,
 * and the API refuses to start rather than let a tool reach a route a key may
 * not call over HTTP.
 *
 * It covers every in-process principal, with or without a key: the backend is
 * the only code that builds one for a handler, and it reaches handlers only
 * through `McpHandlers`, whose names are the ones checked here.
 */
export function keyAllowedRoutes(controller: abstract new (...args: never[]) => object, names: readonly string[]): string[] {
  return names.map((name) => {
    const handler = (controller.prototype as Record<string, unknown>)[name];
    const route = typeof handler === 'function' ? routeOf(controller, handler) : null;
    if (route === null) throw new Error(`MCP handler ${controller.name}.${name} has no route: it cannot be checked against the API-key allowlist.`);
    if (!isKeyAllowedRoute(route))
      throw new Error(`MCP handler ${controller.name}.${name} (${route}) is not on the API-key route allowlist.`);
    return route;
  });
}

/**
 * Resolve a bearer token to the MCP caller: an active key of an active member,
 * or null. A lookup only: it neither counts against the key's budget nor
 * stamps its last use, because every tool call goes through the full key path
 * again (`AuthService.resolveHost`), which does both.
 */
export async function authenticateMcpKey(db: Db, token: string): Promise<McpCaller | null> {
  if (!token.startsWith(API_KEY_PREFIX)) return null;
  const keyHash = hashApiKey(token);
  const row = await findApiKeyPrincipal(db, keyHash);
  if (!row || row.memberStatus !== 'active') return null;
  const context: ApiCallerContext = {
    req: inProcessRequest({ accountId: row.accountId, memberId: row.memberId, apiKeyHash: keyHash }),
  };
  return {
    accountId: row.accountId,
    workspaceName: row.accountName,
    memberId: row.memberId,
    role: row.role,
    credentialId: row.keyId,
    // The stored, displayed prefix of the key (see `generateApiKey`).
    label: token.slice(0, 12),
    context,
  };
}

/**
 * Resolve an access token to an MCP connection: the person it signs in, with
 * one caller per workspace where they hold an active member (each acting as
 * that member through its own in-process principal). Null when the token does
 * not verify (a 401 that points at the login again), and `DoorUnavailable`
 * (a 503) while the identity provider's keys cannot be read.
 *
 * A token that verifies but names nobody the directory knows is a
 * `DoorRefusal` (403) with a message the person can act on, because signing
 * in again would not change it. A person with no workspace yet is let in with
 * none: their tools answer NO_WORKSPACE, which the agent can explain.
 *
 * The workspaces are dForms' own active members, matched by the person's
 * identity-service id, or by email on a member no other person holds yet,
 * never the identity provider's view. Rows held by a staff access grant are
 * never listed there. A person who is STAFF of the deployment on this request
 * (their directory email on one of `staffDomains`, the rule the web app
 * applies) also gets `staff`: a search over every workspace, and a way into
 * any live one through a staff access grant (see `staffAccessFor`). Grant
 * rows are never revoked, so staff is judged again on every request: a person
 * who stops being staff reaches none of them on the next call.
 *
 * Like a key, this is a lookup only, done again on every request: every tool
 * call re-reads its member through `AuthService.resolveHost`, so a member
 * disabled, removed or demoted after this point is seen on the call itself.
 */
export async function authenticateMcpConnection(
  db: Db,
  oauth: McpOAuth,
  directory: PersonDirectory,
  token: string,
  opts: McpConnectionOptions = {},
): Promise<McpConnection | null> {
  const appUrl = opts.appUrl ?? '';
  let access;
  try {
    access = await oauth.verify(token);
  } catch (error) {
    // The identity provider's keys cannot be read and none are cached: an
    // outage, so a 503 to retry, never a 401 that would loop the login.
    if (error instanceof IssuerUnavailable) throw new DoorUnavailable('dForms cannot check this sign-in right now. Try again in a minute.');
    throw error;
  }
  if (!access) return null;
  const person = await lookUpPerson(directory, access.subject);
  if (!person) {
    throw new DoorRefusal(`This sign-in has no dForms account yet: ${openDFormsOnce(appUrl, 'connect again')}`);
  }
  const label = `oauth:${person.id}`;
  // An email match counts only on a member nobody holds yet, or this person:
  // the email comes from the identity service, and must never reach a member
  // another person already signed in as.
  const rows = await listWorkspacesForIdentity(db, { externalId: person.id, email: person.email }, { emailOnlyWhenUnbound: true });
  const workspaces = rows
    .filter((w) => w.status === 'active' && w.accessGrant === null)
    .map((w) => memberCaller(person, label, { accountId: w.accountId, accountName: w.accountName, memberId: w.memberId, role: w.role }));
  const connection: McpConnection = { personId: person.id, email: person.email, label, workspaces };
  if (isStaffEmail(person.email, opts.staffDomains) && directory.workspaceOf && directory.searchWorkspaces) {
    connection.staff = staffAccessFor(db, directory as StaffDirectory, person, label, workspaces, opts.staffLog ?? defaultStaffLog);
  }
  return connection;
}

/** Longest stored answer a leftover row carries (the summary rows' own cap); the tool cuts again for the model. */
const LEFTOVER_MAX = 2000;

/**
 * A response's answers as the owner reads them, each with the step it
 * answers: the rows the notification emails print (`summarizeAnswersByStep`:
 * the question as the respondent saw it, option labels, step order). Then
 * whatever the response stores under a key the live form does not have,
 * marked `stepRemoved`: a step deleted or renamed since, or extra data the
 * respondent's browser sent. Those print as stored (no step is left to map a
 * value to its label), so an agent never reads a response as having fewer
 * answers than it does.
 */
export function answerRows(config: EngineConfig, data: Answers): ResponseAnswer[] {
  const rows: ResponseAnswer[] = summarizeAnswersByStep(config, data).map((row) => ({
    question: row.label,
    answer: row.value,
    stepKey: row.key,
    type: row.type,
  }));
  const known = new Set((config.steps ?? []).flatMap((step) => [step.key, ...nameFields(step)]));
  for (const [key, raw] of Object.entries(data)) {
    if (known.has(key)) continue;
    const value = formatAnswerValue({ key, type: 'text' } as FormStep, raw, { separator: ', ' });
    if (!value) continue;
    rows.push({ question: key, answer: value.slice(0, LEFTOVER_MAX), stepKey: key, type: null, stepRemoved: true });
  }
  return rows;
}

/** The outcome a completed response lands in, by the live config; null when none applies. */
export function outcomeOf(config: EngineConfig, score: number | null, data: Answers): { id: string; label: string } | null {
  try {
    const outcome = resolveOutcome(config, score ?? 0, data);
    return outcome ? { id: outcome.id, label: outcome.label } : null;
  } catch {
    return null; // A stored config the engine cannot read resolves to no outcome, never a failed page.
  }
}

/** What `authenticateMcpConnection` needs beyond the token. */
export interface McpConnectionOptions {
  /** The dForms address a person with no workspace yet opens, named in the refusal. */
  appUrl?: string;
  /** Email domains whose people are staff of the deployment (`IAM_STAFF_DOMAINS`). Empty: nobody. */
  staffDomains?: readonly string[];
  /** Where a staff call outside the person's own workspaces is logged, one JSON line each. */
  staffLog?: (line: string) => void;
}

const staffLogger = new Logger('McpStaffAccess');
const defaultStaffLog = (line: string): void => staffLogger.log(line);

/** A directory that answers the staff lookups. */
type StaffDirectory = PersonDirectory & Required<Pick<PersonDirectory, 'workspaceOf' | 'searchWorkspaces'>>;

/** The caller for one member row of this person. */
function memberCaller(
  person: Person,
  label: string,
  m: { accountId: string; accountName: string; memberId: string; role: string },
  access: 'member' | 'staff' = 'member',
): McpCaller {
  return {
    accountId: m.accountId,
    workspaceName: m.accountName,
    memberId: m.memberId,
    role: m.role,
    // One bucket per member: the same person on several clients shares it.
    credentialId: `member:${m.memberId}`,
    label,
    personId: person.id,
    ...(access === 'staff' ? { access } : {}),
    context: { req: inProcessRequest({ accountId: m.accountId, memberId: m.memberId }) } satisfies ApiCallerContext,
  };
}

const UUID_SHAPED = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Staff named a workspace where their own membership is not active: never turned into a grant. */
function membershipNotActive(): ToolFailure {
  return new ToolFailure(
    'MEMBERSHIP_NOT_ACTIVE',
    MEMBERSHIP_NOT_ACTIVE_MESSAGE,
    'Tell the user. Only the workspace owner can restore the membership (or the user can accept the invitation in dForms); do not retry.',
  );
}

/** A directory call made for staff, as a tool failure the agent can act on when the directory cannot be read. */
async function fromDirectory<T>(read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch (error) {
    const name = error instanceof Error ? error.name : typeof error;
    const code = (error as { code?: unknown } | null)?.code;
    staffLogger.error(`workspace directory unreadable: ${name}${typeof code === 'string' ? ` ${code}` : ''}`);
    throw new ToolFailure('UNAVAILABLE', 'dForms cannot read the workspace directory right now.', 'Wait a minute, then retry.', 60);
  }
}

/**
 * What a staff person can do beyond their own workspaces, the way the web
 * app's switcher lets them (`WorkspaceService.search` and
 * `enterEstateWorkspace`), but read from the identity database instead of
 * with a bearer, which an MCP connection does not carry.
 *
 *   - `search`: the accounts this database already knows (by workspace name,
 *     a member's email or a form name) that are still live workspaces of the
 *     identity service, and the identity service's live workspaces (by
 *     workspace or account name), at most `limit`, each named by the
 *     identity service's workspace id (stable before and after dForms first
 *     projects it), with what it matched on. Only what `enter` would take.
 *   - `enter`: either id, in any letter case. The workspace must be live in
 *     the identity service now (read through the directory's cache). A
 *     workspace of the person's own is entered as that member. Otherwise the
 *     person acts as the `admin` row `grantStaffAccess` mints (or finds) with
 *     `access_grant = 'staff'`, exactly as the web app does; where the
 *     identity service names them a member that dForms has not projected yet,
 *     that row becomes the membership on their next projection.
 */
function staffAccessFor(
  db: Db,
  directory: StaffDirectory,
  person: Person,
  label: string,
  own: McpCaller[],
  log: (line: string) => void,
): McpStaffAccess {
  return {
    async search(query, limit) {
      const needle = normalizeWorkspaceSearch(query);
      const [local, estate] = await Promise.all([
        searchProjectedAccounts(db, query.trim().toLowerCase(), { limit }),
        fromDirectory(() => directory.searchWorkspaces(needle, limit)),
      ]);
      // A local hit counts only when it is still a live workspace upstream
      // (read through the cache), so nothing listed is refused by `enter`.
      const grantable = local.filter((hit) => upstreamWorkspaceIdOf(hit.workspaceId) !== null);
      const live = await fromDirectory(() => Promise.all(grantable.map((hit) => directory.workspaceOf(hit.workspaceId))));
      const known = await Promise.all(estate.map((ws) => getAccountByExternalId(db, ws.id)));
      // Keyed by the identity service's workspace id, so one workspace found
      // both ways is listed once, and always NAMED by that id: it exists
      // before dForms first projects the workspace and stays the same after,
      // so a search never answers with one id before a call and another one
      // after it (the local id is kept apart, only to tell the person's own
      // workspaces from the rest). Either id still enters it.
      const hits = new Map<string, StaffWorkspaceHit>();
      estate.forEach((ws, i) => {
        if (hits.has(ws.id)) return;
        const matchedOn = normalizeWorkspaceSearch(ws.name).includes(needle) ? 'name' : 'account_name';
        hits.set(ws.id, { id: ws.id, localId: known[i]?.id ?? null, name: ws.name, accountName: ws.accountName, role: 'admin', access: 'staff', matchedOn });
      });
      grantable.forEach((hit, i) => {
        const ws = live[i];
        if (!ws || hits.has(ws.id)) return;
        const matchedOn = hit.hint?.kind === 'email' ? 'member_email' : hit.hint?.kind === 'form' ? 'form_name' : 'name';
        hits.set(ws.id, { id: ws.id, localId: hit.id, name: ws.name, accountName: ws.accountName, role: 'admin', access: 'staff', matchedOn });
      });
      return [...hits.values()].slice(0, limit);
    },

    async enter(workspaceId) {
      const raw = workspaceId.trim();
      // Ids are stored lowercase; an upper-case copy names the same workspace.
      const id = UUID_SHAPED.test(raw) ? raw.toLowerCase() : raw;
      const local = await db.get<{ id: string; external_id: string | null }>(
        sql`SELECT id, external_id FROM account WHERE id = ${id} OR external_id = ${id} LIMIT 1`,
      );
      if (local) {
        // Named by the identity service's id, but a workspace of their own: as that member.
        const mine = own.find((w) => w.accountId === local.id);
        if (mine) return mine;
      }
      // A local-only account belongs to nobody upstream: nobody is granted into it.
      const upstreamId = local ? upstreamWorkspaceIdOf(local.external_id) : UUID_SHAPED.test(id) ? id : null;
      if (!upstreamId) return null;
      const ws = await fromDirectory(() => directory.workspaceOf(upstreamId));
      if (!ws) return null;

      const held = local
        ? await db.get<{ id: string; role: string; status: string; access_grant: string | null }>(
            sql`SELECT id, role, status, access_grant FROM member WHERE account_id = ${local.id} AND external_id = ${person.id} LIMIT 1`,
          )
        : undefined;
      if (local && held && held.status === 'active' && held.access_grant === null) {
        // A real membership is never turned into a grant.
        return memberCaller(person, label, { accountId: local.id, accountName: ws.name, memberId: held.id, role: held.role });
      }
      if (held && held.access_grant === null) {
        // Nor is one that is not active: a member the owner disabled stays
        // disabled, and an invitation stays an invitation.
        throw membershipNotActive();
      }
      let accountId: string;
      let memberId: string;
      let granted = false;
      let upstreamMember = false;
      if (local && held && held.status === 'active' && held.access_grant === 'staff') {
        accountId = local.id;
        memberId = held.id;
      } else {
        // A membership upstream that dForms has not projected yet is not a
        // reason to refuse: staff may act as an admin here anyway, and the
        // grant row becomes that membership (with its upstream role) the next
        // time the person's memberships are projected (the web app on their
        // next visit). Refusing left the agent stuck on a workspace the
        // search had just offered it.
        upstreamMember = await fromDirectory(async () => (await directory.holdsMembership?.(ws.id, person.id)) ?? false);
        try {
          ({ accountId, memberId } = await grantStaffAccess(
            db,
            { externalId: person.id, email: person.email, displayName: null },
            { workspaceId: ws.id, workspaceName: ws.name, iamAccountId: ws.accountId },
          ));
        } catch (error) {
          // A membership appeared between the read above and the grant.
          if (error instanceof StaffGrantRefused) throw membershipNotActive();
          throw error;
        }
        granted = true;
      }
      log(
        JSON.stringify({
          msg: 'mcp.staff_access',
          channel: 'mcp',
          via: 'staff_grant',
          personId: person.id,
          accountId,
          memberId,
          workspaceId: ws.id,
          granted,
          ...(granted && upstreamMember ? { upstreamMember: true } : {}),
        }),
      );
      return memberCaller(person, label, { accountId, accountName: ws.name, memberId, role: 'admin' }, 'staff');
    },
  };
}

export function reqOf(caller: McpCaller): ReqLike {
  const ctx = caller.context as ApiCallerContext | undefined;
  if (!ctx?.req) throw new Error('MCP caller without a request context');
  return ctx.req;
}

/** A Nest HTTP error as the port's `BackendError`; anything else is rethrown as is. */
export function toBackendError(error: unknown): unknown {
  if (!(error instanceof HttpException)) return error;
  const status = error.getStatus();
  const body = error.getResponse();
  const record = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  const code = typeof record.error === 'string' ? record.error : status === 404 ? 'NOT_FOUND' : 'ERROR';
  const message = typeof record.message === 'string' ? record.message : error.message;
  const issues = Array.isArray(record.issues)
    ? (record.issues as Array<Record<string, unknown>>).map((i) => ({
        path: String(i.path ?? ''),
        message: String(i.message ?? ''),
        code: String(i.code ?? ''),
      }))
    : [];
  const details: Record<string, unknown> = {};
  if (typeof record.updatedAt === 'number') details.updatedAt = record.updatedAt;
  if (typeof record.retryAfterSec === 'number') details.retryAfterSec = record.retryAfterSec;
  return new BackendError(status, code, message, issues, details);
}

/** Run a handler call, turning its HTTP errors into the port's. */
export async function run<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    throw toBackendError(error);
  }
}

type FormViewLike = {
  id: string;
  name: string;
  slug: string;
  folderId?: string | null;
  hasDraft?: boolean;
  draftConfig?: unknown;
  config?: unknown;
  publishedAt?: number | null;
  previousPublishedAt?: number | null;
  createdAt: number;
  updatedAt: number;
  publicUrl: string | null;
  editorUrl: string | null;
};

function listItemOf(f: FormViewLike): FormListItem {
  return {
    id: f.id,
    name: f.name,
    slug: f.slug,
    folderId: f.folderId ?? null,
    hasDraft: f.hasDraft ?? f.draftConfig != null,
    createdAt: f.createdAt,
    updatedAt: f.updatedAt,
    publicUrl: f.publicUrl,
    editorUrl: f.editorUrl,
  };
}

export function detailOf(f: FormViewLike): FormDetail {
  return {
    ...listItemOf(f),
    config: f.config ?? null,
    draftConfig: f.draftConfig ?? null,
    publishedAt: f.publishedAt ?? null,
    previousPublishedAt: f.previousPublishedAt ?? null,
  };
}

export class ApiFormsBackend implements CoreFormsBackend {
  constructor(
    private readonly db: Db,
    private readonly handlers: () => McpHandlers,
  ) {}

  whoami(caller: McpCaller): Promise<WhoAmI> {
    return run(async () => {
      const me = await this.handlers().forms.me(reqOf(caller));
      if (!me) {
        // In the terms of the credential: a signed-in person has no key to replace.
        if (caller.personId) throw new BackendError(401, 'MEMBER_NOT_ACTIVE', 'You are no longer an active member of this workspace.');
        throw new BackendError(401, 'INVALID_API_KEY', 'This API key is not valid.');
      }
      return {
        accountId: me.accountId,
        accountName: me.accountName,
        accountCode: me.accountCode,
        memberId: me.memberId,
        displayName: me.displayName,
        email: me.email,
        role: me.role,
        status: me.status,
        timezone: me.timezone,
        locale: me.locale ?? null,
      };
    });
  }

  listForms(caller: McpCaller): Promise<FormListItem[]> {
    return run(async () => {
      // In parallel: the counts are only used once the route has resolved the
      // caller (it throws otherwise), and they read the same workspace.
      const [forms, live] = await Promise.all([
        this.handlers().forms.listForms(reqOf(caller)),
        listLiveStepCounts(this.db, caller.accountId),
      ]);
      return forms.map((f) => ({ ...listItemOf(f), liveStepCount: live.get(f.id) ?? null }));
    });
  }

  getForm(caller: McpCaller, formId: string): Promise<FormDetail> {
    return run(async () => detailOf(await this.handlers().forms.getForm(reqOf(caller), formId)));
  }

  createForm(caller: McpCaller, input: CreateFormInput): Promise<FormDetail> {
    return run(async () => detailOf(await this.handlers().forms.createForm(reqOf(caller), input)));
  }

  updateForm(caller: McpCaller, formId: string, input: UpdateFormInput): Promise<FormDetail> {
    return run(async () => detailOf(await this.handlers().forms.updateForm(reqOf(caller), formId, input)));
  }

  publishForm(caller: McpCaller, formId: string, expectedUpdatedAt?: number): Promise<FormDetail> {
    return run(async () =>
      detailOf(
        await this.handlers().forms.publishForm(
          reqOf(caller),
          formId,
          expectedUpdatedAt === undefined ? {} : { expectedUpdatedAt },
        ),
      ),
    );
  }

  revertForm(caller: McpCaller, formId: string): Promise<FormDetail> {
    return run(async () => detailOf(await this.handlers().forms.revertForm(reqOf(caller), formId)));
  }

  discardDraft(caller: McpCaller, formId: string, expectedUpdatedAt?: number): Promise<FormDetail> {
    return run(async () =>
      detailOf(
        await this.handlers().forms.discardDraft(
          reqOf(caller),
          formId,
          expectedUpdatedAt === undefined ? {} : { expectedUpdatedAt },
        ),
      ),
    );
  }

  /**
   * A page through the submissions route (key resolution, account scope and
   * filters exactly as the table), then each response's answers rendered as
   * the owner reads them (`answerRows`), and a completed response's outcome
   * by the live config.
   */
  listResponses(caller: McpCaller, formId: string, query: ResponsesQuery): Promise<ResponsesPage> {
    return run(async () => {
      const page = await this.handlers().forms.formSubmissions(reqOf(caller), formId, {
        ...(query.status && query.status !== 'all' ? { status: query.status } : {}),
        ...(query.from !== undefined ? { from: query.from } : {}),
        ...(query.to !== undefined ? { to: query.to } : {}),
        limit: String(query.limit),
        offset: String(query.offset),
      });
      // The route above already proved the form is this caller's.
      const form = await getFormById(this.db, caller.accountId, formId);
      const config = (form?.config ?? { version: 1, steps: [] }) as EngineConfig;
      return {
        items: page.items.map((s) => ({
          id: s.id,
          completedAt: s.completedAt ?? null,
          startedAt: s.startedAt ?? null,
          partialAt: s.partialAt ?? null,
          score: s.score ?? null,
          outcome: s.completedAt != null ? outcomeOf(config, s.score ?? null, (s.data ?? {}) as Answers) : null,
          answers: answerRows(config, (s.data ?? {}) as Answers),
        })),
        total: page.total,
        limit: page.limit,
        offset: page.offset,
      };
    });
  }

  formAnalytics(caller: McpCaller, formId: string, query: AnalyticsQuery): Promise<FormAnalytics> {
    return run(async () => {
      const a = await this.handlers().analytics.formAnalytics(reqOf(caller), formId, query.from, query.to, query.timeZone);
      return {
        ...a,
        trends: a.trends ?? [],
        range: { from: a.range.from ?? null, to: a.range.to ?? null, timeZone: a.range.timeZone ?? 'UTC' },
      };
    });
  }
}
