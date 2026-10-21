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
 * as the key's member). The package never reads it, logs it or returns it.
 */

/** Who is calling, as the host's authenticator resolved it at the door. */
export interface McpCaller {
  /** The workspace every call acts in. Always from the credential, never from an argument. */
  accountId: string;
  /** The member the credential acts as. */
  memberId: string;
  /** That member's role in the workspace (`owner`, `admin`, `member`). */
  role: string;
  /** Stable id of the credential (an API key id), for rate-limit buckets. */
  credentialId: string;
  /** The credential's public label (the key prefix, `dforms_ab12c`). The only identity that reaches a log. */
  label: string;
  /** Host-defined, opaque to this package: how the backend acts as this caller. */
  context: unknown;
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

/** The member and workspace the credential acts as (`GET /v1/me`, trimmed). */
export interface WhoAmI {
  accountId: string;
  accountName: string;
  /** The workspace's public code: the first segment of every public form link. */
  accountCode: string;
  memberId: string;
  displayName: string | null;
  email: string | null;
  role: string;
  timezone: string | null;
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
}

export interface ResponseItem {
  id: string;
  /** Null for a partial: the respondent left before the end. */
  completedAt: number | null;
  startedAt: number | null;
  partialAt: number | null;
  score: number | null;
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
 */
export interface FormsBackend {
  whoami(caller: McpCaller): Promise<WhoAmI>;
  listForms(caller: McpCaller): Promise<FormListItem[]>;
  getForm(caller: McpCaller, formId: string): Promise<FormDetail>;
  createForm(caller: McpCaller, input: CreateFormInput): Promise<FormDetail>;
  updateForm(caller: McpCaller, formId: string, input: UpdateFormInput): Promise<FormDetail>;
  publishForm(caller: McpCaller, formId: string, expectedUpdatedAt?: number): Promise<FormDetail>;
  revertForm(caller: McpCaller, formId: string): Promise<FormDetail>;
  listResponses(caller: McpCaller, formId: string, query: ResponsesQuery): Promise<ResponsesPage>;
  formAnalytics(caller: McpCaller, formId: string, query: AnalyticsQuery): Promise<FormAnalytics>;
}
