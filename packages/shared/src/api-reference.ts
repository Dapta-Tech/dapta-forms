/**
 * The public API v1 reference: every route an API key may call, with its
 * parameters, an example request and an example answer.
 *
 * One source for two readers. The web renders the API docs page from it (the
 * prose comes from the i18n catalog, `admin.apiDocs`, keyed by the same route
 * strings), and the API holds it to the truth in its own specs:
 *
 * - the set of routes here must equal `API_KEY_ALLOWED_ROUTES`, in both
 *   directions, so a route a key can call is never left undocumented and a
 *   documented route never answers 403 `KEY_NOT_ALLOWED`;
 * - every example body is sent to the real handler with an API key principal,
 *   so it passes the strict checks keys are held to, not only the schema;
 * - every example answer is compared with what the handler really returns.
 *
 * It lives in this package because both apps read it and neither may import
 * the other. It is data only: no I/O, no framework.
 *
 * Routes are written exactly as the controllers declare them (`METHOD
 * /v1/path/:param`), which is also how `API_KEY_ALLOWED_ROUTES` names them.
 * The page shows `:param` as `{param}`, like the skill does.
 */

import { trimChar, trimTrailing } from './trim';

export type ApiArea =
  | 'forms'
  | 'folders'
  | 'destinations'
  | 'responses'
  | 'analytics'
  | 'branding'
  | 'linkPage'
  | 'notifications'
  | 'integrations'
  | 'identity';

/** The order the reference is read in: what an agent does most, first. */
export const API_AREAS: readonly ApiArea[] = [
  'forms',
  'folders',
  'destinations',
  'responses',
  'analytics',
  'branding',
  'linkPage',
  'notifications',
  'integrations',
  'identity',
];

export type ApiMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** Where a parameter travels. */
export type ApiParamIn = 'path' | 'query' | 'body';

/**
 * The i18n key of a parameter's description (`admin.apiDocs.params`). Not the
 * parameter's name: `id` is a form on one route and a folder on another, and
 * the response filters mean the same on the list, the CSV and the summary.
 */
export type ApiParamDoc =
  // Path
  | 'formId'
  | 'folderPathId'
  | 'submissionPathId'
  | 'submissionDeleteId'
  | 'fileStepKey'
  | 'textStepKey'
  | 'emailKey'
  // Forms
  | 'formName'
  | 'formSlug'
  | 'formConfig'
  | 'formFolderId'
  | 'formConfigEdit'
  | 'formNameEdit'
  | 'expectedUpdatedAt'
  | 'newSlug'
  | 'fileFolderId'
  // Folders
  | 'folderName'
  // Destinations
  | 'destinations'
  // Responses
  | 'status'
  | 'from'
  | 'to'
  | 'scoreMin'
  | 'scoreMax'
  | 'answers'
  | 'search'
  | 'sort'
  | 'limit'
  | 'offset'
  | 'csvIds'
  | 'submissionIds'
  | 'deliveryStatus'
  | 'deliveryKind'
  | 'deliveryLimit'
  // Analytics
  | 'tz'
  | 'q'
  | 'answersLimit'
  // Brand kit
  | 'brandLogo'
  | 'brandPrimaryColor'
  | 'brandBackground'
  | 'brandForeground'
  | 'brandFontFamily'
  | 'brandRadius'
  | 'brandButtonStyle'
  | 'brandClientLogos'
  | 'formIds'
  // Link page
  | 'linkPage'
  | 'linkPageEnabled'
  | 'linkPageName'
  | 'linkPageBio'
  | 'linkPageLogo'
  | 'linkPageItems'
  | 'linkPageSocials'
  | 'linkPageColors'
  | 'linkPagePathId'
  | 'linkPagePageName'
  | 'linkPageSlug'
  | 'linkPageIsDefault'
  | 'linkPageContent'
  | 'linkPageCopyName'
  | 'linkPageCopySlug'
  // Notifications
  | 'notificationEnabled'
  | 'notificationSubject'
  | 'notificationBody'
  | 'notificationRecipients';

export interface ApiParamSpec {
  name: string;
  in: ApiParamIn;
  /** A short type, as a reader of the docs would write it (`string`, `epoch ms`, `object[]`). */
  type: string;
  required?: boolean;
  doc: ApiParamDoc;
  /**
   * The value the curl example uses. Path parameters take a shell variable
   * (`$FORM_ID`); a query parameter with one is added to the example.
   */
  example?: string;
}

export interface ApiEndpointSpec {
  area: ApiArea;
  params?: readonly ApiParamSpec[];
  /** The example request body, sent as JSON. */
  body?: unknown;
  /** The status a successful call answers with. */
  status: 200 | 201 | 204;
  /** The example answer: JSON, or the text of a non-JSON answer. Absent on a 204. */
  response?: unknown;
  /** `csv` when the answer is a file rather than JSON. */
  responseType?: 'json' | 'csv';
  /** Needs a key whose owner is an owner or admin of the workspace (else 403 `FORBIDDEN`). */
  adminOnly?: true;
  /** Deletes something: an agent should ask the person before calling it. */
  destructive?: true;
}

/**
 * Ids the examples use, so a body, a path and an answer can point at the same
 * form, folder or response. The API's spec swaps them for real ids before it
 * sends an example. UUID-shaped like the real ones.
 */
export const API_EXAMPLE_IDS = {
  form: '6f1d2c3b-4a5e-4f60-8a71-92b3c4d5e6f7',
  formCopy: '7a2e3d4c-5b6f-4071-9b82-a3c4d5e6f708',
  folder: '0c9b8a7f-6e5d-4c3b-8a29-18f7e6d5c4b3',
  submission: '8f0c1d52-3e4a-4b6c-9d7e-0f1a2b3c4d5e',
  member: '2d4f6a8c-1b3e-4d5f-a7c9-e1f3a5c7e9b2',
  account: '5e7a9c1e-3f5b-4d7f-b9e1-a3c5e7f9b1d4',
  webhook: 'c3e5a7f9-1b3d-4f5a-8c7e-9a1b3c5d7e9f',
  linkPage: '9b1d3f5a-7c9e-4b1d-8f3a-5c7e9b1d3f5a',
  linkPageCopy: 'a2c4e6f8-0b2d-4f6a-9c8e-0a2c4e6f8b0d',
} as const;

