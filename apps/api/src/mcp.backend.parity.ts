import { HttpException } from '@nestjs/common';
import { getFormById, type Db } from '@quill/db';
import { linkPageToInput } from '@quill/types';
import {
  type Answers,
  type FormConfig as EngineConfig,
  type SubmissionFacets,
  type SubmissionsSummary,
} from '@quill/engine';
import {
  BackendError,
  type AnswerSearchPage,
  type AnswerSearchQuery,
  type BrandKitView,
  type CsvExport,
  type CsvQuery,
  type DeliveriesQuery,
  type DeliveryItem,
  type DestinationsResult,
  type FolderItem,
  type FormDetail,
  type FormsBackend,
  type LinkPageList,
  type LinkPageTarget,
  type LinkPageView,
  type McpCaller,
  type MemberProfile,
  type NotificationKey,
  type NotificationPatch,
  type NotificationView,
  type ResponseDetail,
  type ResponseFile,
  type ResponseFilter,
  type VanityStatus,
  type WebhookPing,
} from '@quill/mcp';
import type { AdminCrudController } from './admin-crud.controller';
import type { AnalyticsController } from './analytics.controller';
import type { BrandingController } from './branding.controller';
import type { FormDestinationsController, IntegrationsController } from './integrations.controller';
import type { LinkPageController } from './link-page.controller';
import { callRequest } from './in-process-principal';
import { ApiFormsBackend, answerRows, detailOf, outcomeOf, reqOf, run, type McpHandlers } from './mcp.backend';
import type { FilterQuery } from './submission-filter';

/**
 * forms-api's side of the rest of the MCP port (`ApiParityBackend` in
 * `@quill/mcp`): one method per route of the public API reference that the
 * first tools did not cover.
 *
 * Same rule as `ApiFormsBackend`: every method runs the handler the REST
 * route runs, in process, on the caller's in-process request, so the route's
 * principal resolution, account scope, role check (`assertAdmin` where the
 * route has it), validation, secret masking and product events all apply,
 * with nothing restated here. Where a route answers 204 for an id it cannot
 * see (deleting a form, a folder or a response), the method first reads it
 * through the matching read route, so the agent hears NOT_FOUND instead of a
 * success that did nothing. Such a method runs both handlers on one
 * `callRequest`, so the principal is resolved, and an API key counted, once
 * per tool call.
 */

/**
 * A link page route's answer, with its 404 renamed `PAGE_NOT_FOUND`, so the
 * tool can tell "no such page" from "no such form" in the page's buttons.
 */
async function pageOrMissing<T>(work: Promise<T>): Promise<T> {
  try {
    return await work;
  } catch (err) {
    if (err instanceof HttpException && err.getStatus() === 404) throw new BackendError(404, 'PAGE_NOT_FOUND', 'Not found.');
    throw err;
  }
}

/** Every handler the parity tools call, by controller. Each is checked against the API-key allowlist at boot. */
export const MCP_PARITY_HANDLERS = {
  forms: [
    'getForm',
    'updateFormSlug',
    'duplicateForm',
    'setFormFolder',
    'deleteForm',
    'listFolders',
    'createFolder',
    'renameFolder',
    'deleteFolder',
    'submissionFile',
    'formDeliveries',
    'notifications',
    'updateNotification',
    'resetNotification',
    'formNotifications',
    'updateFormNotification',
    'resetFormNotification',
    'myProfile',
    'vanity',
  ],
  analytics: ['submission', 'exportCsv', 'deleteSubmission', 'deleteSubmissions', 'formSummary', 'submissionFacets', 'summaryAnswers'],
  destinations: ['putDestinations', 'pingWebhook'],
  branding: ['get', 'put', 'apply', 'revert'],
  linkPage: ['get', 'put', 'list', 'create', 'one', 'update', 'remove', 'duplicate'],
  integrations: ['list', 'webhooks', 'hubspotProperties', 'calendlyEventTypes'],
} as const;

type Names<K extends keyof typeof MCP_PARITY_HANDLERS> = (typeof MCP_PARITY_HANDLERS)[K][number];

/** The handlers the parity methods call. The controllers themselves in the app; fakes in a spec. */
export interface McpParityHandlers {
  forms: Pick<AdminCrudController, Names<'forms'>>;
  /**
   * Plus `exportCsvFirst`, the CSV route's handler cut to the first rows. It
   * has no route of its own; it runs the route's checks, and the route it
   * stands for (`exportCsv`, listed above) is the one checked at boot.
   */
  analytics: Pick<AnalyticsController, Names<'analytics'> | 'exportCsvFirst'>;
  destinations: Pick<FormDestinationsController, Names<'destinations'>>;
  branding: Pick<BrandingController, Names<'branding'>>;
  linkPage: Pick<LinkPageController, Names<'linkPage'>>;
  integrations: Pick<IntegrationsController, Names<'integrations'>>;
}

