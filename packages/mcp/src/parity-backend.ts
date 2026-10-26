/**
 * The rest of the port: every route of the public API v1 reference that the
 * first tools did not cover (folders, destinations, single responses and
 * their files, the CSV, deliveries, the Summary, the brand kit, the
 * notification emails, the integrations, the profile and the workspace
 * link). Kept in its own interface so `FormsBackend` stays readable;
 * `FormsBackend` extends it, so a host implements both.
 *
 * Same contract as the rest of the port: every method acts as `caller`, is
 * scoped to `caller.accountId`, applies the member's live role exactly as the
 * REST route does, and refuses with a `BackendError` (404 for anything
 * outside the workspace, 403 `FORBIDDEN` for a role that may not, 400 with
 * issues for a body the route refuses).
 */
import type { SubmissionFacets, SubmissionsSummary, SummaryAnswer } from '@quill/engine';
import type { FormDetail, McpCaller, ResponseItem, ResponseStatus } from './backend';

/** One folder of the workspace. */
export interface FolderItem {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
}

/** The table's filter, shared by the CSV, the Summary and the answer search. */
export interface ResponseFilter {
  status?: ResponseStatus;
  /** Start-time window: epoch ms, or `YYYY-MM-DD` for a whole day in the workspace's zone. */
  from?: string;
  to?: string;
  scoreMin?: number;
  scoreMax?: number;
  /** Choice answers to match: step key to the option values, any of which matches. */
  answers?: Record<string, string[]>;
  /** Free text looked for in what people wrote. */
  search?: string;
}

export type ResponseSort = 'newest' | 'oldest' | 'score_desc' | 'score_asc';

/** One response in full: the answers as the owner reads them, and which file questions it answered. */
export interface ResponseDetail extends ResponseItem {
  formId: string;
  /** The file questions this response answered, for `getResponseFile`. */
  files: Array<{ stepKey: string; question: string }>;
}

/** A signed, short-lived link to one uploaded file. Never the bytes. */
export interface ResponseFile {
  name: string;
  size: number;
  kind: string;
  url: string;
  /** A link that renders the file in place, when its type allows that. */
  previewUrl: string | null;
}

export interface CsvQuery extends ResponseFilter {
  sort?: ResponseSort;
  /** Only these responses. */
  ids?: string[];
  /** Keep at most this many data rows. */
  maxRows: number;
  /** Keep at most this many characters, header included. The header and the first row always stay, whatever their length. */
  maxChars: number;
}

/** The CSV the REST route streams, cut to the caps. */
export interface CsvExport {
  /** The header and the rows kept, without the byte-order mark. */
  csv: string;
  /** Data rows kept. */
  rows: number;
  /** Data rows the export holds before the caps. */
  totalRows: number;
  truncated: boolean;
}

export interface DeliveriesQuery {
  /** Delivery statuses (`done`, `pending`, `failed`, `skipped`). Default: failed and skipped, as the REST route. */
  status?: string[];
  /** Delivery kinds (`webhook`, `hubspot`, `email`, `booking_sync`). Default: every kind. */
  kind?: string[];
  limit?: number;
}

/** One side effect of a response: a webhook, a CRM sync, an email or a booking sync. */
export interface DeliveryItem {
  id: string;
  kind: string;
  status: string;
  action: string;
  lastError: string | null;
  attempts: number;
  createdAt: number;
  updatedAt: number;
  requestBody: string | null;
  responseStatus: number | null;
  responseBody: string | null;
}

export interface AnswerSearchQuery extends ResponseFilter {
  /** Matched anywhere in the answer, ignoring case. Blank lists them all. */
  q?: string;
  limit?: number;
  offset?: number;
}

export interface AnswerSearchPage {
  items: SummaryAnswer[];
  total: number;
  limit: number;
  offset: number;
}