/**
 * The `updatedAt` the examples read and send back as `expectedUpdatedAt`
 * (2026-01-01). The API's spec swaps it for the form's real stamp.
 */
export const API_EXAMPLE_STAMP = 1767225600000;

const ID = API_EXAMPLE_IDS;
const STAMP = API_EXAMPLE_STAMP;

// ── Shared pieces of the examples ─────────────────────────────────────────

/** The form the examples create, edit and read: a short lead form. */
const EXAMPLE_CONFIG = {
  version: 1,
  title: 'Talk to sales',
  steps: [
    { key: 'name', type: 'name', question: 'What is your name?', required: true },
    { key: 'email', type: 'email', question: 'What is your work email?', required: true },
    {
      key: 'interest',
      type: 'multiple_choice',
      question: 'What are you interested in?',
      required: true,
      options: [
        { label: 'A demo', value: 'demo' },
        { label: 'Pricing', value: 'pricing' },
      ],
    },
    { key: 'notes', type: 'textarea', question: 'Anything else we should know?', required: false },
  ],
} as const;

/** `EXAMPLE_CONFIG` after the edit example: one more option on `interest`. */
const EXAMPLE_CONFIG_EDITED = {
  ...EXAMPLE_CONFIG,
  steps: EXAMPLE_CONFIG.steps.map((step) =>
    step.key === 'interest'
      ? {
          ...step,
          options: [...step.options, { label: 'A partnership', value: 'partnership' }],
        }
      : step,
  ),
} as const;

/**
 * A config as the API stores and answers it: normalized like the editor saves
 * it (each step gains its `flowGroup`, a choice step its `selectionMode`) and,
 * on a new form, the brand colours.
 */
function asSaved(config: { steps: readonly { type: string }[] }, { branded = true } = {}) {
  return {
    ...config,
    steps: config.steps.map((step) => ({
      ...step,
      flowGroup: step.type === 'name' || step.type === 'email' ? 'lead_capture' : 'qualification',
      ...(step.type === 'multiple_choice' ? { selectionMode: 'single' } : {}),
    })),
    ...(branded
      ? { branding: { background: '#ffffff', foreground: '#1a1a1c', primaryColor: '#3ddc84', themePreset: 'dforms' } }
      : {}),
  };
}

const FORM_LINKS = {
  publicUrl: 'https://forms.example.com/acme/f/talk-to-sales',
  editorUrl: `https://forms.example.com/admin/forms/${ID.form}/edit`,
};

/** A form as the API answers it (trimmed to the fields a caller reads). */
const FORM_VIEW = {
  id: ID.form,
  name: 'Talk to sales',
  slug: 'talk-to-sales',
  config: asSaved(EXAMPLE_CONFIG),
  draftConfig: null,
  publishedAt: null,
  previousPublishedAt: null,
  folderId: null,
  createdAt: STAMP,
  updatedAt: STAMP,
  ...FORM_LINKS,
};

const RESPONSE_FILTERS: readonly ApiParamSpec[] = [
  { name: 'status', in: 'query', type: 'all | completed | partial', doc: 'status', example: 'completed' },
  { name: 'from', in: 'query', type: 'YYYY-MM-DD | epoch ms', doc: 'from', example: '2026-10-01' },
  { name: 'to', in: 'query', type: 'YYYY-MM-DD | epoch ms', doc: 'to', example: '2026-10-31' },
  { name: 'scoreMin', in: 'query', type: 'number', doc: 'scoreMin' },
  { name: 'scoreMax', in: 'query', type: 'number', doc: 'scoreMax' },
  { name: 'answers', in: 'query', type: 'JSON object', doc: 'answers', example: '{"interest":["demo"]}' },
  { name: 'search', in: 'query', type: 'string', doc: 'search' },
];

const FORM_PATH: ApiParamSpec = { name: 'id', in: 'path', type: 'string', required: true, doc: 'formId', example: '$FORM_ID' };
const EMAIL_KEY_PATH: ApiParamSpec = {
  name: 'emailKey',
  in: 'path',
  type: 'submission_received | submission_confirmed',
  required: true,
  doc: 'emailKey',
  example: 'submission_received',
};

const NOTIFICATION_BODY: readonly ApiParamSpec[] = [
  { name: 'enabled', in: 'body', type: 'boolean', doc: 'notificationEnabled' },
  { name: 'subject', in: 'body', type: 'string | null', doc: 'notificationSubject' },
  { name: 'body', in: 'body', type: 'string | null', doc: 'notificationBody' },
  { name: 'recipients', in: 'body', type: 'string[] | null', doc: 'notificationRecipients' },
];

/** A `name` step stores its parts under their own keys, `firstname` and `lastname`. */
export const API_EXAMPLE_ANSWERS = {
  firstname: 'Ana',
  lastname: 'Rivera',
  email: 'ana@example.com',
  interest: 'demo',
  notes: 'We run ads in three countries.',
} as const;

/** When the example response came in: 2026-10-05, 15:01 UTC. */
const ANSWERED_AT = 1791212460000;

const SUBMISSION = {
  id: ID.submission,
  formId: ID.form,
  data: API_EXAMPLE_ANSWERS,
  score: 0,
  startedAt: ANSWERED_AT - 60_000,
  completedAt: ANSWERED_AT,
  partialAt: null,
};

