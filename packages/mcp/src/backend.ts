/**
 * The port between the MCP tools and the app that hosts them.
 *
 * The tools never touch a database or an HTTP route: they call a
 * `FormsBackend`, and the host (forms-api) implements it on top of its own
 * handlers, so every rule a form write is held to on the web (validation, the
 * stricter API-key rules, the member's role, the brand kit, the account scope)
 * applies to an agent exactly the same way. A fork can host the tools on any
 * backend that satisfies this interface.
 *
 * The caller's identity reaches the backend as an opaque `McpCaller.context`:
 * whatever the host's authenticator put there (forms-api: what it needs to act
 * as one member in one workspace). The package never reads it, logs it or
 * returns it.
 *
 * Two kinds of credential reach the door. An API key is an `McpCaller`: one
 * member in one workspace, fixed by the key. An MCP connection (a person
 * signed in through OAuth) is an `McpConnection`: a person with one
 * `McpCaller` per workspace where they hold an active member, and each tool
 * call names the one it acts in. Staff of the deployment may also name any
 * other workspace (`McpConnection.staff`).
 */

import type { ApiParityBackend } from './parity-backend';

/** One member in one workspace: who a tool call acts as. */
export interface McpCaller {
  /** The workspace every call acts in. Always from the credential, never from an argument. */
  accountId: string;
  /** That workspace's name, as its members see it. Every result names the workspace it acted in. */
  workspaceName: string;
  /** The member the credential acts as. */
  memberId: string;
  /** That member's role in the workspace (`owner`, `admin`, `member`). */
  role: string;
  /**
   * Stable id of the rate-limit bucket: the API key's id, or for an MCP
   * connection its member (so one person's clients share one budget).
   */
  credentialId: string;
  /**
   * The credential's public label: the key prefix (`dforms_ab12c`), or for an
   * MCP connection the person it signed in as. Never a secret: it reaches logs.
   */
  label: string;
  /**
   * The person an MCP connection signed in as, in the terms members are keyed
   * by. Absent for an API key.
   */
  personId?: string;
  /**
   * How the person reaches this workspace: `staff` through a staff access
   * grant (staff of the deployment, not a member there), `member` (or absent)
   * as a member. Results and the audit line say so.
   */
  access?: 'member' | 'staff';
  /** Host-defined, opaque to this package: how the backend acts as this caller. */
  context: unknown;
}

/** What a staff search matched a workspace on. */
export type WorkspaceMatch = 'name' | 'account_name' | 'member_email' | 'form_name';

/** One workspace a staff search found. */
export interface StaffWorkspaceHit {
  /**
   * What a call passes as `workspace_id`: one id per workspace, the same
   * before and after the host first uses it (forms-api: the identity
   * service's workspace id, never the local id its projection mints).
   */
  id: string;
  /**
   * The host's own id for the workspace when it already has one (it is what
   * `McpCaller.accountId` holds), so the tools can tell the person's own
   * workspaces apart. Never shown as the id to pass.
   */
  localId?: string | null;
  /** Why it matched: its name, its account's name, a member's email or a form's name. */
  matchedOn?: WorkspaceMatch;
  name: string;
  /** The account (billing) the workspace belongs to, when the host knows it: workspace names repeat. */
  accountName: string | null;
  /** The role a call there acts with: the member's own, or `admin` through a staff access grant. */
  role: string;
  access: 'member' | 'staff';
}

/**
 * What staff of the deployment can do beyond their own workspaces. The host
 * hands it out only when the person is staff, judged again on every request,
 * so a person who stops being staff loses it on the next call whatever rows
 * an earlier grant left behind.
 */
export interface McpStaffAccess {
  /**
   * Workspaces of the whole deployment that match `query` (already checked to
   * hold at least `STAFF_SEARCH_MIN_CHARS` letters or digits), at most
   * `limit`. Never the full list.
   */
  search(query: string, limit: number): Promise<StaffWorkspaceHit[]>;
  /**
   * The caller for a workspace the person is not a member of, through a staff
   * access grant (minted on first use, re-checked on every call). Null when
   * no live workspace has this id.
   */
  enter(workspaceId: string): Promise<McpCaller | null>;
}