/** The response filter as the REST routes read their query string. */
function filterQuery(f: ResponseFilter): FilterQuery {
  return {
    ...(f.status && f.status !== 'all' ? { status: f.status } : {}),
    ...(f.from !== undefined ? { from: f.from } : {}),
    ...(f.to !== undefined ? { to: f.to } : {}),
    ...(f.scoreMin !== undefined ? { scoreMin: String(f.scoreMin) } : {}),
    ...(f.scoreMax !== undefined ? { scoreMax: String(f.scoreMax) } : {}),
    ...(f.answers !== undefined ? { answers: JSON.stringify(f.answers) } : {}),
    ...(f.search !== undefined ? { search: f.search } : {}),
  };
}

/**
 * The CSV an agent gets: the header, then the rows in order while the whole
 * text, header included, stays within `maxChars`. The first row always comes
 * back, however long: a single response past the cap must not make every
 * export of it come back empty. The rows kept are always the first ones,
 * never a set with a gap.
 */
export function cutCsv(header: string, lines: readonly string[], total: number, maxChars: number): CsvExport {
  const kept: string[] = [];
  let chars = header.length;
  for (const line of lines) {
    if (kept.length > 0 && chars + line.length > maxChars) break;
    kept.push(line);
    chars += line.length;
  }
  const csv = `${header}${kept.join('')}`.replace(/\r?\n$/, '');
  return { csv, rows: kept.length, totalRows: total, truncated: kept.length < total };
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

export class ApiMcpBackend extends ApiFormsBackend implements FormsBackend {
  constructor(
    private readonly database: Db,
    handlers: () => McpHandlers,
    private readonly parity: () => McpParityHandlers,
  ) {
    super(database, handlers);
  }

  // --- Forms ------------------------------------------------------------------

  setFormSlug(caller: McpCaller, formId: string, slug: string): Promise<FormDetail> {
    return run(async () => detailOf(await this.parity().forms.updateFormSlug(reqOf(caller), formId, { slug })));
  }

  duplicateForm(caller: McpCaller, formId: string): Promise<FormDetail> {
    return run(async () => detailOf(await this.parity().forms.duplicateForm(reqOf(caller), formId)));
  }

  moveForm(caller: McpCaller, formId: string, folderId: string | null) {
    return run(async () => {
      const out = await this.parity().forms.setFormFolder(reqOf(caller), formId, { folderId });
      return { id: out.id, folderId: out.folderId ?? null };
    });
  }

  deleteForm(caller: McpCaller, formId: string) {
    return run(async () => {
      const req = callRequest(reqOf(caller));
      const form = await this.parity().forms.getForm(req, formId);
      await this.parity().forms.deleteForm(req, formId);
      return { id: form.id, name: form.name };
    });
  }

  // --- Folders ----------------------------------------------------------------

  listFolders(caller: McpCaller): Promise<FolderItem[]> {
    return run(() => this.parity().forms.listFolders(reqOf(caller)));
  }

  createFolder(caller: McpCaller, name: string): Promise<FolderItem> {
    return run(() => this.parity().forms.createFolder(reqOf(caller), { name }));
  }

  renameFolder(caller: McpCaller, folderId: string, name: string): Promise<FolderItem> {
    return run(() => this.parity().forms.renameFolder(reqOf(caller), folderId, { name }));
  }

  deleteFolder(caller: McpCaller, folderId: string): Promise<FolderItem> {
    return run(async () => {
      const req = callRequest(reqOf(caller));
      const folder = (await this.parity().forms.listFolders(req)).find((f) => f.id === folderId);
      if (!folder) throw new BackendError(404, 'NOT_FOUND', 'Not found.');
      await this.parity().forms.deleteFolder(req, folderId);
      return folder;
    });
  }

  // --- Destinations -----------------------------------------------------------

  setDestinations(caller: McpCaller, formId: string, destinations: unknown[]): Promise<DestinationsResult> {
    return run(async () => {
      const out = await this.parity().destinations.putDestinations(reqOf(caller), formId, { destinations });
      const config = isRecord(out.config) ? out.config : {};
      return {
        formId: out.id,
        updatedAt: out.updatedAt,
        destinations: Array.isArray(config.destinations) ? config.destinations : [],
        formActivityError: typeof out.formActivityError === 'string' ? out.formActivityError : null,
      };
    });
  }

  pingWebhook(caller: McpCaller, formId: string): Promise<WebhookPing> {
    return run(async () => {
      // The adapter's raw `message` is for the log, not for a model.
      const { ok, reason, status, detail } = await this.parity().destinations.pingWebhook(reqOf(caller), formId);
      return { ok, ...(reason ? { reason } : {}), ...(status !== undefined ? { status } : {}), ...(detail ? { detail } : {}) };
    });
  }

  // --- Responses --------------------------------------------------------------

  /**
   * One submission through its route (account join, and it must belong to
   * the form), in the shape `listResponses` gives each item: the answers as
   * the owner reads them with their step (`answerRows`, so an answer to a
   * step deleted since is kept and marked), a completed response's outcome by
   * the live config, and the file questions it answered.
   */
  getResponse(caller: McpCaller, formId: string, responseId: string): Promise<ResponseDetail> {
    return run(async () => {
      const s = await this.parity().analytics.submission(reqOf(caller), formId, responseId);
      // The route above already proved the form is this caller's.
      const form = await getFormById(this.database, caller.accountId, formId);
      const config = (form?.config ?? { version: 1, steps: [] }) as EngineConfig;
      const data = (s.data ?? {}) as Answers;
      return {
        id: s.id,
        formId: s.formId,
        completedAt: s.completedAt ?? null,
        startedAt: s.startedAt ?? null,
        partialAt: s.partialAt ?? null,
        score: s.score ?? null,
        outcome: s.completedAt != null ? outcomeOf(config, s.score ?? null, data) : null,
        answers: answerRows(config, data),
        files: (config.steps ?? [])
          .filter((step) => step.type === 'file' && data[step.key] != null && data[step.key] !== '')
          .map((step) => ({ stepKey: step.key, question: step.question || step.key })),
      };
    });
  }

  getResponseFile(caller: McpCaller, formId: string, responseId: string, stepKey: string): Promise<ResponseFile> {
    return run(async () => {
      const req = callRequest(reqOf(caller));
      // The file route reads the response by account alone; the form must match too.
      await this.parity().analytics.submission(req, formId, responseId);
      const f = await this.parity().forms.submissionFile(req, responseId, stepKey);
      return { name: f.name, size: Number(f.size), kind: f.kind, url: f.url, previewUrl: f.previewUrl ?? null };
    });
  }

  /**
   * The CSV route's own file (`exportCsvFirst`: its principal, scope,
   * validation, columns and cell encoding), reading only the first
   * `maxRows` rows, then cut to `maxChars`.
   */
  exportResponsesCsv(caller: McpCaller, formId: string, query: CsvQuery): Promise<CsvExport> {
    return run(async () => {
      const out = await this.parity().analytics.exportCsvFirst(
        reqOf(caller),
        formId,
        { ...filterQuery(query), ...(query.sort ? { sort: query.sort } : {}) },
        query.ids ? query.ids.join(',') : undefined,
        query.maxRows,
      );
      return cutCsv(out.header, out.rows, out.total, query.maxChars);
    });
  }

  deleteResponses(caller: McpCaller, formId: string, responseIds: string[]) {
    return run(() => this.parity().analytics.deleteSubmissions(reqOf(caller), formId, { ids: responseIds }));
  }

  deleteResponse(caller: McpCaller, formId: string, responseId: string): Promise<void> {
    return run(async () => {
      const req = callRequest(reqOf(caller));
      await this.parity().analytics.submission(req, formId, responseId);
      await this.parity().analytics.deleteSubmission(req, responseId);
    });
  }

  listDeliveries(caller: McpCaller, formId: string, query: DeliveriesQuery): Promise<DeliveryItem[]> {
    return run(async () => {
      const out = await this.parity().forms.formDeliveries(
        reqOf(caller),
        formId,
        query.limit !== undefined ? String(query.limit) : undefined,
        query.kind?.join(','),
        query.status?.join(','),
      );
      return out.items;
    });
  }

  // --- Analytics --------------------------------------------------------------

  formSummary(caller: McpCaller, formId: string, filter: ResponseFilter): Promise<SubmissionsSummary> {
    return run(() => this.parity().analytics.formSummary(reqOf(caller), formId, filterQuery(filter)));
  }

  responseFacets(caller: McpCaller, formId: string): Promise<SubmissionFacets> {
    return run(() => this.parity().analytics.submissionFacets(reqOf(caller), formId));
  }

  searchAnswers(caller: McpCaller, formId: string, stepKey: string, query: AnswerSearchQuery): Promise<AnswerSearchPage> {
    return run(() =>
      this.parity().analytics.summaryAnswers(
        reqOf(caller),
        formId,
        stepKey,
        filterQuery(query),
        query.q,
        query.limit !== undefined ? String(query.limit) : undefined,
        query.offset !== undefined ? String(query.offset) : undefined,
      ),
    );
  }

  // --- Brand kit --------------------------------------------------------------

  getBrandKit(caller: McpCaller): Promise<BrandKitView> {
    return run(async () => this.kit(await this.parity().branding.get(reqOf(caller))));
  }

  updateBrandKit(caller: McpCaller, kit: Record<string, unknown>): Promise<BrandKitView> {
    return run(async () => this.kit(await this.parity().branding.put(reqOf(caller), kit)));
  }

  applyBrandKit(caller: McpCaller, formIds: string[]) {
    return run(() => this.parity().branding.apply(reqOf(caller), { formIds }));
  }

  revertBrandKit(caller: McpCaller, formIds: string[]) {
    return run(() => this.parity().branding.revert(reqOf(caller), { formIds }));
  }

  // --- Link page --------------------------------------------------------------

  getLinkPage(caller: McpCaller, pageId?: string): Promise<LinkPageView> {
    return run(async () =>
      this.linkPageView(
        pageId === undefined
          ? await this.parity().linkPage.get(reqOf(caller))
          : await pageOrMissing(this.parity().linkPage.one(reqOf(caller), pageId)),
      ),
    );
  }

  /** Every form id of the page's buttons must be the workspace's own: NOT_FOUND names the form, before anything is written. */
  private assertOwnForms(page: Record<string, unknown> | null | undefined, forms: { id: string }[]): void {
    const own = new Set(forms.map((f) => f.id));
    const items = Array.isArray(page?.items) ? (page.items as unknown[]) : [];
    for (const item of items) {
      if (isRecord(item) && item.type === 'form' && typeof item.formId === 'string' && !own.has(item.formId.trim())) {
        throw new BackendError(404, 'NOT_FOUND', 'Not found.');
      }
    }
  }

  /**
   * The route drops a form button naming a form the workspace does not have,
   * and answers 200. An agent hears NOT_FOUND instead: the page is read
   * first (the same handler as `getLinkPage`, on the same `callRequest`, so
   * one tool call is one key call) and every form id is checked against the
   * workspace's forms before anything is written.
   *
   * Without `target` this is `PUT /v1/link-page` (the default page); with it,
   * `PUT /v1/link-pages/:id`, and an unknown page is `PAGE_NOT_FOUND`.
   */
  updateLinkPage(
    caller: McpCaller,
    page: Record<string, unknown> | null | undefined,
    target?: LinkPageTarget,
  ): Promise<LinkPageView> {
    return run(async () => {
      const req = callRequest(reqOf(caller));
      if (!target) {
        const before = this.linkPageView(await this.parity().linkPage.get(req));
        this.assertOwnForms(page, before.forms);
        const out = await this.parity().linkPage.put(req, { page: page ?? null });
        if (!out.page) return { ...before, page: null, live: false };
        // A first save creates the page: read it back for its id and slug.
        return this.linkPageView(await this.parity().linkPage.get(req));
      }
      const before = this.linkPageView(await pageOrMissing(this.parity().linkPage.one(req, target.pageId)));
      this.assertOwnForms(page, before.forms);
      const body = {
        ...(target.name !== undefined ? { name: target.name } : {}),
        ...(target.slug !== undefined ? { slug: target.slug } : {}),
        ...(target.makeDefault ? { isDefault: true } : {}),
        ...(page ? { page } : {}),
      };
      return this.linkPageView(await this.parity().linkPage.update(req, target.pageId, body));
    });
  }

  listLinkPages(caller: McpCaller): Promise<LinkPageList> {
    return run(async () => {
      const l = await this.parity().linkPage.list(reqOf(caller));
      return {
        accountCode: l.accountCode,
        max: l.max,
        pages: l.pages.map((p) => ({
          id: p.id,
          slug: p.slug,
          name: p.name,
          isDefault: p.isDefault,
          live: p.live,
          buttons: p.buttons,
          publicUrl: p.publicUrl,
          updatedAt: p.updatedAt,
        })),
      };
    });
  }

  createLinkPage(caller: McpCaller, input: { name?: string; slug?: string; page?: Record<string, unknown> }): Promise<LinkPageView> {
    return run(async () => {
      const req = callRequest(reqOf(caller));
      if (input.page) this.assertOwnForms(input.page, (await this.parity().linkPage.get(req)).forms);
      return this.linkPageView(await this.parity().linkPage.create(req, input));
    });
  }

  duplicateLinkPage(caller: McpCaller, pageId: string, input: { name?: string; slug?: string }): Promise<LinkPageView> {
    return run(async () => this.linkPageView(await pageOrMissing(this.parity().linkPage.duplicate(reqOf(caller), pageId, input))));
  }

  deleteLinkPage(caller: McpCaller, pageId: string): Promise<{ id: string; slug: string }> {
    return run(async () => {
      const out = await pageOrMissing(this.parity().linkPage.remove(reqOf(caller), pageId));
      return { id: out.id, slug: out.slug };
    });
  }

  // --- Notifications ----------------------------------------------------------

  listNotifications(caller: McpCaller): Promise<NotificationView[]> {
    return run(async () => (await this.parity().forms.notifications(reqOf(caller))).settings);
  }

  updateNotification(caller: McpCaller, key: NotificationKey, patch: NotificationPatch): Promise<NotificationView> {
    return run(() => this.parity().forms.updateNotification(reqOf(caller), key, patch));
  }

  resetNotification(caller: McpCaller, key: NotificationKey): Promise<NotificationView> {
    return run(() => this.parity().forms.resetNotification(reqOf(caller), key));
  }

  listFormNotifications(caller: McpCaller, formId: string): Promise<NotificationView[]> {
    return run(async () => (await this.parity().forms.formNotifications(reqOf(caller), formId)).settings);
  }

  updateFormNotification(caller: McpCaller, formId: string, key: NotificationKey, patch: NotificationPatch): Promise<NotificationView> {
    return run(() => this.parity().forms.updateFormNotification(reqOf(caller), formId, key, patch));
  }

  resetFormNotification(caller: McpCaller, formId: string, key: NotificationKey): Promise<NotificationView> {
    return run(() => this.parity().forms.resetFormNotification(reqOf(caller), formId, key));
  }

  // --- Integrations, read only ------------------------------------------------

  listIntegrations(caller: McpCaller): Promise<Record<string, unknown>> {
    return run(async () => ({ ...(await this.parity().integrations.list(reqOf(caller))) }));
  }

  listWebhooks(caller: McpCaller): Promise<Array<Record<string, unknown>>> {
    return run(async () => (await this.parity().integrations.webhooks(reqOf(caller))).items.map((w) => ({ ...w })));
  }

  hubspotProperties(caller: McpCaller): Promise<Record<string, unknown>> {
    return run(async () => ({ ...(await this.parity().integrations.hubspotProperties(reqOf(caller))) }));
  }

  calendlyEventTypes(caller: McpCaller): Promise<Record<string, unknown>> {
    return run(async () => ({ ...(await this.parity().integrations.calendlyEventTypes(reqOf(caller))) }));
  }

  // --- Identity ---------------------------------------------------------------

  myProfile(caller: McpCaller): Promise<MemberProfile> {
    return run(async () => {
      const p = await this.parity().forms.myProfile(reqOf(caller));
      return { handle: p.handle ?? null, profile: p.profile ?? null };
    });
  }

  vanity(caller: McpCaller): Promise<VanityStatus> {
    return run(() => this.parity().forms.vanity(reqOf(caller)));
  }

  // --- Shapes -----------------------------------------------------------------

  /** The route's answer, with a stored page put back in the shape the write takes (WhatsApp with its `+`). */
  private linkPageView(v: Awaited<ReturnType<LinkPageController['get']>>): LinkPageView {
    return {
      id: v.id,
      slug: v.slug,
      name: v.name,
      isDefault: v.isDefault,
      accountCode: v.accountCode,
      accountName: v.accountName,
      page: v.page ? (linkPageToInput(v.page) as Record<string, unknown>) : null,
      forms: v.forms.map((f) => ({ id: f.id, slug: f.slug, name: f.name, title: f.title ?? null })),
      brandKit: isRecord(v.brandKit) ? v.brandKit : null,
      publicUrl: v.publicUrl,
      live: v.live,
    };
  }

  private kit(v: { config: unknown; updatedAt: number | null }): BrandKitView {
    return { config: isRecord(v.config) ? v.config : null, updatedAt: v.updatedAt ?? null };
  }
}