const TEXT_ANSWER = {
  id: ID.submission,
  text: API_EXAMPLE_ANSWERS.notes,
  respondent: API_EXAMPLE_ANSWERS.email,
  at: ANSWERED_AT,
};

const CHOICE_COUNTS = [
  { value: 'demo', label: 'A demo', count: 1, percent: 100 },
  { value: 'pricing', label: 'Pricing', count: 0, percent: 0 },
];

// ── The reference ──────────────────────────────────────────────────────────

const SAVED = asSaved(EXAMPLE_CONFIG);
/** The edited config as a draft and once published: as sent, normalized (a PUT adds no brand colours). */
const SAVED_EDITED = asSaved(EXAMPLE_CONFIG_EDITED, { branded: false });
const WEBHOOK = {
  type: 'webhook',
  id: ID.webhook,
  enabled: true,
  events: ['complete'],
  settings: { url: 'https://example.com/hooks/dforms' },
};
const NOTIFICATION_DEFAULTS = {
  en: { subject: 'New submission: {{formName}}', body: 'You have a new submission on "{{formName}}".' },
  es: { subject: 'Nueva respuesta: {{formName}}', body: 'Recibiste una nueva respuesta en "{{formName}}".' },
};
const NOTIFICATION_TOKEN_LIST = [
  'formName',
  'respondentName',
  'respondentEmail',
  'score',
  'outcomeLabel',
  'formLink',
  'answers',
];
const NOTIFICATION_VIEW = {
  emailKey: 'submission_received',
  enabled: true,
  subject: 'New response to {{formName}}',
  body: null,
  recipients: ['sales@example.com'],
  updatedAt: STAMP,
  tokens: NOTIFICATION_TOKEN_LIST,
  defaults: NOTIFICATION_DEFAULTS,
};
const FORM_NOTIFICATION_VIEW = {
  emailKey: 'submission_received',
  account: { enabled: true, subject: 'New response to {{formName}}', body: null, recipients: ['sales@example.com'] },
  override: null,
  tokens: NOTIFICATION_TOKEN_LIST,
  defaults: NOTIFICATION_DEFAULTS,
};
const BRAND_KIT = {
  logo: 'https://example.com/logo.png',
  primaryColor: '#3DDC84',
  fontFamily: 'poppins',
  radius: 'round',
  buttonStyle: 'solid',
};

/** The link page the examples save: a form button, a link and two socials. */
const LINK_PAGE = {
  version: 1,
  enabled: true,
  name: 'Acme Inc.',
  bio: 'Talk to us, or book a demo.',
  items: [
    { type: 'form', formId: ID.form },
    { type: 'link', label: 'Our website', url: 'https://example.com' },
  ],
  socials: { instagram: '@acme', whatsapp: '+57 300 123 4567' },
};

/** `LINK_PAGE` as the API stores and answers it: socials normalized, WhatsApp as digits. */
const LINK_PAGE_SAVED = {
  ...LINK_PAGE,
  socials: { instagram: 'https://www.instagram.com/acme', whatsapp: '573001234567' },
};

/** A second page, for a trade fair: its own button and its own colours. */
const EXPO_PAGE = {
  version: 1,
  enabled: true,
  name: 'Acme at Expo 2026',
  items: [{ type: 'form', formId: ID.form }],
  colors: { primaryColor: '#3DDC84' },
};

const LINK_PAGE_FORMS = [{ id: ID.form, slug: 'talk-to-sales', name: 'Talk to sales', title: 'Talk to sales' }];

/** One page of several as `GET /v1/link-pages/:id` and the writes answer it. */
const EXPO_VIEW = {
  id: ID.linkPage,
  slug: 'expo-2026',
  name: 'Expo 2026',
  isDefault: false,
  createdAt: STAMP,
  updatedAt: STAMP,
  accountCode: 'acme',
  accountName: 'Acme Inc.',
  page: EXPO_PAGE,
  forms: LINK_PAGE_FORMS,
  brandKit: BRAND_KIT,
  publicUrl: 'https://forms.example.com/acme/p/expo-2026',
  live: true,
};

const LINK_PAGE_PATH: ApiParamSpec = {
  name: 'id',
  in: 'path',
  type: 'string',
  required: true,
  doc: 'linkPagePathId',
  example: '$PAGE_ID',
};

