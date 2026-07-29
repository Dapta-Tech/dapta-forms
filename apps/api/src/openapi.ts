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
    description: 'Open-source forms — public form rendering + submission surfaces.',
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
        responses: { '201': { description: 'Recorded' }, '400': { description: 'Invalid' } },
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
    '/v1/forms': {
      get: { summary: 'List forms (host)', security: [{ hostSession: [] }], responses: { '200': { description: 'Forms' } } },
      post: { summary: 'Create a form (host)', security: [{ hostSession: [] }], responses: { '201': { description: 'Created' } } },
    },
    '/v1/forms/{id}': {
      get: { summary: 'Get a form (host)', security: [{ hostSession: [] }], responses: { '200': { description: 'Form' } } },
      put: {
        summary: 'Update a form (host)',
        description:
          'name/slug apply to the live form immediately; config is stored as an unpublished draft — publish it via POST /v1/forms/{id}/publish. The public renderer keeps serving the previously published config until then.',
        security: [{ hostSession: [] }],
        responses: { '200': { description: 'Updated (config changes staged as a draft)' } },
      },
      delete: { summary: 'Delete a form (host)', security: [{ hostSession: [] }], responses: { '204': { description: 'Deleted' } } },
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
          "The account's brand kit (logo, client logos, colors, font, radius, button style) or { config: null } when none is saved. Forms snapshot the kit at creation and on an explicit apply — it is never resolved live at render.",
        security: [{ hostSession: [] }],
        responses: { '200': { description: '{ config, updatedAt }' } },
      },
      put: {
        summary: 'Save the workspace brand kit (host, admin/owner)',
        description:
          'Replaces the stored kit. Body is the brand-kit object; every field optional — absent fields leave the corresponding axis to each form.',
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
          'The two submission emails (owner notice + respondent confirmation): each carries its enabled toggle, any custom subject/body override (null = shipped default), the shipped default copy for both locales, and the available {{tokens}}.',
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
          'Body { enabled?, subject?, body? }. subject/body are plain text with {{token}} markers; passing null resets that field to the shipped default. emailKey ∈ (submission_received, submission_confirmed).',
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
          'Per email: the effective account-level template this form inherits, whether a per-form override exists, and the override values (Typeform-style per-form Follow-ups). Send-time precedence is form → account → stock, per field. The form must belong to the caller’s account.',
        security: [{ hostSession: [] }],
        responses: {
          '200': { description: '{ settings[] } — each { emailKey, account, override|null, defaults, tokens }' },
          '403': { description: 'Requires an admin or owner' },
          '404': { description: 'Form not found in this account' },
        },
      },
    },
    '/v1/forms/{id}/notifications/{emailKey}': {
      put: {
        summary: 'Create/update a form’s override for one submission email (host, admin/owner)',
        description:
          'Body { enabled?, subject?, body? } — same contract as the account-level PUT, stored against this form. While an override exists its enabled toggle wins; a null subject/body inherits that field from the account template.',
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
        summary: 'Remove a form’s override — inherit the account template again (host, admin/owner)',
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
