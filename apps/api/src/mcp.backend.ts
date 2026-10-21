import { HttpException } from '@nestjs/common';
import { findApiKeyPrincipal, getFormById, type Db } from '@quill/db';
import { summarizeAnswers, type Answers, type FormConfig as EngineConfig } from '@quill/engine';
import {
  BackendError,
  type AnalyticsQuery,
  type CreateFormInput,
  type FormAnalytics,
  type FormDetail,
  type FormListItem,
  type FormsBackend,
  type McpCaller,
  type ResponsesPage,
  type ResponsesQuery,
  type UpdateFormInput,
  type WhoAmI,
} from '@quill/mcp';
import type { AdminCrudController } from './admin-crud.controller';
import type { AnalyticsController } from './analytics.controller';
import { API_KEY_PREFIX, hashApiKey, markMcpRequest } from './api-keys';
import { isKeyAllowedRoute, routeOf } from './api-key-routes';
import type { ReqLike } from './auth.provider';

/**
 * forms-api's side of the MCP port (`FormsBackend` in `@quill/mcp`).
 *
 * Every tool call runs the SAME handler the REST route runs, in process, with
 * a request that carries the caller's own API key. So nothing here re-states
 * a rule: the handler resolves the key on every call (a key revoked, or a
 * member removed, mid-session stops working at once), counts it against the
 * key's 120 calls a minute, scopes every read and write to the key's
 * workspace, applies the member's role, the strict API-key validation, the
 * config normalization and the brand kit, emits the product events, and adds
 * `publicUrl` and `editorUrl`. There is no second implementation to drift.
 *
 * The request is marked as coming from the MCP (`markMcpRequest`), so a form it
 * creates records `created_via = 'mcp'`. It never carries an
 * `x-quill-workspace` header: the workspace is always the key's.
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
  const row = await findApiKeyPrincipal(db, hashApiKey(token));
  if (!row || row.memberStatus !== 'active') return null;
  const context: ApiCallerContext = {
    req: markMcpRequest({ headers: { authorization: `Bearer ${token}` } }),
  };
  return {
    accountId: row.accountId,
    memberId: row.memberId,
    role: row.role,
    credentialId: row.keyId,
    // The stored, displayed prefix of the key (see `generateApiKey`).
    label: token.slice(0, 12),
    context,
  };
}

function reqOf(caller: McpCaller): ReqLike {
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

async function run<T>(work: () => Promise<T>): Promise<T> {
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

function detailOf(f: FormViewLike): FormDetail {
  return {
    ...listItemOf(f),
    config: f.config ?? null,
    draftConfig: f.draftConfig ?? null,
    publishedAt: f.publishedAt ?? null,
    previousPublishedAt: f.previousPublishedAt ?? null,
  };
}

export class ApiFormsBackend implements FormsBackend {
  constructor(
    private readonly db: Db,
    private readonly handlers: () => McpHandlers,
  ) {}

  whoami(caller: McpCaller): Promise<WhoAmI> {
    return run(async () => {
      const me = await this.handlers().forms.me(reqOf(caller));
      if (!me) throw new BackendError(401, 'INVALID_API_KEY', 'This API key is not valid.');
      return {
        accountId: me.accountId,
        accountName: me.accountName,
        accountCode: me.accountCode,
        memberId: me.memberId,
        displayName: me.displayName,
        email: me.email,
        role: me.role,
        timezone: me.timezone,
      };
    });
  }

  listForms(caller: McpCaller): Promise<FormListItem[]> {
    return run(async () => (await this.handlers().forms.listForms(reqOf(caller))).map(listItemOf));
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

  /**
   * A page through the submissions route (key resolution, account scope and
   * filters exactly as the table), then each response's answers rendered as
   * the owner reads them: the question as the respondent saw it and the
   * answer with option labels, by the same engine function the notification
   * emails use. Steps the live form no longer has are left out, as in the table.
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
          answers: summarizeAnswers(config, (s.data ?? {}) as Answers).map((row) => ({
            question: row.label,
            answer: row.value,
          })),
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
