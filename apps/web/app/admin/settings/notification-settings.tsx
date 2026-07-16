'use client';

import { useMemo, useRef, useState, useTransition } from 'react';
import { getMessages, type Locale } from '@quill/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { useConfirmDialog } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/toast';
import type { NotificationSettingView } from '@/lib/admin-api';
import { interpolate, NOTIFICATION_SAMPLE as SAMPLE } from '@/lib/notification-preview';
import { saveNotificationAction, resetNotificationAction } from './actions';

export interface NotificationLabels {
  heading: string;
  subtitle: string;
  receivedTitle: string;
  receivedSubtitle: string;
  confirmedTitle: string;
  confirmedSubtitle: string;
  enabledLabel: string;
  enabledHint: string;
  subjectLabel: string;
  bodyLabel: string;
  tokensLabel: string;
  tokensHint: string;
  previewLabel: string;
  previewSubject: string;
  usingDefault: string;
  customized: string;
  save: string;
  saving: string;
  reset: string;
  resetConfirm: string;
  saveSuccess: string;
  saveError: string;
  resetSuccess: string;
  tokenFormName: string;
  tokenRespondentEmail: string;
  tokenScore: string;
  tokenOutcomeLabel: string;
  tokenFormLink: string;
}

/** The Notifications section: one editable card per submission email. */
export function NotificationSettings({
  settings,
  locale,
  labels,
}: {
  settings: NotificationSettingView[];
  locale: Locale;
  labels: NotificationLabels;
}) {
  const titleFor = (key: string) =>
    key === 'submission_received'
      ? { title: labels.receivedTitle, subtitle: labels.receivedSubtitle }
      : { title: labels.confirmedTitle, subtitle: labels.confirmedSubtitle };

  return (
    <section className="mt-8 rounded-md border border-border bg-card p-6">
      <h2 className="text-lg font-semibold tracking-tight">{labels.heading}</h2>
      <p className="mt-0.5 text-sm text-muted-foreground">{labels.subtitle}</p>
      <div className="mt-5 flex flex-col gap-5">
        {settings.map((s) => (
          <NotificationEmailCard
            key={s.emailKey}
            setting={s}
            locale={locale}
            labels={labels}
            {...titleFor(s.emailKey)}
          />
        ))}
      </div>
    </section>
  );
}