export const API_REFERENCE = {
  // Forms
  'GET /v1/forms': {
    area: 'forms',
    status: 200,
    response: [
      {
        id: ID.form,
        name: 'Talk to sales',
        slug: 'talk-to-sales',
        hasDraft: false,
        folderId: null,
        createdAt: STAMP,
        updatedAt: STAMP,
        ...FORM_LINKS,
      },
    ],
  },
  'POST /v1/forms': {
    area: 'forms',
    params: [
      { name: 'name', in: 'body', type: 'string', required: true, doc: 'formName' },
      { name: 'slug', in: 'body', type: 'string', doc: 'formSlug' },
      { name: 'config', in: 'body', type: 'object', doc: 'formConfig' },
      { name: 'folderId', in: 'body', type: 'string | null', doc: 'formFolderId' },
    ],
    body: { name: 'Talk to sales', config: EXAMPLE_CONFIG },
    status: 201,
    response: FORM_VIEW,
  },
  'GET /v1/forms/:id': {
    area: 'forms',
    params: [FORM_PATH],
    status: 200,
    response: FORM_VIEW,
  },
  'PUT /v1/forms/:id': {
    area: 'forms',
    params: [
      FORM_PATH,
      { name: 'config', in: 'body', type: 'object', doc: 'formConfigEdit' },
      { name: 'name', in: 'body', type: 'string', doc: 'formNameEdit' },
      { name: 'expectedUpdatedAt', in: 'body', type: 'epoch ms', doc: 'expectedUpdatedAt' },
    ],
    body: { config: EXAMPLE_CONFIG_EDITED, expectedUpdatedAt: STAMP },
    status: 200,
    response: { ...FORM_VIEW, draftConfig: SAVED_EDITED, updatedAt: STAMP + 60_000 },
  },
  'POST /v1/forms/:id/publish': {
    area: 'forms',
    params: [FORM_PATH, { name: 'expectedUpdatedAt', in: 'body', type: 'epoch ms', doc: 'expectedUpdatedAt' }],
    body: { expectedUpdatedAt: STAMP },
    status: 201,
    response: {
      ...FORM_VIEW,
      config: SAVED_EDITED,
      publishedAt: STAMP + 120_000,
      previousPublishedAt: STAMP,
      updatedAt: STAMP + 120_000,
    },
  },
  'POST /v1/forms/:id/discard-draft': {
    area: 'forms',
    params: [FORM_PATH, { name: 'expectedUpdatedAt', in: 'body', type: 'epoch ms', doc: 'expectedUpdatedAt' }],
    status: 200,
    response: {
      ...FORM_VIEW,
      config: SAVED_EDITED,
      publishedAt: STAMP + 120_000,
      previousPublishedAt: STAMP,
      // A discard is a write: it stamps updatedAt, so it lands after the publish.
      updatedAt: STAMP + 180_000,
    },
  },
  'POST /v1/forms/:id/revert': {
    area: 'forms',
    params: [FORM_PATH],
    status: 200,
    response: {
      ...FORM_VIEW,
      config: SAVED,
      publishedAt: STAMP,
      previousPublishedAt: STAMP + 120_000,
      updatedAt: STAMP + 180_000,
    },
  },
  'PUT /v1/forms/:id/slug': {
    area: 'forms',
    params: [FORM_PATH, { name: 'slug', in: 'body', type: 'string', required: true, doc: 'newSlug' }],
    body: { slug: 'sales' },
    status: 200,
    response: {
      ...FORM_VIEW,
      slug: 'sales',
      publicUrl: 'https://forms.example.com/acme/f/sales',
    },
  },
  'POST /v1/forms/:id/duplicate': {
    area: 'forms',
    params: [FORM_PATH],
    status: 201,
    response: {
      ...FORM_VIEW,
      id: ID.formCopy,
      name: 'Talk to sales (copy)',
      slug: 'talk-to-sales-2',
      publicUrl: 'https://forms.example.com/acme/f/talk-to-sales-2',
      editorUrl: `https://forms.example.com/admin/forms/${ID.formCopy}/edit`,
    },
  },
  'PATCH /v1/forms/:id/folder': {
    area: 'forms',
    params: [FORM_PATH, { name: 'folderId', in: 'body', type: 'string | null', required: true, doc: 'fileFolderId' }],
    body: { folderId: ID.folder },
    status: 200,
    response: { id: ID.form, folderId: ID.folder },
  },
  'DELETE /v1/forms/:id': {
    area: 'forms',
    params: [FORM_PATH],
    status: 204,
    destructive: true,
  },

  // Folders
  'GET /v1/folders': {
    area: 'folders',
    status: 200,
    response: [{ id: ID.folder, name: 'Campaigns', createdAt: STAMP, updatedAt: STAMP }],
  },
  'POST /v1/folders': {
    area: 'folders',
    params: [{ name: 'name', in: 'body', type: 'string', required: true, doc: 'folderName' }],
    body: { name: 'Campaigns' },
    status: 201,
    response: { id: ID.folder, name: 'Campaigns', createdAt: STAMP, updatedAt: STAMP },
  },
  'PATCH /v1/folders/:id': {
    area: 'folders',
    params: [
      { name: 'id', in: 'path', type: 'string', required: true, doc: 'folderPathId', example: '$FOLDER_ID' },
      { name: 'name', in: 'body', type: 'string', required: true, doc: 'folderName' },
    ],
    body: { name: 'Q4 campaigns' },
    status: 200,
    response: { id: ID.folder, name: 'Q4 campaigns', createdAt: STAMP, updatedAt: STAMP + 60_000 },
  },
  'DELETE /v1/folders/:id': {
    area: 'folders',
    params: [{ name: 'id', in: 'path', type: 'string', required: true, doc: 'folderPathId', example: '$FOLDER_ID' }],
    status: 204,
    destructive: true,
  },

  // Destinations
  'PUT /v1/forms/:id/destinations': {
    area: 'destinations',
    params: [FORM_PATH, { name: 'destinations', in: 'body', type: 'object[]', required: true, doc: 'destinations' }],
    body: { destinations: [WEBHOOK] },
    status: 200,
    // The form as saved, without `publicUrl` and `editorUrl`: this route does not add them.
    response: (({ publicUrl: _p, editorUrl: _e, ...form }) => ({ ...form, config: { ...SAVED, destinations: [WEBHOOK] } }))(
      FORM_VIEW,
    ),
  },
  'POST /v1/forms/:id/destinations/webhook/ping': {
    area: 'destinations',
    params: [FORM_PATH],
    status: 200,
    adminOnly: true,
    response: { ok: true, status: 200 },
  },

  // Responses
  'GET /v1/forms/:id/submissions': {
    area: 'responses',
    params: [
      FORM_PATH,
      ...RESPONSE_FILTERS,
      { name: 'sort', in: 'query', type: 'newest | oldest | score_desc | score_asc', doc: 'sort', example: 'newest' },
      { name: 'limit', in: 'query', type: 'number', doc: 'limit', example: '50' },
      { name: 'offset', in: 'query', type: 'number', doc: 'offset', example: '0' },
    ],
    status: 200,
    response: { items: [SUBMISSION], total: 1, limit: 50, offset: 0 },
  },
  'GET /v1/forms/:id/submissions/:submissionId': {
    area: 'responses',
    params: [
      FORM_PATH,
      { name: 'submissionId', in: 'path', type: 'string', required: true, doc: 'submissionPathId', example: '$SUBMISSION_ID' },
    ],
    status: 200,
    response: SUBMISSION,
  },
  'GET /v1/forms/:id/submissions/:submissionId/files/:stepKey': {
    area: 'responses',
    params: [
      FORM_PATH,
      { name: 'submissionId', in: 'path', type: 'string', required: true, doc: 'submissionPathId', example: '$SUBMISSION_ID' },
      { name: 'stepKey', in: 'path', type: 'string', required: true, doc: 'fileStepKey', example: 'resume' },
    ],
    status: 200,
    response: {
      name: 'resume.pdf',
      size: 182044,
      kind: 'pdf',
      url: 'https://files.example.com/resume.pdf?X-Amz-Signature=example',
      previewUrl: 'https://files.example.com/resume.pdf?response-content-disposition=inline&X-Amz-Signature=example',
    },
  },
  'GET /v1/forms/:id/submissions.csv': {
    area: 'responses',
    params: [
      FORM_PATH,
      ...RESPONSE_FILTERS,
      { name: 'sort', in: 'query', type: 'newest | oldest | score_desc | score_asc', doc: 'sort' },
      { name: 'ids', in: 'query', type: 'string (comma separated)', doc: 'csvIds' },
    ],
    status: 200,
    responseType: 'csv',
    response:
      'First name,Last name,What is your work email?,What are you interested in?,Anything else we should know?,Submitted at,Status,Score,Submission id,Page URL\n' +
      `Ana,Rivera,ana@example.com,A demo,We run ads in three countries.,2026-10-05T15:01:00+00:00,Completed,0,${ID.submission},`,
  },
  'POST /v1/forms/:id/submissions/bulk-delete': {
    area: 'responses',
    params: [FORM_PATH, { name: 'ids', in: 'body', type: 'string[]', required: true, doc: 'submissionIds' }],
    body: { ids: [ID.submission] },
    status: 200,
    destructive: true,
    response: { deleted: 1 },
  },
  'DELETE /v1/submissions/:id': {
    area: 'responses',
    params: [
      { name: 'id', in: 'path', type: 'string', required: true, doc: 'submissionDeleteId', example: '$SUBMISSION_ID' },
    ],
    status: 204,
    destructive: true,
  },
  'GET /v1/forms/:id/deliveries': {
    area: 'responses',
    params: [
      FORM_PATH,
      { name: 'status', in: 'query', type: 'string (comma separated)', doc: 'deliveryStatus', example: 'done,failed' },
      { name: 'kind', in: 'query', type: 'string (comma separated)', doc: 'deliveryKind' },
      { name: 'limit', in: 'query', type: 'number', doc: 'deliveryLimit' },
    ],
    status: 200,
    response: {
      items: [
        {
          id: '4b6d8f0a-2c4e-4a6b-8d0f-1a3c5e7a9b1d',
          kind: 'webhook',
          status: 'failed',
          action: 'complete',
          lastError: 'Webhook answered 500',
          attempts: 5,
          createdAt: ANSWERED_AT,
          updatedAt: ANSWERED_AT + 900_000,
          responseStatus: 500,
          requestBody: '{"id":"…","type":"form.submission","phase":"complete"}',
          responseBody: 'Internal Server Error',
        },
      ],
    },
  },

  // Analytics
  'GET /v1/forms/:id/analytics': {
    area: 'analytics',
    params: [
      FORM_PATH,
      { name: 'from', in: 'query', type: 'YYYY-MM-DD | epoch ms', doc: 'from', example: '2026-10-01' },
      { name: 'to', in: 'query', type: 'YYYY-MM-DD | epoch ms', doc: 'to', example: '2026-10-31' },
      { name: 'tz', in: 'query', type: 'IANA time zone', doc: 'tz' },
    ],
    status: 200,
    response: {
      views: 240,
      starts: 180,
      submissions: 96,
      completionRate: 53.3,
      timeToComplete: 74,
      partialSubmits: 31,
      bookings: 0,
      dropoffMode: 'viewed',
      dropoff: [
        { stepIndex: 0, key: 'name', question: 'What is your name?', isCover: false, views: 180, dropoff: 12, dropoffPercent: 6.7 },
      ],
      trends: [{ t: 1790812800000, views: 9, starts: 7, submissions: 4, completionRate: 57.1, timeToComplete: 70 }],
      range: { from: 1790812800000, to: 1793491199999, timeZone: 'America/Bogota' },
    },
  },
  'GET /v1/forms/:id/summary': {
    area: 'analytics',
    params: [FORM_PATH, ...RESPONSE_FILTERS],
    status: 200,
    response: {
      total: 1,
      questions: [
        {
          key: 'interest',
          type: 'multiple_choice',
          label: 'What are you interested in?',
          total: 1,
          kind: 'choice',
          answered: 1,
          multiple: false,
          options: CHOICE_COUNTS,
        },
        {
          key: 'notes',
          type: 'textarea',
          label: 'Anything else we should know?',
          total: 1,
          kind: 'text',
          answered: 1,
          recent: [TEXT_ANSWER],
        },
      ],
    },
  },
  'GET /v1/forms/:id/submissions-facets': {
    area: 'analytics',
    params: [FORM_PATH],
    status: 200,
    response: { total: 1, completed: 1, partial: 0, choices: { interest: CHOICE_COUNTS } },
  },
  'GET /v1/forms/:id/summary/:stepKey/answers': {
    area: 'analytics',
    params: [
      FORM_PATH,
      { name: 'stepKey', in: 'path', type: 'string', required: true, doc: 'textStepKey', example: 'notes' },
      { name: 'q', in: 'query', type: 'string', doc: 'q', example: 'ads' },
      { name: 'limit', in: 'query', type: 'number', doc: 'answersLimit' },
      { name: 'offset', in: 'query', type: 'number', doc: 'offset' },
      ...RESPONSE_FILTERS,
    ],
    status: 200,
    response: { items: [TEXT_ANSWER], total: 1, limit: 10, offset: 0 },
  },

  // Brand kit
  'GET /v1/branding': {
    area: 'branding',
    status: 200,
    response: { config: BRAND_KIT, updatedAt: STAMP },
  },
  'PUT /v1/branding': {
    area: 'branding',
    params: [
      { name: 'logo', in: 'body', type: 'https URL | null', doc: 'brandLogo' },
      { name: 'primaryColor', in: 'body', type: 'CSS color | null', doc: 'brandPrimaryColor' },
      { name: 'background', in: 'body', type: 'CSS color | null', doc: 'brandBackground' },
      { name: 'foreground', in: 'body', type: 'CSS color | null', doc: 'brandForeground' },
      { name: 'fontFamily', in: 'body', type: 'string', doc: 'brandFontFamily' },
      { name: 'radius', in: 'body', type: 'sharp | soft | round', doc: 'brandRadius' },
      { name: 'buttonStyle', in: 'body', type: 'solid | outline | soft', doc: 'brandButtonStyle' },
      { name: 'clientLogos', in: 'body', type: 'object[]', doc: 'brandClientLogos' },
    ],
    body: BRAND_KIT,
    status: 200,
    adminOnly: true,
    response: { config: BRAND_KIT, updatedAt: STAMP },
  },
  'POST /v1/branding/apply': {
    area: 'branding',
    params: [{ name: 'formIds', in: 'body', type: 'string[]', required: true, doc: 'formIds' }],
    body: { formIds: [ID.form] },
    status: 201,
    adminOnly: true,
    response: { applied: [ID.form] },
  },
  'POST /v1/branding/revert': {
    area: 'branding',
    params: [{ name: 'formIds', in: 'body', type: 'string[]', required: true, doc: 'formIds' }],
    body: { formIds: [ID.form] },
    status: 201,
    adminOnly: true,
    response: { reverted: [ID.form] },
  },

  // Link page
  'GET /v1/link-page': {
    area: 'linkPage',
    status: 200,
    response: {
      id: ID.linkPage,
      slug: 'main',
      name: '',
      isDefault: true,
      accountCode: 'acme',
      accountName: 'Acme Inc.',
      page: LINK_PAGE_SAVED,
      forms: LINK_PAGE_FORMS,
      brandKit: BRAND_KIT,
      publicUrl: 'https://forms.example.com/acme',
      live: true,
    },
  },
  'PUT /v1/link-page': {
    area: 'linkPage',
    params: [
      { name: 'page', in: 'body', type: 'object | null', required: true, doc: 'linkPage' },
      { name: 'page.enabled', in: 'body', type: 'boolean', doc: 'linkPageEnabled' },
      { name: 'page.name', in: 'body', type: 'string | null', doc: 'linkPageName' },
      { name: 'page.bio', in: 'body', type: 'string | null', doc: 'linkPageBio' },
      { name: 'page.logo', in: 'body', type: 'http(s) URL | null', doc: 'linkPageLogo' },
      { name: 'page.items', in: 'body', type: 'object[]', doc: 'linkPageItems' },
      { name: 'page.socials', in: 'body', type: 'object', doc: 'linkPageSocials' },
    ],
    body: { page: LINK_PAGE },
    status: 200,
    destructive: true,
    response: { ok: true, page: LINK_PAGE_SAVED },
  },
  'GET /v1/link-pages': {
    area: 'linkPage',
    status: 200,
    response: {
      accountCode: 'acme',
      max: 20,
      pages: [
        {
          id: ID.linkPage,
          slug: 'expo-2026',
          name: 'Expo 2026',
          isDefault: false,
          live: true,
          buttons: 1,
          createdAt: STAMP,
          updatedAt: STAMP,
          publicUrl: 'https://forms.example.com/acme/p/expo-2026',
        },
      ],
    },
  },
  'POST /v1/link-pages': {
    area: 'linkPage',
    params: [
      { name: 'name', in: 'body', type: 'string', doc: 'linkPagePageName' },
      { name: 'slug', in: 'body', type: 'string', doc: 'linkPageSlug' },
      { name: 'page', in: 'body', type: 'object', doc: 'linkPageContent' },
      { name: 'page.colors', in: 'body', type: 'object', doc: 'linkPageColors' },
    ],
    body: { name: 'Expo 2026', slug: 'expo-2026', page: EXPO_PAGE },
    status: 201,
    response: EXPO_VIEW,
  },
  'GET /v1/link-pages/:id': {
    area: 'linkPage',
    params: [LINK_PAGE_PATH],
    status: 200,
    response: EXPO_VIEW,
  },
  'PUT /v1/link-pages/:id': {
    area: 'linkPage',
    params: [
      LINK_PAGE_PATH,
      { name: 'name', in: 'body', type: 'string', doc: 'linkPagePageName' },
      { name: 'slug', in: 'body', type: 'string', doc: 'linkPageSlug' },
      { name: 'isDefault', in: 'body', type: 'true', doc: 'linkPageIsDefault' },
      { name: 'page', in: 'body', type: 'object', doc: 'linkPageContent' },
    ],
    body: { name: 'Expo 2026', page: EXPO_PAGE },
    status: 200,
    destructive: true,
    response: EXPO_VIEW,
  },
  'POST /v1/link-pages/:id/duplicate': {
    area: 'linkPage',
    params: [
      LINK_PAGE_PATH,
      { name: 'name', in: 'body', type: 'string', doc: 'linkPageCopyName' },
      { name: 'slug', in: 'body', type: 'string', doc: 'linkPageCopySlug' },
    ],
    body: { name: 'Expo 2027' },
    status: 201,
    response: {
      ...EXPO_VIEW,
      id: ID.linkPageCopy,
      slug: 'expo-2026-2',
      name: 'Expo 2027',
      page: { ...EXPO_PAGE, enabled: false },
      publicUrl: 'https://forms.example.com/acme/p/expo-2026-2',
      live: false,
    },
  },
  'DELETE /v1/link-pages/:id': {
    area: 'linkPage',
    params: [LINK_PAGE_PATH],
    status: 200,
    destructive: true,
    response: { ok: true, id: ID.linkPage, slug: 'expo-2026' },
  },

  // Notifications
  'GET /v1/notifications': {
    area: 'notifications',
    status: 200,
    adminOnly: true,
    response: { settings: [NOTIFICATION_VIEW] },
  },
  'PUT /v1/notifications/:emailKey': {
    area: 'notifications',
    params: [EMAIL_KEY_PATH, ...NOTIFICATION_BODY],
    body: { enabled: true, subject: 'New response to {{formName}}', recipients: ['sales@example.com'] },
    status: 200,
    adminOnly: true,
    response: NOTIFICATION_VIEW,
  },
  'POST /v1/notifications/:emailKey/reset': {
    area: 'notifications',
    params: [EMAIL_KEY_PATH],
    status: 201,
    adminOnly: true,
    response: { ...NOTIFICATION_VIEW, subject: null },
  },
  'GET /v1/forms/:id/notifications': {
    area: 'notifications',
    params: [FORM_PATH],
    status: 200,
    adminOnly: true,
    response: { settings: [FORM_NOTIFICATION_VIEW] },
  },
  'PUT /v1/forms/:id/notifications/:emailKey': {
    area: 'notifications',
    params: [FORM_PATH, EMAIL_KEY_PATH, ...NOTIFICATION_BODY],
    body: { enabled: true, subject: 'New lead from {{formName}}: {{respondentEmail}}' },
    status: 200,
    adminOnly: true,
    response: {
      ...FORM_NOTIFICATION_VIEW,
      override: {
        enabled: true,
        subject: 'New lead from {{formName}}: {{respondentEmail}}',
        body: null,
        recipients: null,
        updatedAt: STAMP,
      },
    },
  },
  'POST /v1/forms/:id/notifications/:emailKey/reset': {
    area: 'notifications',
    params: [FORM_PATH, EMAIL_KEY_PATH],
    status: 201,
    adminOnly: true,
    response: FORM_NOTIFICATION_VIEW,
  },

  // Integrations, read only
  'GET /v1/integrations': {
    area: 'integrations',
    status: 200,
    response: {
      encryptionAvailable: true,
      providers: [{ provider: 'hubspot', connected: true, last4: '9f2c', label: 'Acme portal', connectedAt: STAMP }],
      serverProvided: [],
    },
  },
  'GET /v1/integrations/webhooks': {
    area: 'integrations',
    status: 200,
    response: {
      items: [
        {
          formId: ID.form,
          formName: 'Talk to sales',
          webhookId: ID.webhook,
          url: 'https://example.com/hooks/dforms',
          enabled: true,
          firesPartial: false,
          firesComplete: true,
          partialsHeld: false,
          hasSecret: false,
          failures: null,
        },
      ],
    },
  },
  'GET /v1/integrations/hubspot/properties': {
    area: 'integrations',
    status: 200,
    response: {
      enabled: true,
      cached: false,
      properties: [
        { name: 'company', label: 'Company name', type: 'string' },
        {
          name: 'lifecyclestage',
          label: 'Lifecycle stage',
          type: 'enumeration',
          options: [{ value: 'lead', label: 'Lead' }],
        },
      ],
    },
  },
  'GET /v1/integrations/calendly/event-types': {
    area: 'integrations',
    status: 200,
    response: {
      enabled: true,
      cached: false,
      connectedAs: 'alex@example.com',
      eventTypes: [
        {
          uri: 'https://api.calendly.example/event_types/demo',
          name: 'Demo',
          schedulingUrl: 'https://calendly.example/acme/demo',
          active: true,
          durationMinutes: 30,
          customQuestions: [{ id: 'a1', label: 'Company', required: true }],
        },
      ],
    },
  },

  // Identity
  'GET /v1/me': {
    area: 'identity',
    status: 200,
    response: {
      accountId: ID.account,
      accountName: 'Acme Inc.',
      accountCode: 'acme',
      memberId: ID.member,
      displayName: 'Alex Rivera',
      email: 'alex@example.com',
      role: 'owner',
      status: 'active',
      timezone: 'America/Bogota',
      locale: 'en',
    },
  },
  'GET /v1/me/profile': {
    area: 'identity',
    status: 200,
    response: { handle: 'alex-rivera', profile: null },
  },
  'GET /v1/vanity': {
    area: 'identity',
    status: 200,
    response: { vanitySlug: null, shortCode: 'acme', canClaim: true },
  },
} as const satisfies Record<string, ApiEndpointSpec>;