/**
 * An MCP connection: a person signed in through OAuth, who may act in every
 * workspace where they hold an active member. The host resolves it again on
 * every request, so a member removed or disabled drops out of `workspaces` on
 * the next call.
 */
export interface McpConnection {
  /** The person, in the terms members are keyed by. */
  personId: string;
  /** The person's email, when the host knows it. */
  email: string | null;
  /** The connection's public label (`oauth:<person>`). Never a secret: it reaches logs. */
  label: string;
  /**
   * One caller per workspace the person may act in now, in a stable order (by
   * workspace name). Empty when they have no active member anywhere yet.
   * Staff access grants are never listed here: they are reached through
   * `staff`, and only while the person is staff.
   */
  workspaces: McpCaller[];
  /** Present only when the person is staff of the deployment on this request. */
  staff?: McpStaffAccess;
}

/** Who the door let in: an API key (one workspace) or an MCP connection (a person). */
export type McpCredential = McpCaller | McpConnection;

export function isConnection(credential: McpCredential): credential is McpConnection {
  return 'workspaces' in credential;
}

/** One problem with a write, as the host's validator reports it. */
export interface BackendIssue {
  /** Dot path inside the request body (`config.steps.2.question`). Empty for the body as a whole. */
  path: string;
  message: string;
  /** zod's issue code or one of the host's own (`UNSUPPORTED_FIELD`, `EMPTY_QUESTION`, ...). */
  code: string;
}

/**
 * A refusal from the backend: an HTTP-like status, a stable code, a message,
 * and for a validation failure every issue at once. Anything else a backend
 * throws is treated as an internal error and never shown to the model.
 */
export class BackendError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly issues: BackendIssue[] = [],
    /** Extra facts the model can act on: `updatedAt` on a STALE, `retryAfterSec` on a 429. */
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'BackendError';
  }
}

/** The member and workspace the credential acts as: every field `GET /v1/me` documents. */
export interface WhoAmI {
  accountId: string;
  accountName: string;
  /** The workspace's public code: the first segment of every public form link. */
  accountCode: string;
  memberId: string;
  displayName: string | null;
  email: string | null;
  role: string;
  /** The member's status (`active` for every caller that gets this far). */
  status: string;
  timezone: string | null;
  /** The language the member chose for the admin (`en`, `es`), or null when they never did. */
  locale: string | null;
}

/** One form in a list. */
export interface FormListItem {
  id: string;
  name: string;
  slug: string;
  folderId: string | null;
  /** True when the form has edits saved but not yet published. */
  hasDraft: boolean;
  createdAt: number;
  updatedAt: number;
  /** The exact link respondents open, or null when the deployment has no public address. */
  publicUrl: string | null;
  /** The form in the dForms editor, or null without a public address. */
  editorUrl: string | null;
  /**
   * How many steps the LIVE config has (what the public link serves), when the
   * host knows it. Zero means the form never published a step: its link opens
   * an empty form. Absent or null: unknown.
   */
  liveStepCount?: number | null;
}

/** One form in full. Secrets in the config (webhook signing secrets) arrive masked. */
export interface FormDetail extends FormListItem {
  /** The live config: what respondents see now. */
  config: unknown;
  /** Unpublished edits, or null. */
  draftConfig: unknown;
  /** When the live config was last published (epoch ms), or null when it never was. */
  publishedAt: number | null;
  /** When the config a revert would bring back went live, or null when there is nothing to revert to. */
  previousPublishedAt: number | null;
}

export interface CreateFormInput {
  name: string;
  config: unknown;
  slug?: string;
  folderId?: string | null;
}

export interface UpdateFormInput {
  name?: string;
  config?: unknown;
  /** The `updatedAt` the caller last saw; a later save elsewhere answers STALE. */
  expectedUpdatedAt: number;
}

export type ResponseStatus = 'all' | 'completed' | 'partial';

export interface ResponsesQuery {
  status?: ResponseStatus;
  /** Start-time window: epoch ms, or `YYYY-MM-DD` for a whole day in the workspace's zone. */
  from?: string;
  to?: string;
  limit: number;
  offset: number;
}

