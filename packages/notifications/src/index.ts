/**
 * @quill/notifications — hexagonal notifications. Callers depend on the
 * EmailProvider port; a provider is chosen by configuration (default log-only,
 * so a bare fork runs). Submission emails render via SubmissionNotifier.
 */
export * from './email.port';
export * from './factory';
export * from './submission-notifier';
export {
  normalizeLocale,
  renderSubmissionReceived,
  renderSubmissionConfirmed,
  renderMemberInvited,
  SUBMISSION_EMAIL_KEYS,
  isSubmissionEmailKey,
  NOTIFICATION_TOKENS,
  notificationTokenValues,
  interpolateTokens,
  applyCopyOverride,
  defaultSubmissionTemplate,
  type NotificationLocale,
  type ReceivedCopyVars,
  type ConfirmedCopyVars,
  type MemberInvitedCopyVars,
  type RenderedCopy,
  type SubmissionEmailKey,
  type NotificationToken,
} from './templates';
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