/** `METHOD /v1/path/:param`, exactly as `API_KEY_ALLOWED_ROUTES` names it. */
export type ApiRoute = keyof typeof API_REFERENCE;

export interface ApiEndpoint extends ApiEndpointSpec {
  route: ApiRoute;
  method: ApiMethod;
  /** The path as the controllers declare it (`/v1/forms/:id`). */
  path: string;
}

/** Every endpoint, in reading order: area by area, and in each area as written above. */
export function apiEndpoints(): ApiEndpoint[] {
  const all = (Object.entries(API_REFERENCE) as [ApiRoute, ApiEndpointSpec][]).map(([route, spec]) => {
    const space = route.indexOf(' ');
    return { ...spec, route, method: route.slice(0, space) as ApiMethod, path: route.slice(space + 1) };
  });
  return API_AREAS.flatMap((area) => all.filter((e) => e.area === area));
}

/** The path as people read it: `/v1/forms/{id}`. */
export function apiDisplayPath(path: string): string {
  return path.replace(/:([A-Za-z]+)/g, '{$1}');
}

/** The in-page anchor of an endpoint: `get-v1-forms-id`. */
export function apiAnchor(route: string): string {
  return trimChar(route.toLowerCase().replace(/[^a-z0-9]+/g, '-'), '-');
}

