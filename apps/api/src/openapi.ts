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
      put: { summary: 'Update a form (host)', security: [{ hostSession: [] }], responses: { '200': { description: 'Updated' } } },
      delete: { summary: 'Delete a form (host)', security: [{ hostSession: [] }], responses: { '204': { description: 'Deleted' } } },
    },
    '/v1/forms/{id}/publish': {
      post: {
        summary: 'Publish a pending draft config (host)',
        security: [{ hostSession: [] }],
        responses: { '200': { description: 'Published (no-op without a draft)' } },
      },
    },
  },
} as const;
