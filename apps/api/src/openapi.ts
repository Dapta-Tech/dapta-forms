/**
 * Hand-curated OpenAPI 3.1 description of Slate's integrator-facing surfaces
 * (public booking + machine/agent). Dependency-free (Slate validates with zod,
 * not class-validator, so there is no decorator metadata to auto-generate from).
 * Kept intentionally focused on the endpoints external integrations consume;
 * the full route list is in API-CONTRACT.md. R15: NO vendor/internal names here
 * (asserted by openapi.spec.ts).
 */
export const openapiSpec = {
  openapi: '3.1.0',
  info: {
    title: 'Slate API',
    version: '1.0.0',
    description: 'Open-source scheduling — public booking + machine/agent surfaces.',
    license: { name: 'MIT' },
  },
  servers: [{ url: '/', description: 'This deployment' }],
  components: {
    securitySchemes: {
      // Machine/agent surface — API key.
      apiKey: { type: 'http', scheme: 'bearer', description: 'dcl_ API key (Authorization: Bearer …).' },
      // Host/dashboard surface — pluggable AuthProvider (session/JWT in prod).
      hostSession: { type: 'apiKey', in: 'header', name: 'authorization', description: 'Host session (AuthProvider).' },
    },
  },
  paths: {
    '/health': {
      get: {
        summary: 'Liveness + DB probe',
        responses: { '200': { description: 'ok | degraded' } },
      },
    },
    '/v1/availability': {
      get: {
        summary: 'Public availability (slots, seat-aware)',
        parameters: ['accountCode', 'handle', 'slug', 'from', 'to'].map((name) => ({
          name,
          in: 'query',
          required: name !== 'to',
          schema: { type: 'string' },
        })),
        responses: { '200': { description: 'Availability with slots[{startUtc,spotsLeft?,capacity?}]' } },
      },
    },
    '/v1/reservations': {
      post: {
        summary: 'Place a 10-minute hold on a slot',
        responses: {
          '201': { description: '{reservationUid,expiresAt}' },
          '400': { description: 'INVALID_SLOT' },
          '429': { description: 'RATE_LIMITED' },
        },
      },
    },
    '/v1/bookings': {
      post: {
        summary: 'Create a booking (consumes a hold; intake-validated)',
        responses: {
          '201': { description: 'BookingView (+ one-time manageUrl)' },
          '409': { description: 'SLOT_TAKEN' },
          '410': { description: 'RESERVATION_EXPIRED' },
          '400': { description: 'INTAKE_INVALID' },
        },
      },
    },
    '/v1/machine/availability': {
      get: {
        summary: 'Agent availability (60-day cap)',
        security: [{ apiKey: [] }],
        responses: { '200': { description: 'Availability' }, '403': { description: 'out-of-scope' } },
      },
    },
    '/v1/machine/bookings': {
      post: {
        summary: 'Agent create booking (attendees[]; Idempotency-Key)',
        security: [{ apiKey: [] }],
        responses: { '201': { description: '{uid,status,startUtc,endUtc}' } },
      },
      get: {
        summary: 'Agent list bookings',
        security: [{ apiKey: [] }],
        responses: { '200': { description: '{items,nextCursor}' } },
      },
    },
    '/v1/machine/bookings/{uid}': {
      patch: {
        summary: 'Agent reschedule',
        security: [{ apiKey: [] }],
        responses: { '200': { description: 'rescheduled' }, '403': { description: 'out-of-scope' } },
      },
    },
  },
} as const;
