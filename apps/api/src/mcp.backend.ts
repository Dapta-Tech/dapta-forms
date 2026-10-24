import { createHash } from 'node:crypto';
import { HttpException, Logger } from '@nestjs/common';
import {
  findApiKeyPrincipal,
  getFormById,
  listLiveStepCounts,
  membershipsBySubject,
  staffGrantsBySubject,
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
import { STAFF_GRANT_MAX_AGE_MS } from './staff';

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

/** The default link window (`OAUTH_LINK_MAX_AGE_DAYS`, 30 days). */
const DEFAULT_LINK_MAX_AGE_MS = 30 * 86_400_000;

/**
 * The connection of a verified sign-in that reaches no workspace yet. It
 * connects, so the chat app shows the person the next step instead of a
 * failed login (a 403 on `initialize` reaches people as the app's own error,
 * "Automatic client registration isn't supported", never as our words). It
 * acts nowhere: every tool that reads a workspace answers NO_WORKSPACE, and
 * `whoami` and `list_my_workspaces` say to open dForms once on the web. The
 * server keeps nothing between requests, so the first request after that
 * visit already acts in the person's workspaces, with no new login.
 *
 * It names nobody: `personId` is a digest of the subject, so the rate-limit
 * bucket stays per sign-in and no log line or analytics event carries the
 * subject itself.
 */
function notLinkedYet(subject: string): McpConnection {
  const personId = `unlinked:${createHash('sha256').update(subject, 'utf8').digest('hex').slice(0, 24)}`;
  return { personId, email: null, label: `oauth:${personId}`, workspaces: [] };
}

/**
 * Resolve an access token to an MCP connection: the person it signs in, with
 * one caller per workspace where they may act (each acting as that member
 * through its own in-process principal). Null when the token does not verify
 * (a 401 that points at the login again), and `DoorUnavailable` (a 503) while
 * the identity provider's keys cannot be read.
 *
 * The token's subject maps to members here, in dForms' own database, the way
 * the sibling calendars product does it (`membershipsBySubject`): the members
 * whose verified web login recorded that subject, and the same person's
 * members in other workspaces, each only while a verified web request vouched
 * for it within the link window (`OAUTH_LINK_MAX_AGE_DAYS`). Any active role
 * connects; every tool call then applies that member's live role, as on the
 * web. dForms reads no identity database and holds no credential for one: the
 * link exists because the person uses the web app, and it lapses when they
 * stop, the way their web access would.
 *
 * Staff of the deployment also reach the customer workspaces they opened on
 * the web through a staff access grant within `STAFF_GRANT_MAX_AGE_MS` (a
 * day), on a request that proved them staff (`staffGrantsBySubject`), and
 * only next to an active membership of their own. Those workspaces say
 * `access: 'staff'`, are never used without being named, and are audited as
 * staff calls. There is no search over other workspaces from a sign-in:
 * staff open a customer's workspace on the web first (docs/adr/0003).
 *
 * A token that verifies but reaches nothing connects with no workspace, and
 * its tools say to open dForms on the web (`notLinkedYet`). A subject that
 * names more than one person is a `DoorRefusal` (403), never resolved by
 * guessing. Nothing is matched by email.
 *
 * Like a key, this is a lookup only, done again on every request: every tool
 * call re-reads its member through `AuthService.resolveHost`, so a member
 * disabled, removed or demoted after this point is seen on the call itself.
 */
export async function authenticateMcpConnection(
  db: Db,
  oauth: McpOAuth,
  token: string,
  opts: McpConnectionOptions = {},
): Promise<McpConnection | null> {
  const log = opts.log ?? defaultConnectionLog;
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
  const now = opts.now?.() ?? Date.now();
  const linkMaxAgeMs = opts.linkMaxAgeMs ?? DEFAULT_LINK_MAX_AGE_MS;
  const linkSince = now - linkMaxAgeMs;
  const [rows, grants] = await Promise.all([
    membershipsBySubject(db, access.subject, linkSince),
    staffGrantsBySubject(db, access.subject, linkSince, now - STAFF_GRANT_MAX_AGE_MS),
  ]);
  // The reason only, never the subject or the token.
  if (new Set([...rows, ...grants].map((r) => r.externalId)).size > 1) {
    log(JSON.stringify({ msg: 'mcp.oauth_refused', reason: 'ambiguous' }));
    throw new DoorRefusal('This sign-in matches more than one dForms account, so dForms will not guess which one it is. Contact support; do not retry.');
  }
  const active = rows.filter((r) => r.status === 'active');
  // Grants only next to an active membership of the person's own (a person
  // whose own memberships are all disabled reaches no customer either), and a
  // workspace the person is a member of is always entered as that member.
  const own = new Set(active.map((m) => m.accountId));
  const throughGrant = active.length > 0 ? grants.filter((g) => !own.has(g.accountId)) : [];
  const first = active[0];
  if (!first) {
    const reason = rows.length === 0 && grants.length === 0 ? 'not_linked' : 'no_active_membership';
    log(JSON.stringify({ msg: 'mcp.oauth_no_workspace', reason }));
    return notLinkedYet(access.subject);
  }
  const person: Person = { id: first.externalId, email: first.email };
  const label = `oauth:${person.id}`;
  const workspaces = [
    ...active.map((m) => memberCaller(person, label, { accountId: m.accountId, accountName: m.accountName, memberId: m.memberId, role: m.role })),
    ...throughGrant.map((g) =>
      memberCaller(person, label, { accountId: g.accountId, accountName: g.accountName, memberId: g.memberId, role: g.role }, 'staff'),
    ),
  ];
  return { personId: person.id, email: person.email, label, workspaces };
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
  /** How long after a verified web login a member stays reachable (`OAUTH_LINK_MAX_AGE_DAYS`); 30 days when unset. */
  linkMaxAgeMs?: number;
  /** Where a sign-in that reaches no workspace, or is refused, is logged: one JSON line each. */
  log?: (line: string) => void;
  /** The clock (specs). */
  now?: () => number;
}

const connectionLogger = new Logger('McpOAuth');
const defaultConnectionLog = (line: string): void => connectionLogger.log(line);

/** The person an MCP sign-in acts as: their upstream user id and the email their member carries. */
interface Person {
  id: string;
  email: string | null;
}

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
