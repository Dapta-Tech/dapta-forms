import {
  API_AREAS,
  apiAnchor,
  apiCurl,
  apiDisplayPath,
  apiEndpoints,
  apiExampleJson,
  type ApiArea,
  type ApiEndpoint,
  type ApiMethod,
  type ApiParamDoc,
  type ApiParamIn,
  type ApiRoute,
  type FormsMessages,
} from '@quill/shared';

/**
 * What the API docs page renders, worked out on the server from the typed
 * catalog (`API_REFERENCE` in `@quill/shared`) and the i18n prose, so the
 * client view receives plain strings: no catalog walking, no JSON formatting
 * and no curl building in the browser.
 *
 * Pure: the same catalog, prose and API address always give the same model,
 * which is what lets the specs pin every endpoint without a server.
 */

/** Where the keys live, linked from the page header. */
export const API_KEYS_PATH = '/admin/developers/keys';

/** Where the skill zip is served. The route builds it for this environment. */
export const SKILL_DOWNLOAD_PATH = '/api/developers/skill';

/** Shown in the examples when this deployment has no public API address. */
export const PLACEHOLDER_API_URL = 'https://api.example.com';

export type ApiDocsMessages = FormsMessages['admin']['apiDocs'];
/** `apiDocs` without the reference prose, which reaches the view inside the model. */
export type ApiDocsChrome = Omit<ApiDocsMessages, 'areas' | 'endpoints' | 'params'>;
export type ApiDocsExtras = FormsMessages['admin']['apiDocsPage'];
export type DeveloperDocsMessages = FormsMessages['admin']['developerDocs'];

export function docsChrome(m: ApiDocsMessages): ApiDocsChrome {
  const { areas: _areas, endpoints: _endpoints, params: _params, ...chrome } = m;
  return chrome;
}

export interface DocsParam {
  name: string;
  in: ApiParamIn;
  type: string;
  required: boolean;
  description: string;
}

export interface DocsEndpoint {
  route: ApiRoute;
  /** The element id, for deep links: `get-v1-forms-id`. */
  anchor: string;
  method: ApiMethod;
  /** `/v1/forms/{id}`. */
  path: string;
  area: ApiArea;
  description: string;
  params: DocsParam[];
  curl: string;
  status: number;
  /** The example answer as text: pretty JSON, or the CSV itself. Null on a 204. */
  response: string | null;
  responseType: 'json' | 'csv';
  adminOnly: boolean;
  destructive: boolean;
}

export interface DocsArea {
  id: ApiArea;
  /** The element id of the area's heading: `area-forms`. */
  anchor: string;
  title: string;
  intro: string;
  endpoints: DocsEndpoint[];
}

export interface DocsModel {
  /** The address the examples call. The placeholder when none is configured. */
  apiUrl: string;
  /** False when this deployment has no public API address (`publicApiUrl()` was null). */
  apiUrlConfigured: boolean;
  areas: DocsArea[];
  total: number;
}

/**
 * The prose of the reference, read from the catalog. One accessor so the page
 * depends on the shape of `admin.apiDocs` in exactly one place.
 */
export interface ReferenceProse {
  area(area: ApiArea): { title: string; intro: string };
  endpoint(route: ApiRoute): string;
  param(doc: ApiParamDoc): string;
}

export function referenceProse(admin: FormsMessages['admin']): ReferenceProse {
  const m = admin.apiDocs;
  return {
    area: (area) => m.areas[area],
    endpoint: (route) => m.endpoints[route],
    param: (doc) => m.params[doc],
  };
}

export function areaAnchor(area: ApiArea): string {
  return `area-${area}`;
}

function toDocsEndpoint(e: ApiEndpoint, prose: ReferenceProse, apiUrl: string): DocsEndpoint {
  const responseType = e.responseType ?? 'json';
  let response: string | null = null;
  if (e.response !== undefined) {
    response = responseType === 'csv' && typeof e.response === 'string' ? e.response : apiExampleJson(e.response);
  }
  return {
    route: e.route,
    anchor: apiAnchor(e.route),
    method: e.method,
    path: apiDisplayPath(e.path),
    area: e.area,
    description: prose.endpoint(e.route),
    params: (e.params ?? []).map((p) => ({
      name: p.name,
      in: p.in,
      type: p.type,
      required: p.required === true,
      description: prose.param(p.doc),
    })),
    curl: apiCurl(e, apiUrl),
    status: e.status,
    response,
    responseType,
    adminOnly: e.adminOnly === true,
    destructive: e.destructive === true,
  };
}

export function buildDocsModel(prose: ReferenceProse, publicUrl: string | null): DocsModel {
  const apiUrl = publicUrl ?? PLACEHOLDER_API_URL;
  const endpoints = apiEndpoints().map((e) => toDocsEndpoint(e, prose, apiUrl));
  const areas = API_AREAS.map((id) => ({
    id,
    anchor: areaAnchor(id),
    ...prose.area(id),
    endpoints: endpoints.filter((e) => e.area === id),
  }));
  return { apiUrl, apiUrlConfigured: publicUrl !== null, areas, total: endpoints.length };
}

/** Lowercase, accents stripped: `publicación` matches `publicacion`. */
export function normalizeQuery(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * Does an endpoint match the search? By its path (as written `{id}` or as the
 * controllers write it `:id`), its method, or its description. Every word of
 * the query has to match somewhere, so `get forms` finds the GETs on forms.
 */
export function endpointMatches(e: DocsEndpoint, query: string): boolean {
  const words = normalizeQuery(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = normalizeQuery(`${e.method} ${e.path} ${e.route} ${e.description}`);
  return words.every((w) => haystack.includes(w));
}

// ── The narrative sections ────────────────────────────────────────────────
// Error codes, limits, the example error and what a key cannot do come from
// the catalog (`API_ERROR_CODES`, `API_ISSUE_CODES`, `API_LIMITS`,
// `API_EXAMPLE_ERROR`, `API_NOT_ALLOWED`), which the API's spec holds to the
// API's own constants. Only what the catalog does not carry is written here.

/** The four calls every form goes through, and the endpoint each one is. */
export const FLOW = [
  { id: 'create', route: 'POST /v1/forms' },
  { id: 'edit', route: 'PUT /v1/forms/:id' },
  { id: 'publish', route: 'POST /v1/forms/:id/publish' },
  { id: 'revert', route: 'POST /v1/forms/:id/revert' },
] as const satisfies readonly { id: string; route: ApiRoute }[];

export const GOTCHAS = ['put', 'stale', 'errors', 'editorDefaults', 'destinations', 'rateLimit'] as const;

/** The 403 every route outside the allowlist answers to a key (`keyNotAllowed()` in `api-key-routes.ts`). */
export const EXAMPLE_KEY_NOT_ALLOWED = apiExampleJson({
  error: 'KEY_NOT_ALLOWED',
  message: 'This route cannot be called with an API key. Sign in to dForms to do this.',
});

/** The call the Authentication section shows: who the key acts as. */
export function authCurl(apiUrl: string): string {
  return `curl -sS "${apiUrl.replace(/\/+$/, '')}/v1/me" \\\n  -H "Authorization: Bearer $DFORMS_API_KEY"`;
}

/** The ids of the narrative sections, the anchors the index links to. */
export const SECTION_IDS = {
  start: 'getting-started',
  auth: 'authentication',
  errors: 'errors',
  limits: 'limits',
  reference: 'reference',
  cannot: 'what-a-key-cannot-do',
} as const;
