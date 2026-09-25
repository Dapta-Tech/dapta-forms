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
          'Body { sessionId, data, partial?, locale?, captchaToken?, hp?, visit? }. A form whose owner turned on spam protection, on a deployment that can run it, is served with a `captcha` object in its public payload; its COMPLETE submit must then carry `captchaToken`, the token the human check issued for this session, and the API verifies it before anything is written. A partial submit of such a form is saved but delivered to no destination; the verified complete delivers everything. `hp` is the hidden field of strict mode and must be empty. `visit` is the page the form was answered on, as the browser reports it: { pageUri?, pageName?, pageId?, hutk?, hsPortalId?, embedded? }, where `pageUri` is an absolute http(s) URL (the page that embeds the form, or the form\u2019s own link without its prefill parameters), `pageName` its title, `pageId` and `hsPortalId` the HubSpot page and portal ids, and `hutk` the page\u2019s HubSpot visitor cookie (32 hex characters). Each field is checked on its own and dropped when it fails its rule, so a malformed visit never refuses a submission; a later submit without a visit keeps the one already stored. The cookie is kept only when a webhook or a HubSpot form submission of this form will use it. Every error body carries a stable `error` code next to its English `message`.',
        responses: {
          '201': { description: 'Recorded' },
          '400': { description: 'Invalid (BAD_REQUEST, ANSWER_TOO_LONG)' },
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
      get: { summary: 'List forms (host)', security: [{ hostSession: [] }], responses: { '200': { description: 'Forms' } } },
      post: { summary: 'Create a form (host)', security: [{ hostSession: [] }], responses: { '201': { description: 'Created' } } },
        description:
          'Body { name, slug?, config?, folderId? }. `folderId` files the new form in one of the workspace folders (404 for a folder outside it); absent = unfiled.',
    },
    '/v1/forms/{id}': {
      get: { summary: 'Get a form (host)', security: [{ hostSession: [] }], responses: { '200': { description: 'Form' } } },
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
          'Returns { total, questions }: one entry per answering step, in form order, with how many responses answered it. Choices carry a count and percent per option (most chosen first; a multi-select can add past 100); a slider its average and distribution; text questions their five latest answers; files and bookings how many answered. Optional status (all|completed|partial) and from/to (epoch ms or YYYY-MM-DD, bound by startedAt), the same filter as the submissions table.',
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
          'Returns { id, formId, sessionId, data, score, startedAt, completedAt, partialAt, visit }. `visit` is null, or { pageUri, pageName, embedded, hubspotLinked }: the page the response was given on, whether it was embedded there, and whether a HubSpot visitor was linked to it. The visitor cookie itself is never returned. Scoped by a join on the caller\u2019s own account, so a submission id from another workspace is 404, like one that does not exist.',
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
          'Body { enabled?, subject?, body?, recipients? }. subject/body are plain text with {{token}} markers; passing null resets that field to the shipped default. recipients is the owner notice’s audience: at most 5 valid, distinct addresses, each of which receives its own copy; null means the owner inbox and [] means the owner only. It is rejected on submission_confirmed, which is addressed to the respondent. emailKey ∈ (submission_received, submission_confirmed).',
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
