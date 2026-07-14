/**
 * @quill/destinations — pluggable submission destinations. Callers depend on the
 * SubmissionDestination port; a destination is chosen by configuration (default
 * log-only, so a bare fork runs). A destination NEVER crashes or blocks a
 * submission — failures are surfaced for the durable outbox to retry.
 */
export * from './destination.port';
export * from './factory';
export {
  assertPublicWebhookUrl,
  classifyIp,
  defaultDnsResolver,
  type DnsResolver,
} from './ssrf-guard';
export { LogOnlyDestination } from './adapters/log-only';
export {
  WebhookDestination,
  type WebhookDestinationOptions,
  type WebhookPayload,
  signWebhookBody,
  DEFAULT_SIGNATURE_HEADER,
  DEFAULT_WEBHOOK_TIMEOUT_MS,
  WEBHOOK_EVENT,
} from './adapters/webhook';
export {
  HubspotDestination,
  type HubspotDestinationOptions,
  extractRetryablePropertyNames,
  buildSubmissionNoteBody,
  toHubSpotDateMs,
  HUBSPOT_API_BASE,
} from './adapters/hubspot';
