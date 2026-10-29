'use client';

import { Fragment, useMemo } from 'react';
import { BrandMark } from '@/components/brand/brand';
import { Modal } from '@/components/modal';
import {
  interpolate,
  mockBodyLines,
  NOTIFICATION_SAMPLE as SAMPLE,
  NOTIFICATION_SAMPLE_ANSWERS as ANSWERS,
} from '@/lib/notification-preview';
import { PRODUCT_NAME } from '@/lib/product-name';
import { getMessages } from '@quill/shared';
import { clientLocale } from '@/lib/client-locale';
import { signupHref } from '@/lib/growth';

export interface NotificationMockLabels {
  title: string;
  inbox: string;
  toMe: string;
  justNow: string;
  reply: string;
  forward: string;
  close: string;
  note: string;
}

/*
 * A mock of an inbox, so an author can see the email the way the person who
 * receives it will: a subject line, a sender, and the message on the grey page
 * an HTML email draws itself on.
 *
 * Its colours are literals, not tokens, on purpose. This draws somebody else's
 * window (an email app is light whatever theme the dashboard is in) and, inside
 * it, the email document, whose palette is fixed in the notifications package
 * (`emailDocument` and `answersTableHtml` in `render-html.ts`). Following the
 * dashboard's theme would make the preview say something the inbox never does.
 * No third-party logo is drawn: the structure of an inbox is enough.
 */
const INK = '#202124';
const MUTED = '#5f6368';
const RULE = '#e0e0e0';
const EMAIL_FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
/** The email document's own palette (`render-html.ts`), mirrored literally. */
const EMAIL = {
  canvas: '#f4f5f7',
  ink: '#1a1a1c',
  muted: '#6b7280',
  accent: '#3ddc84',
  onAccent: '#0b2e1a',
  link: '#0e7a3f',
  hairline: '#e7e8ec',
};
/** The wordmark the email header loads (`EMAIL_LOGO_PATH`), served by this app. */
const EMAIL_LOGO = '/email/dforms-wordmark.png';

/** Inbox chrome icons: decorative, so every one is hidden from assistive tech. */
function ToolIcon({ name }: { name: string }) {
  return <i aria-hidden className={`pi pi-${name}`} style={{ fontSize: 16, color: MUTED }} />;
}

