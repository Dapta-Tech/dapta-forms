/**
 * @slate/notifications — hexagonal notifications. Callers depend on the
 * EmailProvider port; a provider is chosen by configuration (default log-only,
 * so a bare fork runs). Booking emails render via BookingNotifier.
 */
export * from './email.port';
export * from './factory';
export * from './booking-notifier';
export * from './templates';
export * from './ics';
export { LogOnlyEmailProvider } from './adapters/log-only';
export { NoopEmailProvider } from './adapters/noop';
export { SmtpEmailProvider, type SmtpOptions } from './adapters/smtp';
export {
  HttpEmailProvider,
  type HttpEmailOptions,
  type HttpWireProfile,
  DEFAULT_TRANSACTIONAL_CATEGORY,
  interpretTransactionalResponse,
} from './adapters/http';
export { normalizeRecipients, formatSender } from './util';