/** A form's destinations after a write, secrets masked exactly as the REST route masks them. */
export interface DestinationsResult {
  formId: string;
  updatedAt: number;
  destinations: unknown[];
  /** Why the HubSpot form activity could not be synced; the save itself went through. */
  formActivityError: string | null;
}

/** The answer of a test delivery to the form's webhook. */
export interface WebhookPing {
  ok: boolean;
  reason?: string;
  status?: number;
  detail?: string;
}

export interface BrandKitView {
  config: Record<string, unknown> | null;
  updatedAt: number | null;
}

/** One of the workspace's forms, as the link page knows it. */
export interface LinkPageFormRef {
  id: string;
  slug: string;
  name: string;
  title: string | null;
}

/** One of the workspace's link pages and what its editor reads with it. */
export interface LinkPageView {
  /** Which page: null on a workspace with no page at all (the default page was asked for). */
  id: string | null;
  slug: string | null;
  /** The internal label; blank when nobody named the page. */
  name: string | null;
  /** The page at `/{accountCode}`; every other page lives at `/{accountCode}/p/{slug}`. */
  isDefault: boolean;
  accountCode: string;
  accountName: string;
  /**
   * The stored page as a body `updateLinkPage` takes back unchanged (a stored
   * WhatsApp number carries its `+` again), or null when there is none.
   */
  page: Record<string, unknown> | null;
  forms: LinkPageFormRef[];
  brandKit: Record<string, unknown> | null;
  /** The page's public address, or null when the deployment has none to promise. */
  publicUrl: string | null;
  /** Saved with `enabled: true`: the public address serves it. */
  live: boolean;
}

/** One page in the workspace's list. */
export interface LinkPageListItem {
  id: string;
  slug: string;
  name: string;
  isDefault: boolean;
  live: boolean;
  buttons: number;
  publicUrl: string | null;
  updatedAt: number;
}

export interface LinkPageList {
  accountCode: string;
  max: number;
  pages: LinkPageListItem[];
}

/** Which page a write is about, and what else changes on it besides the content. */
export interface LinkPageTarget {
  pageId: string;
  name?: string;
  slug?: string;
  makeDefault?: boolean;
}

/** A notification email as the Settings screen reads it. */
export type NotificationView = Record<string, unknown> & { emailKey: string };

export type NotificationKey = 'submission_received' | 'submission_confirmed';

export interface NotificationPatch {
  enabled?: boolean;
  subject?: string | null;
  body?: string | null;
  recipients?: string[] | null;
}

/** The member's public page: their handle and the page, or null when they have none. */
export interface MemberProfile {
  handle: string | null;
  profile: unknown;
}

/** The workspace's code in public links, and whether a custom one can be claimed. */
export interface VanityStatus {
  vanitySlug: string | null;
  shortCode: string;
  canClaim: boolean;
}

export interface ApiParityBackend {
  // Forms
  setFormSlug(caller: McpCaller, formId: string, slug: string): Promise<FormDetail>;
  duplicateForm(caller: McpCaller, formId: string): Promise<FormDetail>;
  moveForm(caller: McpCaller, formId: string, folderId: string | null): Promise<{ id: string; folderId: string | null }>;
  /** Deletes the form and every response of it. 404 when the form is not in the workspace. */
  deleteForm(caller: McpCaller, formId: string): Promise<{ id: string; name: string }>;

  // Folders
  listFolders(caller: McpCaller): Promise<FolderItem[]>;
  createFolder(caller: McpCaller, name: string): Promise<FolderItem>;
  renameFolder(caller: McpCaller, folderId: string, name: string): Promise<FolderItem>;
  /** Unfiles the folder's forms and deletes the folder. 404 when it is not in the workspace. */
  deleteFolder(caller: McpCaller, folderId: string): Promise<FolderItem>;

  // Destinations
  setDestinations(caller: McpCaller, formId: string, destinations: unknown[]): Promise<DestinationsResult>;
  pingWebhook(caller: McpCaller, formId: string): Promise<WebhookPing>;