export function NotificationEmailMock({
  open,
  onClose,
  subject,
  body,
  labels,
}: {
  open: boolean;
  onClose: () => void;
  /** The raw subject template, with its `{{tokens}}`. */
  subject: string;
  /** The raw body template. */
  body: string;
  labels: NotificationMockLabels;
}) {
  const lines = useMemo(() => mockBodyLines(body, SAMPLE), [body]);
  const renderedSubject = useMemo(() => interpolate(subject, SAMPLE), [subject]);
  // The growth button the email carries under its card, by the badge's rule:
  // only when this deployment has the loop on. Its copy is the dashboard's
  // language here; the real email uses the respondent's.
  const ctaOn = signupHref('email-receipt') !== null;
  const growth = getMessages(clientLocale()).growth;

  return (
    <Modal open={open} onClose={onClose} title={labels.title} labelId="email-mock-title" size="xl">
      {/* The dialog has no height limit of its own, so the window scrolls inside
          it: on a phone, or a short laptop, the title and Close stay in reach. */}
      <div className="max-h-[calc(100dvh-12rem)] overflow-y-auto rounded-xl">
        <div
          data-testid="email-mock"
          className="overflow-hidden rounded-xl border"
          style={{ background: '#ffffff', borderColor: RULE, color: INK }}
        >
          {/* Toolbar: back and the usual message actions. */}
          <div className="flex h-12 items-center gap-5 border-b px-4" style={{ borderColor: RULE }}>
            <ToolIcon name="arrow-left" />
            <ToolIcon name="inbox" />
            <ToolIcon name="trash" />
            <ToolIcon name="envelope" />
            <span className="ml-auto">
              <ToolIcon name="ellipsis-v" />
            </span>
          </div>

          <div className="px-4 pb-6 pt-5 sm:px-6">
            {/* Subject, with the label an inbox files it under. */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <h3
                data-testid="email-mock-subject"
                className="min-w-0 text-[22px] font-normal leading-7 [overflow-wrap:anywhere]"
              >
                {renderedSubject}
              </h3>
              <span
                className="shrink-0 rounded px-1.5 py-0.5 text-xs"
                style={{ background: '#e8eaed', color: MUTED }}
              >
                {labels.inbox}
              </span>
            </div>

            {/* Sender row. */}
            <div className="mt-5 flex items-start gap-3">
              <span
                aria-hidden
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
                style={{ background: '#f1f3f4' }}
              >
                <BrandMark className="h-5 w-5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{PRODUCT_NAME}</p>
                <p className="text-xs" style={{ color: MUTED }}>
                  {labels.toMe}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-4">
                <span className="text-xs" style={{ color: MUTED }}>
                  {labels.justNow}
                </span>
                <ToolIcon name="star" />
                <ToolIcon name="ellipsis-v" />
              </div>
            </div>

            {/* The message: the email document on its own grey page. */}
            <div className="mt-4 sm:pl-[52px]">
              <div className="rounded-lg px-3 py-6" style={{ background: EMAIL.canvas }}>
                <div
                  className="mx-auto max-w-[600px] overflow-hidden rounded-2xl border bg-white"
                  style={{ borderColor: EMAIL.hairline }}
                >
                  {/* Brand accent bar and wordmark, as the email's header draws them. */}
                  <div aria-hidden style={{ height: 4, background: EMAIL.accent }} />
                  <div className="px-5 pt-7 sm:px-8">
                    <img src={EMAIL_LOGO} alt="dForms" width={148} height={36} style={{ display: 'block', height: 36, width: 148 }} />
                  </div>
                  <div
                    data-testid="email-mock-body"
                    className="px-5 pb-8 pt-6 sm:px-8"
                    style={{
                      fontFamily: EMAIL_FONT,
                      fontSize: 16,
                      lineHeight: 1.6,
                      color: EMAIL.ink,
                      wordBreak: 'break-word',
                      overflowWrap: 'anywhere',
                    }}
                  >
                  {lines.map((segments, i) => (
                    <Fragment key={i}>
                      {i > 0 ? <br /> : null}
                      {segments.map((segment, j) =>
                        segment.kind === 'text' ? (
                          <Fragment key={j}>{segment.text}</Fragment>
                        ) : segment.kind === 'link' ? (
                          // Drawn, not followed: a preview is not the place to leave Settings.
                          <span
                            key={j}
                            data-testid="email-mock-link"
                            style={{ color: EMAIL.link, fontWeight: 600, textDecoration: 'underline', wordBreak: 'break-all' }}
                          >
                            {segment.href}
                          </span>
                        ) : (
                          <table
                            key={j}
                            role="presentation"
                            data-testid="email-mock-answers"
                            style={{
                              width: '100%',
                              borderCollapse: 'collapse',
                              margin: '16px 0',
                              borderTop: `1px solid ${EMAIL.hairline}`,
                              borderBottom: `1px solid ${EMAIL.hairline}`,
                            }}
                          >
                            <tbody>
                              {ANSWERS.map((row, r) => (
                                <tr key={row.label}>
                                  <td
                                    style={{
                                      borderTop: r === 0 ? undefined : `1px solid ${EMAIL.hairline}`,
                                      padding: '10px 12px 10px 0',
                                      verticalAlign: 'top',
                                      width: '40%',
                                      color: EMAIL.muted,
                                      fontSize: 13,
                                      lineHeight: 1.45,
                                      wordBreak: 'break-word',
                                    }}
                                  >
                                    {row.label}
                                  </td>
                                  <td
                                    style={{
                                      borderTop: r === 0 ? undefined : `1px solid ${EMAIL.hairline}`,
                                      padding: '10px 0',
                                      verticalAlign: 'top',
                                      color: EMAIL.ink,
                                      fontSize: 14,
                                      fontWeight: 500,
                                      lineHeight: 1.45,
                                      wordBreak: 'break-word',
                                      whiteSpace: 'pre-wrap',
                                    }}
                                  >
                                    {row.value}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        ),
                      )}
                    </Fragment>
                  ))}
                  </div>
                  {ctaOn ? (
                    <div
                      data-testid="email-mock-cta"
                      className="px-5 pb-7 pt-6 text-center sm:px-8"
                      style={{ borderTop: `1px solid ${EMAIL.hairline}`, fontFamily: EMAIL_FONT }}
                    >
                      <p style={{ margin: '0 0 14px', fontSize: 14, lineHeight: 1.5, color: EMAIL.muted }}>{growth.ctaQuestion}</p>
                      <span
                        style={{
                          display: 'inline-block',
                          padding: '12px 26px',
                          borderRadius: 10,
                          background: EMAIL.accent,
                          color: EMAIL.onAccent,
                          fontSize: 15,
                          fontWeight: 700,
                          lineHeight: 1.2,
                        }}
                      >
                        {growth.emailCtaAction}
                      </span>
                    </div>
                  ) : null}
                </div>
              </div>

              {/* Reply and Forward: drawn, not wired. */}
              <div aria-hidden className="mt-5 flex gap-3">
                {[labels.reply, labels.forward].map((label) => (
                  <span
                    key={label}
                    className="inline-flex h-9 items-center rounded-full border px-5 text-sm"
                    style={{ borderColor: '#dadce0', color: MUTED }}
                  >
                    {label}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-4 flex items-start justify-between gap-4">
        <p className="min-w-0 text-xs text-muted-foreground">{labels.note}</p>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded-full bg-muted px-4 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {labels.close}
        </button>
      </div>
    </Modal>
  );
}
