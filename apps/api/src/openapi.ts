/**
 * Hand-curated OpenAPI 3.1 description of Quill's integrator-facing surfaces
 * (public forms + host/dashboard). Dependency-free (Quill validates with zod,
 * not class-validator, so there is no decorator metadata to auto-generate from).
 * R15: NO vendor/internal names here.
 */
export const openapiSpec = {
  openapi: '3.1.0',
  info: {
    title: 'Quill API',
    version: '1.0.0',
    description: 'Open-source forms: public form rendering + submission surfaces.',
    license: { name: 'MIT' },
  },
  servers: [{ url: '/', description: 'This deployment' }],
  components: {
    securitySchemes: {
      hostSession: {
        type: 'apiKey',
        in: 'header',
        name: 'authorization',
        description: 'Host session (AuthProvider).',
      },
      apiKey: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'dforms_<43 base64url characters>',
        description:
          "An API key, created in dForms under MCP, API keys, sent as `Authorization: Bearer dforms_...`. It acts as the member who created it, in that member's workspace, with their current role. Works on the host routes that build and run forms: forms (create, read, edit, slug, duplicate, publish, revert, delete), folders, destinations, responses, CSV, analytics, brand kit, notifications, `GET /v1/me` and reading integrations. Any other host route (API keys, members, invitations, workspaces, onboarding, attribution, writing the profile or the public page, connecting or disconnecting integrations) answers 403 `KEY_NOT_ALLOWED`. An unknown or revoked key, or one whose member is no longer active in the workspace, answers 401 `INVALID_API_KEY`. The key fixes the workspace: an `x-quill-workspace` header naming another one answers 403 `WORKSPACE_FORBIDDEN`. Each key may make 120 calls a minute; past that, 429 `{ error: 'RATE_LIMITED', retryAfterSec }` with a `Retry-After` header.",
      },
    },
  },
  webhooks: {
    'form.submission': {
      post: {
        summary: 'A submission reached a phase (webhook destination)',
        description:
          'POSTed to each enabled webhook destination of a form, once per phase it fires on (`partial`, `complete`, or both). Headers: `X-Forms-Event`, `X-Forms-Delivery` (the idempotency key, also the body `id`), `X-Forms-Timestamp`, and, when the destination has a secret, an HMAC-SHA256 signature of the raw body, as `sha256=<hex>` (header `X-Forms-Signature` unless the destination names another). Body { id, type, phase, submittedAt, form { id, name }, submission { id, sessionId, score, outcome }, data, utm, visit?, test? }. `data` holds the answers keyed by question. `test: true` marks a test delivery (the webhook test); it is absent on every real one. A file answer is an object { key, name, size, mime, url }: `key` is the stored object key, `name` the original file name, `size` the size in bytes as a string, `mime` the type the browser declared (not verified), and `url` a permanent link that opens the file without signing in (PDFs and images in the browser, anything else as a download). `url` is absent when the deployment has no public web address or no signing key configured. Treat it as a secret: anyone holding it can open the file until the submission is deleted.',
        responses: {
          '200': { description: 'Any 2xx marks the delivery done; anything else, a timeout or a redirect is retried with backoff' },
        },
      },
    },
  },
  paths: {
    '/health': {
      get: { summary: 'Liveness + DB probe', responses: { '200': { description: 'ok | degraded' } } },
    },
    '/v1/public/forms/{accountCode}/{slug}': {
      get: {
        summary: 'Fetch a published form (public renderer config)',
        parameters: ['accountCode', 'slug'].map((name) => ({
          name,
          in: 'path',
          required: true,
          schema: { type: 'string' },
        })),
        responses: { '200': { description: 'The published form' }, '404': { description: 'Not found' } },
      },
    },
    '/v1/public/forms/{accountCode}/{slug}/submissions': {
      post: {
        summary: 'Submit answers (score recomputed server-side)',
        description:
          'Body { sessionId, data, partial?, locale?, captchaToken?, hp?, visit? }. A form whose owner turned on spam protection, on a deployment that can run it, is served with a `captcha` object in its public payload; its COMPLETE submit must then carry `captchaToken`, the token the human check issued for this session, and the API verifies it before anything is written. A partial submit of such a form is saved but delivered to no destination; the verified complete delivers everything. `hp` is the hidden field of strict mode and must be empty. `visit` is the page the form was answered on, as the browser reports it: { pageUri?, pageName?, pageId?, hutk?, hsPortalId?, embedded? }, where `pageUri` is an absolute http(s) URL (the page that embeds the form, or the form\u2019s own link without its prefill parameters), `pageName` its title, `pageId` and `hsPortalId` the HubSpot page and portal ids, and `hutk` the page\u2019s HubSpot visitor cookie (32 hex characters). Each field is checked on its own and dropped when it fails its rule, so a malformed visit never refuses a submission; a later submit without a visit keeps the one already stored. The cookie is kept only when a webhook or a HubSpot form submission of this form will use it. A COMPLETE submit (no `partial: true`) must be a response the form could have produced: every step on the path its answers took (skip logic, jumps, up to the first terminal step) is validated like the public page validates it, so a value that is not one of a choice\u2019s options or a missing required answer is refused with `INVALID_ANSWERS` and nothing is written. Steps off that path, hidden steps and extra keys are not read; partial saves are not validated. Every error body carries a stable `error` code next to its English `message`.',
        responses: {
          '201': { description: 'Recorded' },
          '400': { description: 'Invalid (BAD_REQUEST, ANSWER_TOO_LONG, INVALID_ANSWERS)' },
          '403': {
            description:
              'CAPTCHA_REQUIRED (no token on a complete submit of a protected form: refresh the page) or CAPTCHA_FAILED (the human check did not pass). Nothing is written.',
          },
          '429': { description: 'RATE_LIMITED' },
          '503': {
            description:
              'CAPTCHA_UNAVAILABLE: the human check could not be completed. The answers were kept as a partial, which is not delivered; submit again.',
          },
        },
      },
    },
    '/v1/public/forms/{accountCode}/{slug}/uploads': {
      post: {
        summary: 'Authorize one file upload (presigned)',
        description:
          'Body { sessionId, stepKey, name, size, mime }. Returns { url, key, contentType, expiresInSec }: PUT the bytes straight to `url` with that exact Content-Type header, then send `key` as the answer. Every field in the body is a claim and is checked again against the object itself on submit. 404 when the deployment stores no files, 400 for a type or size the published question does not accept, 503 when the URL cannot be signed.',
        responses: {
          '200': { description: 'Where to PUT, and what the answer must carry' },
          '400': { description: 'Invalid, or a type or size the question refuses' },
          '404': { description: 'No such form, or uploads are not enabled here' },
          '503': { description: 'UPLOAD_UNAVAILABLE' },
        },
      },
    },
    '/v1/public/files/{token}': {
      get: {
        summary: 'Resolve a permanent file link',
        description:
          'The API side of the `url` a webhook payload carries on every file answer. That link lives on the web host, as `/file/{token}`, and the web host calls this endpoint and redirects the browser (302, `Cache-Control: no-store`, `Referrer-Policy: no-referrer`) to the URL it returns. No session is needed: the token is a signed claim on one file of one submission, and holding it is the authorization. Returns { url, disposition }: `url` is a signed GET that lives a few minutes and opens PDFs and images in the browser (`disposition` inline, with a content type decided by the file extension, never by the type declared at upload) and downloads everything else under its original name (`disposition` attachment). The link itself never expires; it stops working when the submission is deleted or the deployment changes its signing key. Every miss (malformed or forged token, deleted submission, no file on that question, file storage not enabled) is the same 404. Rate limited per client like the rest of the public surface.',
        responses: {
          '200': { description: 'Where to send the browser, and how the file opens there' },
          '404': { description: 'NOT_FOUND, for every kind of miss' },
          '429': { description: 'RATE_LIMITED' },
          '503': { description: 'UPLOAD_UNAVAILABLE' },
        },
      },
    },
    '/v1/public/forms/{accountCode}/{slug}/events': {
      post: {
        summary: 'Record a funnel event',
        responses: { '202': { description: 'Accepted' } },
      },
    },
    '/v1/public/forms/{accountCode}/{slug}/booking': {
      post: {
        summary: 'Record a scheduling callback (meeting booked)',
        responses: { '202': { description: 'Accepted' }, '400': { description: 'Invalid' } },
      },
    },
    '/v1/public/pages/{accountCode}': {
      get: {
        summary: 'Fetch a workspace link page (public)',
        description:
          'Body { accountCode, name, bio, logo, buttons: [{ type: "form", label, slug } | { type: "link", label, url }], socials: [{ network, href }], branding }. 404 until someone in the workspace publishes the page. Buttons keep the order the workspace chose; a deleted form drops out. Only the social networks the workspace filled in are listed.',
        parameters: [{ name: 'accountCode', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'The published page' }, '404': { description: 'Not found' } },
      },
    },
    '/v1/public/pages/{accountCode}/events': {
      post: {
        summary: 'Record a view of a link page, or a click on one of its links',
        description:
          'Body { type: "view" } or { type: "click", linkType: "form" | "link" | "social", position?, network?, slug? }. Product analytics only: nothing about the visitor is recorded. 404 when the page is not published.',
        parameters: [{ name: 'accountCode', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '202': { description: 'Accepted' }, '400': { description: 'Invalid' }, '404': { description: 'Not found' } },
      },
    },
    '/v1/public/pages/{accountCode}/{slug}': {
      get: {
        summary: 'Fetch one of a workspace\'s other link pages (public)',
        description:
          'The page served at /{accountCode}/p/{slug}, in the same body as the default page, plus `pageSlug` (the page\'s CURRENT slug: a retired slug answers the page that used to have it, so the caller can redirect) and `isDefault`. Slugs are matched without regard to case. 404 for an unknown slug and for a page that is not published.',
        parameters: [
          { name: 'accountCode', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'slug', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: { '200': { description: 'The published page' }, '404': { description: 'Not found' } },
      },
    },
    '/v1/public/pages/{accountCode}/{slug}/events': {
      post: {
        summary: 'Record a view of, or a click on, one of a workspace\'s other link pages',
        description: 'Same body as /v1/public/pages/{accountCode}/events. The capture carries `page_slug` and `page_id`.',
        parameters: [
          { name: 'accountCode', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'slug', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: { '202': { description: 'Accepted' }, '400': { description: 'Invalid' }, '404': { description: 'Not found' } },
      },
    },
    '/v1/link-page': {
      get: {
        summary: 'Read the workspace default link page',
        description:
          'Body { id, slug, name, isDefault, accountCode, accountName, page, forms: [{ id, slug, name, title }], brandKit, publicUrl, live }. The DEFAULT page, the one at /{accountCode}, as when a workspace had a single page; `page` (and `id`, `slug`, `name`) is null until one is saved. Any member of the workspace may call it.',
        security: [{ hostSession: [] }],
        responses: { '200': { description: 'The page and what the editor needs' } },
      },
      put: {
        summary: 'Replace the workspace default link page',
        description:
          'Body { page: { version: 1, enabled, name?, bio?, logo?, items?: [{ type: "form", formId } | { type: "link", label, url }], socials?: { instagram?, x?, youtube?, tiktok?, whatsapp? } } | null }. Socials are normalized to https links on their own network (a handle such as @yourbrand works too). WhatsApp must carry its country code, starting with + or 00 (a number without it is refused), and is stored as digits. `logo` absent uses the brand kit logo, null shows none. `colors?: { primaryColor?, background?, foreground? }` (hex) override the brand kit for this page. Writes the DEFAULT page, creating it as `main` when the workspace has none. `{ page: null }` removes it when it is the workspace\'s only page, else 409 DEFAULT_PAGE. Form buttons for forms outside the workspace are dropped. Any member of the workspace may call it.',
        security: [{ hostSession: [] }],
        responses: { '200': { description: 'Saved' }, '400': { description: 'BAD_REQUEST with issues' } },
      },
    },
    '/v1/link-pages': {
      get: {
        summary: 'List the workspace link pages',
        description:
          'Body { accountCode, max, pages: [{ id, slug, name, isDefault, live, buttons, createdAt, updatedAt, publicUrl }] }, the default page first. A workspace keeps up to `max` (20) pages. Any member of the workspace may call it.',
        security: [{ hostSession: [] }],
        responses: { '200': { description: 'The pages' } },
      },
      post: {
        summary: 'Add a link page',
        description:
          'Body { name?, slug?, page? }. `slug` follows the vanity rules (3 to 30 lowercase letters, digits or single hyphens, not a reserved word) and is unique in the workspace; absent, one is made from the name. `page` is the same content PUT /v1/link-page takes; absent, the page starts empty and unpublished. The workspace\'s first page becomes its default. Answers the page as GET /v1/link-pages/{id} does. 409 SLUG_TAKEN, 409 PAGE_LIMIT past 20 pages.',
        security: [{ hostSession: [] }],
        responses: {
          '201': { description: 'Created' },
          '400': { description: 'BAD_REQUEST with issues' },
          '409': { description: 'SLUG_TAKEN or PAGE_LIMIT' },
        },
      },
    },
    '/v1/link-pages/{id}': {
      get: {
        summary: 'Read one link page',
        description:
          'Body { id, slug, name, isDefault, createdAt, updatedAt, accountCode, accountName, page, forms, brandKit, publicUrl, live }. 404 for an id outside the workspace.',
        security: [{ hostSession: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'The page' }, '404': { description: 'Not found' } },
      },
      put: {
        summary: 'Change a link page',
        description:
          'Body { name?, slug?, isDefault?: true, page? }: only the fields sent change, and `page` replaces the whole content. A new slug keeps the old one redirecting to it. `isDefault: true` makes this the page at /{accountCode}; there is no false (make another page the default instead).',
        security: [{ hostSession: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': { description: 'Saved' },
          '400': { description: 'BAD_REQUEST with issues' },
          '404': { description: 'Not found' },
          '409': { description: 'SLUG_TAKEN' },
        },
      },
      delete: {
        summary: 'Delete a link page',
        description: 'Body { ok, id, slug }. The default page answers 409 DEFAULT_PAGE: make another page the default first.',
        security: [{ hostSession: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Deleted' }, '404': { description: 'Not found' }, '409': { description: 'DEFAULT_PAGE' } },
      },
    },
    '/v1/link-pages/{id}/duplicate': {
      post: {
        summary: 'Duplicate a link page',
        description:
          'Body { name?, slug? }. The copy has the same content, switched off, never the default, under the given slug or the original\'s with -2, -3 and so on. Answers the copy as GET /v1/link-pages/{id} does.',
        security: [{ hostSession: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '201': { description: 'Created' }, '404': { description: 'Not found' }, '409': { description: 'SLUG_TAKEN or PAGE_LIMIT' } },
      },
    },
    '/v1/api-keys': {
      get: {
        summary: 'List API keys (host session only)',
        description:
          'Body { keys: [{ id, name, last4, createdAt, lastUsedAt, createdBy: { memberId, name, email, staff } }] }. A member sees their own keys; an owner or admin sees every active key of the workspace, including keys the deployment\'s staff created there through staff access (`createdBy.staff: true`). Revoked keys, and keys of members who are not active, are never listed, and the key itself never appears. Disabling or removing a member revokes their keys for good: reactivating them does not bring the keys back. 403 `KEY_NOT_ALLOWED` when called with an API key.',
        security: [{ hostSession: [] }],
        responses: { '200': { description: 'Keys' }, '403': { description: 'KEY_NOT_ALLOWED' } },
      },
      post: {
        summary: 'Create an API key (host session only)',
        description:
          'Body { name } (1 to 60 characters). Answers 201 { id, name, last4, createdAt, key }: the only response that ever carries the full key, so store it then. A person may hold 10 active keys per workspace; the 11th answers 409 `KEY_LIMIT`. The deployment\'s staff, while in the workspace through staff access, may create keys too: such a key acts as an admin of that workspace and keeps working until someone revokes it, even after its creator stops being staff.',
        security: [{ hostSession: [] }],
        responses: {
          '201': { description: 'Created, with the key in clear' },
          '400': { description: 'Invalid name' },
          '403': { description: 'KEY_NOT_ALLOWED' },
          '409': { description: 'KEY_LIMIT' },
        },
      },
    },
    '/v1/api-keys/{id}': {
      delete: {
        summary: 'Revoke an API key (host session only)',
        description:
          'The key stops working on the next call. A member may revoke their own keys; an owner or admin, any key of the workspace.',
        security: [{ hostSession: [] }],
        responses: {
          '204': { description: 'Revoked' },
          '403': { description: "Someone else's key without being owner or admin, or KEY_NOT_ALLOWED" },
          '404': { description: 'Unknown, already revoked, or another workspace' },
        },
      },
    },
    '/v1/me/locale': {
      put: {
        summary: 'Set the language you read the product in (host)',
        description:
          "Body { locale }: 'en' or 'es'. Scoped to the caller's own membership, so it is not admin-gated and cannot change a teammate's. Stored on the member row, which is also what selects the language of the submission notification emails this account sends. The web app additionally keeps a cookie, which is what its pages render from.",
        security: [{ hostSession: [] }],
        responses: {
          '200': { description: 'Stored' },
          '400': { description: 'Not a supported locale' },
        },
      },
    },
    '/v1/forms': {
      get: {
        summary: 'List forms (host)',
        description:
          'Each item is { id, name, slug, brandAppliedAt, folderId, hasDraft, createdAt, updatedAt, publicUrl, editorUrl }. `hasDraft` is true while the form holds edits that have not been published; the public form keeps serving the last published config until then. `publicUrl` is the form\u2019s public link (the same one the dashboard copies, with the workspace\u2019s current code and the form\u2019s current slug) and `editorUrl` opens it in the builder; both are absolute URLs on PUBLIC_APP_URL, and null when the deployment does not set it. Every route that returns a form (create, get, update, slug, duplicate, publish) carries the same two fields.',
        security: [{ hostSession: [] }],
        responses: { '200': { description: 'Forms' } },
      },
      post: { summary: 'Create a form (host)', security: [{ hostSession: [] }], responses: { '201': { description: 'Created' } } },
        description:
          'Body { name, slug?, config?, folderId? }. `folderId` files the new form in one of the workspace folders (404 for a folder outside it); absent = unfiled.',
    },
    '/v1/forms/{id}': {
      get: {
        summary: 'Get a form (host)',
        description:
          'The form, with `publicUrl` (its public link) and `editorUrl` (its builder). Both are absolute URLs on PUBLIC_APP_URL and follow a slug rename; both are null when the deployment does not set PUBLIC_APP_URL.',
        security: [{ hostSession: [] }],
        responses: { '200': { description: 'Form' } },
      },
      put: {
        summary: 'Update a form (host)',
        description:
          'name/slug apply to the live form immediately; config is stored as an unpublished draft: publish it via POST /v1/forms/{id}/publish. The public renderer keeps serving the previously published config until then. A slug sent here is renamed through the same code as PUT /v1/forms/{id}/slug, retiring the previous one so shared links keep working, but keeps this endpoint\u2019s older, lenient contract: the value is slugified rather than rejected. It is applied before name and config, so a refused slug leaves the form untouched.',
        security: [{ hostSession: [] }],
        responses: { '200': { description: 'Updated (config changes staged as a draft)' } },
      },
      delete: { summary: 'Delete a form (host)', security: [{ hostSession: [] }], responses: { '204': { description: 'Deleted' } } },
    },
    '/v1/forms/{id}/slug': {
      put: {
        summary: "Rename a form's public URL (host)",
        description:
          'Body { slug }. Applies to the live form immediately. The previous slug is retired, not dropped: it keeps resolving, and the public page sends visitors on to the new URL (a client-side redirect, plus a canonical link tag for non-browser clients), so links already shared stay valid. 409 SLUG_TAKEN when another form in the account holds it (as its current slug or as one it retired), 409 SLUG_INVALID when the shape is wrong (lowercase letters, digits and single hyphens, up to 80 characters).',
        security: [{ hostSession: [] }],
        responses: {
          '200': { description: 'Renamed' },
          '404': { description: 'No such form in this account' },
          '409': { description: 'SLUG_TAKEN or SLUG_INVALID' },
        },
      },
    },
    '/v1/forms/{id}/submissions/{submissionId}/files/{stepKey}': {
      get: {
        summary: 'Open one uploaded file on one submission (host)',
        description:
          'Returns { name, size, kind, url, previewUrl }. `url` downloads; `previewUrl` is present only for a type the API judged safe to render in place, and `kind` names the viewer. Both are signed and expire in minutes. Scoped by a join on the caller own account, so a submission id from another workspace is 404 rather than a working link.',
        security: [{ hostSession: [] }],
        responses: {
          '200': { description: 'Short-lived URLs for that file' },
          '404': { description: 'No such submission in this workspace, or no file on that question' },
          '503': { description: 'UPLOAD_UNAVAILABLE' },
        },
      },
    },
    '/v1/forms/{id}/summary': {
      get: {
        summary: "A form's responses summarized question by question (host)",
        description:
          'Returns { total, questions }: one entry per answering step, in form order, with how many responses answered it. Choices carry a count and percent per option (most chosen first; a multi-select can add past 100); a slider its average and distribution; text questions their five latest answers; files and bookings how many answered. Optional status (all|completed|partial), from/to (epoch ms or YYYY-MM-DD, bound by startedAt) and search (text looked for in the written answers: text, contact and URL questions, ignoring case), the same filter as the submissions table and its CSV export.',
        security: [{ hostSession: [] }],
        responses: { '200': { description: 'The summary' }, '404': { description: 'No such form in this account' } },
      },
    },
    '/v1/forms/{id}/summary/{stepKey}/answers': {
      get: {
        summary: "Search one text question's answers (host)",
        description:
          'Returns { items, total, limit, offset }, newest first; each item is { id, text, respondent, at }. `q` matches anywhere in the answer, ignoring case but not accents; blank lists every answer. Optional limit (up to 50), offset, and the same status/from/to filter as the summary.',
        security: [{ hostSession: [] }],
        responses: {
          '200': { description: 'A page of matching answers' },
          '404': { description: 'No such form in this account, or not a text question of it' },
        },
      },
    },
    '/v1/forms/{id}/submissions/{submissionId}': {
      get: {
        summary: 'Get one submission in full (host)',
        description:
          'Returns { id, formId, sessionId, data, score, startedAt, completedAt, partialAt, visit }. `visit` is null, or { pageUri, pageName, embedded, hubspotCookie }: the page the response was given on, whether it was embedded there, and whether the visitor\u2019s HubSpot tracking cookie arrived with the response. The cookie itself is never returned, and `hubspotCookie` does not mean HubSpot accepted the visit: that is decided when the submission is posted to HubSpot. Scoped by a join on the caller\u2019s own account, so a submission id from another workspace is 404, like one that does not exist.',
        security: [{ hostSession: [] }],
        responses: { '200': { description: 'The submission' }, '404': { description: 'No such submission on this form in this workspace' } },
      },
    },
    '/v1/folders': {
      get: {
        summary: "The workspace's form folders, alphabetically (host)",
        security: [{ hostSession: [] }],
        responses: { '200': { description: 'Array of { id, name, createdAt, updatedAt }' } },
      },
      post: {
        summary: 'Create a form folder (host)',
        description:
          'Body { name } (1 to 80 characters, trimmed). Folders are flat and named only; a name is unique per workspace without regard to case. Any active member may create one, the same rule as creating a form.',
        security: [{ hostSession: [] }],
        responses: {
          '201': { description: 'Created' },
          '409': { description: 'NAME_TAKEN' },
        },
      },
    },
    '/v1/folders/{id}': {
      patch: {
        summary: 'Rename a form folder (host)',
        description: 'Body { name }. 404 for a folder of another workspace, 409 NAME_TAKEN on a clash.',
        security: [{ hostSession: [] }],
        responses: {
          '200': { description: 'Renamed' },
          '404': { description: 'No such folder in this workspace' },
          '409': { description: 'NAME_TAKEN' },
        },
      },
      delete: {
        summary: 'Delete a form folder (host)',
        description: 'The forms inside are unfiled, never deleted. Idempotent: deleting an absent folder is still 204.',
        security: [{ hostSession: [] }],
        responses: { '204': { description: 'Deleted (or already gone)' } },
      },
    },
    '/v1/forms/{id}/folder': {
      patch: {
        summary: 'Move a form into a folder, or unfile it (host)',
        description:
          'Body { folderId } where null unfiles. The key is required. 404 when the form or the folder is not in this workspace. The form\'s updated_at is untouched.',
        security: [{ hostSession: [] }],
        responses: {
          '200': { description: '{ id, folderId }' },
          '404': { description: 'No such form or folder in this workspace' },
        },
      },
    },
    '/v1/forms/{id}/publish': {
      post: {
        summary: 'Publish a pending draft config (host)',
        security: [{ hostSession: [] }],
        responses: { '200': { description: 'Published (no-op without a draft)' } },
      },
    },
    '/v1/forms/{id}/discard-draft': {
      post: {
        summary: 'Throw away the pending draft (host)',
        description:
          'Body { expectedUpdatedAt? }. Drops the unpublished draft, so the editor and the next publish start from the live config again. The live config, the version kept for a revert and the publish dates do not change. A no-op without a draft. Allowed with an API key.',
        security: [{ hostSession: [] }],
        responses: {
          '200': { description: 'The form, with draftConfig null' },
          '404': { description: 'No such form in this workspace' },
          '409': { description: 'STALE: the form was saved after expectedUpdatedAt' },
        },
      },
    },
    '/v1/forms/{id}/revert': {
      post: {
        summary: 'Put the previously published version back live (host)',
        description:
          'Every publish keeps the config it replaces. This swaps the two: the previous version goes live again and the one it replaced becomes the previous, so a second revert undoes the first. The destinations the form has now are kept, and a pending draft is not touched. The answer is the form, with `previousPublishedAt` (epoch-ms of when the version a revert would bring back went live, or null when there is none). Allowed with an API key.',
        security: [{ hostSession: [] }],
        responses: {
          '200': { description: 'The form with the reverted config live' },
          '404': { description: 'No such form in this workspace' },
          '409': { description: 'NOTHING_TO_REVERT: the form was never published over an earlier version' },
        },
      },
    },
    '/v1/branding': {
      get: {
        summary: "The workspace brand kit (host)",
        description:
          "The account's brand kit (logo, client logos, colors, font, radius, button style) or { config: null } when none is saved. Forms snapshot the kit at creation and on an explicit apply. It is never resolved live at render.",
        security: [{ hostSession: [] }],
        responses: { '200': { description: '{ config, updatedAt }' } },
      },
      put: {
        summary: 'Save the workspace brand kit (host, admin/owner)',
        description:
          'Replaces the stored kit. Body is the brand-kit object; every field optional: absent fields leave the corresponding axis to each form.',
        security: [{ hostSession: [] }],
        responses: {
          '200': { description: '{ config, updatedAt }' },
          '403': { description: 'Requires an admin or owner' },
        },
      },
    },
    '/v1/branding/apply': {
      post: {
        summary: 'Apply the brand kit to forms (host, admin/owner)',
        description:
          "Body { formIds: string[] }. Snapshot-merges the kit's fields into each form's live config.branding (and a pending draft, so publishing cannot silently undo the brand). The previous branding is kept in a per-form backup, making the apply reversible via /v1/branding/revert. Affects PUBLISHED forms immediately.",
        security: [{ hostSession: [] }],
        responses: {
          '200': { description: '{ applied: string[] }' },
          '403': { description: 'Requires an admin or owner' },
        },
      },
    },
    '/v1/branding/revert': {
      post: {
        summary: 'Undo the last brand-kit apply on forms (host, admin/owner)',
        description:
          'Body { formIds: string[] }. Restores the kit-managed branding fields from each form\'s backup (one level of undo). Forms without a pending apply are skipped.',
        security: [{ hostSession: [] }],
        responses: {
          '200': { description: '{ reverted: string[] }' },
          '403': { description: 'Requires an admin or owner' },
        },
      },
    },
    '/v1/notifications': {
      get: {
        summary: "List the account's submission-email settings (host, admin/owner)",
        description:
          'The two submission emails (owner notice + respondent confirmation): each carries its enabled toggle, any custom subject/body override (null = shipped default), the recipient list on the owner notice (null = the owner inbox, [] = the owner only), the shipped default copy for both locales, and the available {{tokens}}.',
        security: [{ hostSession: [] }],
        responses: {
          '200': { description: '{ settings[] }' },
          '403': { description: 'Requires an admin or owner' },
        },
      },
    },
    '/v1/notifications/{emailKey}': {
      put: {
        summary: 'Toggle or override one submission email (host, admin/owner)',
        description:
          'Body { enabled?, subject?, body?, recipients? }. subject/body are plain text with {{token}} markers; passing null resets that field to the shipped default. recipients is the owner notice’s audience: at most 5 valid, distinct addresses, each of which receives its own copy; null and [] both mean the workspace owner, or its oldest admin when no owner has an email (staff access never counts); with nobody to address, the notice is recorded as a skipped delivery with the reason. It is rejected on submission_confirmed, which is addressed to the respondent. emailKey ∈ (submission_received, submission_confirmed).',
        parameters: [
          {
            name: 'emailKey',
            in: 'path',
            required: true,
            schema: { type: 'string', enum: ['submission_received', 'submission_confirmed'] },
          },
        ],
        security: [{ hostSession: [] }],
        responses: {
          '200': { description: 'Updated setting (with defaults + tokens)' },
          '400': { description: 'Unknown email key or invalid body' },
          '403': { description: 'Requires an admin or owner' },
        },
      },
    },
    '/v1/notifications/{emailKey}/reset': {
      post: {
        summary: "Reset one submission email's subject+body to default (host, admin/owner)",
        description: 'Clears the custom subject/body (keeps the enabled toggle unchanged).',
        parameters: [
          {
            name: 'emailKey',
            in: 'path',
            required: true,
            schema: { type: 'string', enum: ['submission_received', 'submission_confirmed'] },
          },
        ],
        security: [{ hostSession: [] }],
        responses: {
          '200': { description: 'Reset setting (with defaults + tokens)' },
          '400': { description: 'Unknown email key' },
          '403': { description: 'Requires an admin or owner' },
        },
      },
    },
    '/v1/forms/{id}/notifications': {
      get: {
        summary: "List a form's submission-email settings (host, admin/owner)",
        description:
          'Per email: the effective account-level template this form inherits, whether a per-form override exists, and the override values (Typeform-style per-form Follow-ups). Send-time precedence is form → account → stock, per field, recipients included. The form must belong to the caller’s account.',
        security: [{ hostSession: [] }],
        responses: {
          '200': { description: '{ settings[] }: each { emailKey, account, override|null, defaults, tokens }' },
          '403': { description: 'Requires an admin or owner' },
          '404': { description: 'Form not found in this account' },
        },
      },
    },
    '/v1/forms/{id}/notifications/{emailKey}': {
      put: {
        summary: 'Create/update a form’s override for one submission email (host, admin/owner)',
        description:
          'Body { enabled?, subject?, body?, recipients? }: same contract as the account-level PUT, stored against this form. While an override exists its enabled toggle wins; a null subject/body/recipients inherits that field from the account template, while an empty recipients list deliberately stops inheriting and notifies the owner only.',
        parameters: [
          {
            name: 'emailKey',
            in: 'path',
            required: true,
            schema: { type: 'string', enum: ['submission_received', 'submission_confirmed'] },
          },
        ],
        security: [{ hostSession: [] }],
        responses: {
          '200': { description: 'Updated per-form setting (account baseline + override)' },
          '400': { description: 'Unknown email key or invalid body' },
          '403': { description: 'Requires an admin or owner' },
          '404': { description: 'Form not found in this account' },
        },
      },
    },
    '/v1/forms/{id}/notifications/{emailKey}/reset': {
      post: {
        summary: 'Remove a form’s override: inherit the account template again (host, admin/owner)',
        description: 'Deletes the per-form row entirely (copy AND toggle revert to the account setting).',
        parameters: [
          {
            name: 'emailKey',
            in: 'path',
            required: true,
            schema: { type: 'string', enum: ['submission_received', 'submission_confirmed'] },
          },
        ],
        security: [{ hostSession: [] }],
        responses: {
          '200': { description: 'Setting with override = null' },
          '400': { description: 'Unknown email key' },
          '403': { description: 'Requires an admin or owner' },
          '404': { description: 'Form not found in this account' },
        },
      },
    },
    '/v1/integrations': {
      get: {
        summary: "List this account's integration connections + encryption availability (host)",
        description:
          'Token-free: each connection reports provider, last4, and a display label only. `encryptionAvailable` reflects whether the server encryption key is configured (connect requires it).',
        security: [{ hostSession: [] }],
        responses: { '200': { description: '{ encryptionAvailable, providers[] }' } },
      },
    },
    '/v1/integrations/webhooks': {
      get: {
        summary: "Inventory of every webhook destination across this account's forms (host)",
        description:
          'A read-only projection, one entry per webhook: which form owns it, the endpoint, whether it is enabled, which submission phases it fires on (absent triggers mean both), whether a signing secret is set, and a per-form rollup of deliveries that ended without landing. The secret itself is never selected, so no masking applies. Editing stays on the form.',
        security: [{ hostSession: [] }],
        responses: { '200': { description: '{ items[] }' } },
      },
    },
    '/v1/integrations/{provider}/connect': {
      post: {
        summary: 'Connect a provider by pasted token (host, admin/owner)',
        description:
          'The token is validated against the provider (HubSpot / Calendly) before being stored encrypted at rest, then a display label is derived from the response. Returns the token-free status. The token is never echoed back.',
        parameters: [
          {
            name: 'provider',
            in: 'path',
            required: true,
            schema: { type: 'string', enum: ['hubspot', 'calendly'] },
          },
        ],
        security: [{ hostSession: [] }],
        responses: {
          '200': { description: 'Connected (token-free status)' },
          '400': {
            description:
              'Unknown provider, missing token, server encryption key not configured, or the token was rejected by the provider',
          },
          '403': { description: 'Requires an admin or owner' },
        },
      },
    },
    '/v1/integrations/{provider}': {
      delete: {
        summary: 'Disconnect a provider for this account (host, admin/owner)',
        parameters: [
          {
            name: 'provider',
            in: 'path',
            required: true,
            schema: { type: 'string', enum: ['hubspot', 'calendly'] },
          },
        ],
        security: [{ hostSession: [] }],
        responses: {
          '204': { description: 'Disconnected (idempotent)' },
          '403': { description: 'Requires an admin or owner' },
        },
      },
    },
  },
} as const;