  // Responses
  getResponse(caller: McpCaller, formId: string, responseId: string): Promise<ResponseDetail>;
  getResponseFile(caller: McpCaller, formId: string, responseId: string, stepKey: string): Promise<ResponseFile>;
  exportResponsesCsv(caller: McpCaller, formId: string, query: CsvQuery): Promise<CsvExport>;
  deleteResponses(caller: McpCaller, formId: string, responseIds: string[]): Promise<{ deleted: number }>;
  /** 404 when the response is not one of this form's in the workspace. */
  deleteResponse(caller: McpCaller, formId: string, responseId: string): Promise<void>;
  listDeliveries(caller: McpCaller, formId: string, query: DeliveriesQuery): Promise<DeliveryItem[]>;

  // Analytics
  formSummary(caller: McpCaller, formId: string, filter: ResponseFilter): Promise<SubmissionsSummary>;
  responseFacets(caller: McpCaller, formId: string): Promise<SubmissionFacets>;
  searchAnswers(caller: McpCaller, formId: string, stepKey: string, query: AnswerSearchQuery): Promise<AnswerSearchPage>;

  // Brand kit
  getBrandKit(caller: McpCaller): Promise<BrandKitView>;
  updateBrandKit(caller: McpCaller, kit: Record<string, unknown>): Promise<BrandKitView>;
  applyBrandKit(caller: McpCaller, formIds: string[]): Promise<{ applied: string[] }>;
  revertBrandKit(caller: McpCaller, formIds: string[]): Promise<{ reverted: string[] }>;

  // Link pages (any member, as the REST routes)
  /** The default page, or the page `pageId` names (404 `PAGE_NOT_FOUND` when it is not this workspace's). */
  getLinkPage(caller: McpCaller, pageId?: string): Promise<LinkPageView>;
  /**
   * Without `target`: replaces the whole DEFAULT page; null deletes it. With
   * `target`: changes that page (its content when `page` is an object, and
   * its name, slug or default flag). A form button naming a form the
   * workspace does not have is a 404, not a silent drop; an unknown page is
   * a 404 `PAGE_NOT_FOUND`.
   */
  updateLinkPage(caller: McpCaller, page: Record<string, unknown> | null | undefined, target?: LinkPageTarget): Promise<LinkPageView>;
  listLinkPages(caller: McpCaller): Promise<LinkPageList>;
  createLinkPage(caller: McpCaller, input: { name?: string; slug?: string; page?: Record<string, unknown> }): Promise<LinkPageView>;
  duplicateLinkPage(caller: McpCaller, pageId: string, input: { name?: string; slug?: string }): Promise<LinkPageView>;
  /** 409 `DEFAULT_PAGE` for the default page. */
  deleteLinkPage(caller: McpCaller, pageId: string): Promise<{ id: string; slug: string }>;

  // Notifications
  listNotifications(caller: McpCaller): Promise<NotificationView[]>;
  updateNotification(caller: McpCaller, key: NotificationKey, patch: NotificationPatch): Promise<NotificationView>;
  resetNotification(caller: McpCaller, key: NotificationKey): Promise<NotificationView>;
  listFormNotifications(caller: McpCaller, formId: string): Promise<NotificationView[]>;
  updateFormNotification(caller: McpCaller, formId: string, key: NotificationKey, patch: NotificationPatch): Promise<NotificationView>;
  resetFormNotification(caller: McpCaller, formId: string, key: NotificationKey): Promise<NotificationView>;

  // Integrations, read only
  listIntegrations(caller: McpCaller): Promise<Record<string, unknown>>;
  listWebhooks(caller: McpCaller): Promise<Array<Record<string, unknown>>>;
  hubspotProperties(caller: McpCaller): Promise<Record<string, unknown>>;
  calendlyEventTypes(caller: McpCaller): Promise<Record<string, unknown>>;

  // Identity
  myProfile(caller: McpCaller): Promise<MemberProfile>;
  vanity(caller: McpCaller): Promise<VanityStatus>;
}