/** The example body as JSON text, the way the docs print it and curl sends it. */
export function apiExampleJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

/**
 * The curl call for an endpoint against `apiUrl`, with the key read from
 * `$DFORMS_API_KEY`. Path parameters become shell variables (`$FORM_ID`), the
 * query parameters with an example value go through `--data-urlencode`, and a
 * body is sent as JSON in single quotes (the examples carry no apostrophe, so
 * the quoting holds).
 */
export function apiCurl(endpoint: Pick<ApiEndpoint, 'method' | 'path' | 'params' | 'body' | 'responseType'>, apiUrl: string): string {
  const base = trimTrailing(apiUrl, '/');
  const params = endpoint.params ?? [];
  let path = endpoint.path;
  for (const p of params) {
    if (p.in === 'path') path = path.replace(`:${p.name}`, p.example ?? `{${p.name}}`);
  }
  const query = params.filter((p) => p.in === 'query' && p.example !== undefined);
  const lines: string[] = [];
  const method = endpoint.method === 'GET' ? '' : ` -X ${endpoint.method}`;
  lines.push(`curl -sS${method}${query.length > 0 ? ' -G' : ''} "${base}${path}"`);
  lines.push(`  -H "Authorization: Bearer $DFORMS_API_KEY"`);
  for (const q of query) {
    const pair = `${q.name}=${q.example}`;
    lines.push(pair.includes('"') ? `  --data-urlencode '${pair}'` : `  --data-urlencode "${pair}"`);
  }
  if (endpoint.body !== undefined) {
    lines.push(`  -H "Content-Type: application/json"`);
    lines.push(`  --data '${apiExampleJson(endpoint.body)}'`);
  }
  if (endpoint.responseType === 'csv') lines.push('  -o responses.csv');
  return lines.join(' \\\n');
}