/** One answered question, exactly as the respondent's answers resolve it. */
export interface ResponseAnswer {
  /** The question as the respondent saw it (placeholders filled with their own answers). */
  question: string;
  /** The answer as a person reads it: option labels, not stored values. */
  answer: string;
  /** The step this answer belongs to, when the host knows it. */
  stepKey?: string | null;
  /** That step's type (`email`, `multiple_choice`, ...), when the live form still has it. */
  type?: string | null;
  /**
   * True for an answer stored under a key the live form no longer has (a step
   * deleted or renamed since the response was given). Its `question` is then
   * the stored key: there is no question text left to show.
   */
  stepRemoved?: boolean;
}

export interface ResponseItem {
  id: string;
  /** Null for a partial: the respondent left before the end. */
  completedAt: number | null;
  startedAt: number | null;
  partialAt: number | null;
  score: number | null;
  /**
   * The outcome (result range) a completed response lands in, resolved with
   * the live form's outcomes; null for a partial or a form without outcomes.
   * Absent when the host does not resolve it.
   */
  outcome?: { id: string; label: string } | null;
  /** Everything here was typed by a member of the public. */
  answers: ResponseAnswer[];
}

export interface ResponsesPage {
  items: ResponseItem[];
  total: number;
  limit: number;
  offset: number;
}

export interface AnalyticsQuery {
  from?: string;
  to?: string;
  /** IANA zone the days are counted in; default the workspace's. */
  timeZone?: string;
}

/** The funnel exactly as the Results screen computes it. */
export interface FormAnalytics {
  views: number;
  starts: number;
  submissions: number;
  /** Percent, one decimal, capped at 100; null when nobody started. */
  completionRate: number | null;
  /** Median seconds from opening to completing; null when not derivable. */
  timeToComplete: number | null;
  partialSubmits: number;
  bookings: number;
  /** `viewed` (one question per screen) or `answered` (all questions on one page). */
  dropoffMode: string;
  dropoff: Array<{
    stepIndex: number;
    key: string | null;
    question: string;
    isCover: boolean;
    views: number;
    dropoff: number;
    dropoffPercent: number;
  }>;
  trends: Array<{
    t: number;
    views: number;
    starts: number;
    submissions: number;
    completionRate: number | null;
    timeToComplete: number | null;
  }>;
  range: { from: number | null; to: number | null; timeZone: string };
}

/**
 * Everything the tools need. Every method acts as `caller` and is scoped to
 * `caller.accountId`; a form outside it is a `BackendError` 404, never a leak.
 * The routes of the API reference beyond these are in `ApiParityBackend`.
 */
export interface FormsBackend extends ApiParityBackend {
  whoami(caller: McpCaller): Promise<WhoAmI>;
  listForms(caller: McpCaller): Promise<FormListItem[]>;
  getForm(caller: McpCaller, formId: string): Promise<FormDetail>;
  createForm(caller: McpCaller, input: CreateFormInput): Promise<FormDetail>;
  updateForm(caller: McpCaller, formId: string, input: UpdateFormInput): Promise<FormDetail>;
  publishForm(caller: McpCaller, formId: string, expectedUpdatedAt?: number): Promise<FormDetail>;
  revertForm(caller: McpCaller, formId: string): Promise<FormDetail>;
  /**
   * Drop the form's unpublished draft so it goes back to its live config. A
   * no-op without a draft; a later save than `expectedUpdatedAt` is a STALE.
   */
  discardDraft(caller: McpCaller, formId: string, expectedUpdatedAt?: number): Promise<FormDetail>;
  listResponses(caller: McpCaller, formId: string, query: ResponsesQuery): Promise<ResponsesPage>;
  formAnalytics(caller: McpCaller, formId: string, query: AnalyticsQuery): Promise<FormAnalytics>;
}

/** The methods of `FormsBackend` declared here, without the rest of the API reference. */
export type CoreFormsBackend = Omit<FormsBackend, keyof ApiParityBackend>;
