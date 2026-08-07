'use client';

import { useMemo, useRef } from 'react';
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
}

export function NotificationEmailFields({
  value,
  onChange,
  tokens,
  labels,
  testIdPrefix,
}: {
  value: NotificationEmailValue;
  onChange: (next: NotificationEmailValue) => void;
  tokens: string[];
  labels: NotificationFieldsLabels;
  /** Optional data-testid prefix for the subject/body controls. */
  testIdPrefix?: string;
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
              className="rounded-md border border-border bg-card px-2 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
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