// ── Errors, limits and what a key cannot do ───────────────────────────────

/** The limits the docs state. The API's spec checks them against the API's own constants. */
export const API_LIMITS = {
  /** Requests a minute per key, then 429 `RATE_LIMITED` with `Retry-After`. */
  callsPerMinute: 120,
  /** Active keys per member per workspace, then 409 `KEY_LIMIT`. */
  activeKeysPerMember: 10,
} as const;

/** An `error` code the API answers with, and its status. The prose is `admin.apiDocs.errors.codes`. */
export type ApiErrorCode =
  | 'BAD_REQUEST'
  | 'STEPS_REQUIRED'
  | 'INVALID_API_KEY'
  | 'KEY_NOT_ALLOWED'
  | 'WORKSPACE_FORBIDDEN'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'STALE'
  | 'NOTHING_TO_REVERT'
  | 'SLUG_TAKEN'
  | 'SLUG_INVALID'
  | 'NAME_TAKEN'
  | 'RATE_LIMITED';

export const API_ERROR_CODES: readonly { status: number; code: ApiErrorCode }[] = [
  { status: 400, code: 'BAD_REQUEST' },
  { status: 400, code: 'STEPS_REQUIRED' },
  { status: 401, code: 'INVALID_API_KEY' },
  { status: 403, code: 'KEY_NOT_ALLOWED' },
  { status: 403, code: 'WORKSPACE_FORBIDDEN' },
  { status: 403, code: 'FORBIDDEN' },
  { status: 404, code: 'NOT_FOUND' },
  { status: 409, code: 'STALE' },
  { status: 409, code: 'NOTHING_TO_REVERT' },
  { status: 409, code: 'SLUG_TAKEN' },
  { status: 409, code: 'SLUG_INVALID' },
  { status: 409, code: 'NAME_TAKEN' },
  { status: 429, code: 'RATE_LIMITED' },
];

