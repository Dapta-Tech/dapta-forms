'use client';

import { useMemo, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { interpolate, NOTIFICATION_SAMPLE as SAMPLE } from '@/lib/notification-preview';

/**
 * The editable fields for ONE notification email — enable toggle, subject,
 * body, {{token}} chips (caret-aware insertion) and the live sample preview.
 * Extracted from Settings → Notifications so the per-form override editor on
 * the editor's Connect tab renders the exact same controls. CONTROLLED and
 * persistence-free: each surface owns its save/reset actions and header.
 */

export interface NotificationEmailValue {
  enabled: boolean;
  subject: string;
  body: string;
  /**
   * Who the email goes to. Only the owner notice has one (the receipt is
   * addressed to the respondent), so it is absent on the surfaces that do not
   * pass the `recipients` prop below.
   */
  recipients?: string[];
}

/** Field-level copy (a subset of the `admin.notifications` catalog). */
export interface NotificationFieldsLabels {
  enabledLabel: string;
  enabledHint: string;
  subjectLabel: string;
  bodyLabel: string;
  tokensLabel: string;
  tokensHint: string;
  previewLabel: string;
  previewSubject: string;
  /** Human label per {{token}} chip. */
  tokenLabels: Record<string, string>;
  /** Recipient-list copy; required only when the `recipients` prop is passed. */
  recipientsLabel?: string;
  recipientsHint?: string;
  recipientsEmpty?: string;
  recipientsAdd?: string;
  recipientsRemove?: string;
  recipientsPlaceholder?: string;
  recipientsInvalid?: string;
}

/**
 * Good enough to tell a typo from an address, deliberately not a parser. The
 * API runs the real check (`notificationSettingPatchSchema`); this exists so
 * the editor can point at WHICH row is wrong before a save round-trip.
 */
export function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export function NotificationEmailFields({
  value,
  onChange,
  tokens,
  labels,
  testIdPrefix,
  notice,
  recipients,
}: {
  value: NotificationEmailValue;
  onChange: (next: NotificationEmailValue) => void;
  tokens: string[];
  labels: NotificationFieldsLabels;
  /** Optional data-testid prefix for the subject/body controls. */
  testIdPrefix?: string;
  /**
   * A permanent, non-blocking warning about the current draft (e.g. the owner
   * notice lacks `{{answers}}`), shown above the token chips. Null hides it.
   */
  notice?: string | null;
  /**
   * Renders the recipient-list editor. Omitted entirely on an email that
   * addresses itself (the respondent receipt), which has no list to edit.
   * `note` says which layer the current list comes from.
   */
  recipients?: { max: number; note?: string | null };
}) {
  const subjectRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const activeField = useRef<'subject' | 'body'>('body');

  const previewSubject = useMemo(() => interpolate(value.subject, SAMPLE), [value.subject]);
  const previewBody = useMemo(() => interpolate(value.body, SAMPLE), [value.body]);

  /** Insert `{{token}}` at the caret of the last-focused field. */
  function insertToken(token: string) {
    const marker = `{{${token}}}`;
    if (activeField.current === 'subject') {
      const el = subjectRef.current;
      const start = el?.selectionStart ?? value.subject.length;
      const end = el?.selectionEnd ?? value.subject.length;
      onChange({ ...value, subject: value.subject.slice(0, start) + marker + value.subject.slice(end) });
      requestAnimationFrame(() => {
        el?.focus();
        el?.setSelectionRange(start + marker.length, start + marker.length);
      });
    } else {
      const el = bodyRef.current;
      const start = el?.selectionStart ?? value.body.length;
      const end = el?.selectionEnd ?? value.body.length;
      onChange({ ...value, body: value.body.slice(0, start) + marker + value.body.slice(end) });
      requestAnimationFrame(() => {
        el?.focus();
        el?.setSelectionRange(start + marker.length, start + marker.length);
      });
    }
  }

  const recipientList = value.recipients ?? [];
  /** Update/remove/add BY INDEX, so two identical drafts stay independently editable. */
  function updateRecipient(index: number, address: string) {
    onChange({ ...value, recipients: recipientList.map((r, i) => (i === index ? address : r)) });
  }
  function removeRecipient(index: number) {
    onChange({ ...value, recipients: recipientList.filter((_, i) => i !== index) });
  }
  function addRecipient() {
    onChange({ ...value, recipients: [...recipientList, ''] });
  }

  return (
    <>
      {/* Enable toggle */}
      <div className="mt-4 flex items-center gap-3 border-t border-border pt-4">
        <Switch
          checked={value.enabled}
          onCheckedChange={(enabled) => onChange({ ...value, enabled })}
          aria-label={labels.enabledLabel}
        />
        <div className="min-w-0">
          <span className="text-sm font-medium">{labels.enabledLabel}</span>
          <p className="text-xs text-muted-foreground">{labels.enabledHint}</p>
        </div>
      </div>

      {/* Recipients (owner notice only) */}
      {recipients ? (
        <div className="mt-4" data-testid={testIdPrefix ? `${testIdPrefix}-recipients` : undefined}>
          <span className="text-sm font-medium">{labels.recipientsLabel}</span>
          <p className="mt-0.5 text-xs text-muted-foreground">{labels.recipientsHint}</p>
          {recipients.note ? (
            <p className="mt-1 text-xs text-muted-foreground">
              <i aria-hidden className="pi pi-info-circle" style={{ fontSize: 11 }} />{' '}
              {recipients.note}
            </p>
          ) : null}
          {recipientList.length === 0 ? (
            <p
              className="mt-2 text-xs text-muted-foreground"
              data-testid={testIdPrefix ? `${testIdPrefix}-recipients-empty` : undefined}
            >
              {labels.recipientsEmpty}
            </p>
          ) : (
            <div className="mt-2 flex flex-col gap-2">
              {recipientList.map((address, index) => {
                // A row being typed into is not yet wrong; only a filled row is.
                const invalid = address.trim().length > 0 && !looksLikeEmail(address);
                return (
                  <div key={index} className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <Input
                        type="email"
                        value={address}
                        onChange={(e) => updateRecipient(index, e.target.value)}
                        placeholder={labels.recipientsPlaceholder}
                        disabled={!value.enabled}
                        aria-invalid={invalid || undefined}
                        aria-label={labels.recipientsLabel}
                        data-testid={
                          testIdPrefix ? `${testIdPrefix}-recipient-${index}` : undefined
                        }
                        className={invalid ? 'border-destructive' : undefined}
                      />
                      {invalid ? (
                        <p
                          role="alert"
                          className="mt-1 text-xs text-destructive"
                          data-testid={
                            testIdPrefix ? `${testIdPrefix}-recipient-${index}-invalid` : undefined
                          }
                        >
                          {labels.recipientsInvalid}
                        </p>
                      ) : null}
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-label={labels.recipientsRemove}
                      title={labels.recipientsRemove}
                      onClick={() => removeRecipient(index)}
                      disabled={!value.enabled}
                      data-testid={
                        testIdPrefix ? `${testIdPrefix}-recipient-remove-${index}` : undefined
                      }
                    >
                      <i aria-hidden className="pi pi-times" style={{ fontSize: 11 }} />
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-2"
            onClick={addRecipient}
            disabled={!value.enabled || recipientList.length >= recipients.max}
            data-testid={testIdPrefix ? `${testIdPrefix}-recipient-add` : undefined}
          >
            <i aria-hidden className="pi pi-plus" style={{ fontSize: 11 }} /> {labels.recipientsAdd}
          </Button>
        </div>
      ) : null}

      {/* Subject */}
      <label className="mt-4 flex flex-col gap-1.5 text-sm">
        <span className="font-medium">{labels.subjectLabel}</span>
        <Input
          ref={subjectRef}
          data-testid={testIdPrefix ? `${testIdPrefix}-subject` : undefined}
          value={value.subject}
          onChange={(e) => onChange({ ...value, subject: e.target.value })}
          onFocus={() => (activeField.current = 'subject')}
          disabled={!value.enabled}
        />
      </label>

      {/* Body */}
      <label className="mt-4 flex flex-col gap-1.5 text-sm">
        <span className="font-medium">{labels.bodyLabel}</span>
        <textarea
          ref={bodyRef}
          data-testid={testIdPrefix ? `${testIdPrefix}-body` : undefined}
          value={value.body}
          onChange={(e) => onChange({ ...value, body: e.target.value })}
          onFocus={() => (activeField.current = 'body')}
          disabled={!value.enabled}
          rows={6}
          className="w-full resize-y rounded-md border border-input bg-background px-3 py-2 font-mono text-xs leading-relaxed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
        />
      </label>

      {notice ? (
        <p
          role="status"
          data-testid={testIdPrefix ? `${testIdPrefix}-notice` : undefined}
          className="mt-3 flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-foreground"
        >
          <i aria-hidden className="pi pi-exclamation-triangle mt-0.5 shrink-0" style={{ fontSize: 12 }} />
          <span>{notice}</span>
        </p>
      ) : null}

      {/* Token chips */}
      <div className="mt-3">
        <span className="text-xs font-medium">{labels.tokensLabel}</span>
        <p className="mt-0.5 text-xs text-muted-foreground">{labels.tokensHint}</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {tokens.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => insertToken(t)}
              disabled={!value.enabled}
              className="rounded-md border border-border bg-card px-2 py-1 text-xs text-muted-foreground transition-colors hover:border-primary-edge/50 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
              title={`{{${t}}}`}
            >
              {labels.tokenLabels[t] ?? t}
              <span className="ml-1 font-mono text-muted-foreground/70">{`{{${t}}}`}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Preview */}
      <div className="mt-4">
        <span className="text-xs font-medium">{labels.previewLabel}</span>
        <div className="mt-1.5 rounded-md border border-border bg-card p-3">
          <p className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{labels.previewSubject}: </span>
            {previewSubject}
          </p>
          <div className="mt-2 whitespace-pre-wrap border-t border-border pt-2 text-sm text-foreground">
            {previewBody}
          </div>
        </div>
      </div>
    </>
  );
}