function NotificationEmailCard({
  setting,
  locale,
  labels,
  title,
  subtitle,
}: {
  setting: NotificationSettingView;
  locale: Locale;
  labels: NotificationLabels;
  title: string;
  subtitle: string;
}) {
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const { confirm: confirmDialog, dialog } = useConfirmDialog();
  const subjectRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const activeField = useRef<'subject' | 'body'>('body');

  const def = locale === 'es' ? setting.defaults.es : setting.defaults.en;

  // The last persisted state; the editable fields start from the effective copy
  // (override, or the shipped default when none). "Customized" reflects `saved`.
  const [saved, setSaved] = useState(setting);
  const [enabled, setEnabled] = useState(setting.enabled);
  const [subject, setSubject] = useState(setting.subject ?? def.subject);
  const [body, setBody] = useState(setting.body ?? def.body);

  const savedSubject = saved.subject ?? def.subject;
  const savedBody = saved.body ?? def.body;
  const isCustom = saved.subject !== null || saved.body !== null;
  const dirty = enabled !== saved.enabled || subject !== savedSubject || body !== savedBody;

  const tokenLabels: Record<string, string> = {
    formName: labels.tokenFormName,
    respondentEmail: labels.tokenRespondentEmail,
    score: labels.tokenScore,
    outcomeLabel: labels.tokenOutcomeLabel,
    formLink: labels.tokenFormLink,
  };

  const previewSubject = useMemo(() => interpolate(subject, SAMPLE), [subject]);
  const previewBody = useMemo(() => interpolate(body, SAMPLE), [body]);

  /** Insert `{{token}}` at the caret of the last-focused field. */
  function insertToken(token: string) {
    const marker = `{{${token}}}`;
    if (activeField.current === 'subject') {
      const el = subjectRef.current;
      const start = el?.selectionStart ?? subject.length;
      const end = el?.selectionEnd ?? subject.length;
      const next = subject.slice(0, start) + marker + subject.slice(end);
      setSubject(next);
      requestAnimationFrame(() => {
        el?.focus();
        el?.setSelectionRange(start + marker.length, start + marker.length);
      });
    } else {
      const el = bodyRef.current;
      const start = el?.selectionStart ?? body.length;
      const end = el?.selectionEnd ?? body.length;
      const next = body.slice(0, start) + marker + body.slice(end);
      setBody(next);
      requestAnimationFrame(() => {
        el?.focus();
        el?.setSelectionRange(start + marker.length, start + marker.length);
      });
    }
  }

  function onSave() {
    startTransition(async () => {
      // Fields equal to the shipped default persist as `null` (stay on default),
      // so editing back to the default cleanly reverts "Customized".
      const res = await saveNotificationAction(setting.emailKey, {
        enabled,
        subject: subject === def.subject ? null : subject,
        body: body === def.body ? null : body,
      });
      if (res.ok) {
        setSaved(res.setting);
        setEnabled(res.setting.enabled);
        setSubject(res.setting.subject ?? def.subject);
        setBody(res.setting.body ?? def.body);
        toast.success(labels.saveSuccess);
      } else {
        toast.error(labels.saveError);
      }
    });
  }

  async function onReset() {
    const ok = await confirmDialog({
      title: getMessages(locale).dialog.resetEmailTitle,
      message: labels.resetConfirm,
      confirmLabel: labels.reset,
      destructive: true,
    });
    if (!ok) return;
    startTransition(async () => {
      const res = await resetNotificationAction(setting.emailKey);
      if (res.ok) {
        setSaved(res.setting);
        setEnabled(res.setting.enabled);
        setSubject(res.setting.subject ?? def.subject);
        setBody(res.setting.body ?? def.body);
        toast.success(labels.resetSuccess);
      } else {
        toast.error(labels.saveError);
      }
    });
  }

  return (
    <div className="rounded-md border border-border bg-background/40 p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">{title}</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>
        </div>
        <span
          className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
            isCustom
              ? 'border-primary/50 text-primary'
              : 'border-border text-muted-foreground'
          }`}
        >
          {isCustom ? labels.customized : labels.usingDefault}
        </span>
      </div>

      {/* Enable toggle */}
      <div className="mt-4 flex items-center gap-3 border-t border-border pt-4">
        <Switch checked={enabled} onCheckedChange={setEnabled} aria-label={labels.enabledLabel} />
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
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          onFocus={() => (activeField.current = 'subject')}
          disabled={!enabled}
        />
      </label>

      {/* Body */}
      <label className="mt-4 flex flex-col gap-1.5 text-sm">
        <span className="font-medium">{labels.bodyLabel}</span>
        <textarea
          ref={bodyRef}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onFocus={() => (activeField.current = 'body')}
          disabled={!enabled}
          rows={6}
          className="w-full resize-y rounded-md border border-input bg-background px-3 py-2 font-mono text-xs leading-relaxed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
        />
      </label>

      {/* Token chips */}
      <div className="mt-3">
        <span className="text-xs font-medium">{labels.tokensLabel}</span>
        <p className="mt-0.5 text-xs text-muted-foreground">{labels.tokensHint}</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {setting.tokens.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => insertToken(t)}
              disabled={!enabled}
              className="rounded-md border border-border bg-card px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
              title={`{{${t}}}`}
            >
              {tokenLabels[t] ?? t}
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

      {/* Actions */}
      <div className="mt-4 flex items-center justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onReset} disabled={pending || !isCustom}>
          {labels.reset}
        </Button>
        <Button type="button" onClick={onSave} disabled={pending || !dirty} className="min-w-[130px]">
          {pending ? labels.saving : labels.save}
        </Button>
      </div>
      {dialog}
    </div>
  );
}