/** A `code` inside `issues[]` that is the API's own rather than the schema's. Prose: `admin.apiDocs.errors.issueCodes`. */
export type ApiIssueCode = 'UNSUPPORTED_FIELD' | 'EMPTY_QUESTION' | 'STEPS_REQUIRED';

export const API_ISSUE_CODES: readonly ApiIssueCode[] = ['UNSUPPORTED_FIELD', 'EMPTY_QUESTION', 'STEPS_REQUIRED'];

/** The body `API_EXAMPLE_ERROR` answers: a `POST /v1/forms` with these two mistakes, sent with a key. */
export const API_EXAMPLE_ERROR_REQUEST = {
  name: 'Talk to sales',
  config: {
    version: 1,
    steps: [
      { key: 'name', type: 'name', question: 'What is your name?' },
      { key: 'company', type: 'text', question: '' },
      { key: 'email', type: 'email', question: 'Your email?', buttonText: 'Next' },
    ],
  },
} as const;

/** A 400 as the API answers it: every problem, each with its dot path inside the body. */
export const API_EXAMPLE_ERROR = {
  error: 'BAD_REQUEST',
  message: 'Every step needs a question.',
  issues: [
    { path: 'config.steps.1.question', message: 'Every step needs a question.', code: 'EMPTY_QUESTION' },
    { path: 'config.steps.2.buttonText', message: 'This field has no control in the editor.', code: 'UNSUPPORTED_FIELD' },
  ],
} as const;

/** What a key may not do (each answers 403 `KEY_NOT_ALLOWED`). Prose: `admin.apiDocs.notAllowed.items`. */
export type ApiNotAllowed = 'keys' | 'members' | 'workspaces' | 'onboarding' | 'profile' | 'integrations';

export const API_NOT_ALLOWED: readonly ApiNotAllowed[] = [
  'keys',
  'members',
  'workspaces',
  'onboarding',
  'profile',
  'integrations',
];
