'use client';

import { useState, useTransition } from 'react';
import { getMessages, type Locale } from '@quill/shared';
import { Button } from '@/components/ui/button';
import { useConfirmDialog } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/toast';
import {
  NotificationEmailFields,
  type NotificationEmailValue,
} from '@/components/notification-email-fields';
import type { NotificationSettingView } from '@/lib/admin-api';
import { saveNotificationAction, resetNotificationAction } from './actions';
import { callAction } from '@/lib/call-action';
import { hasToken } from '@/lib/notification-preview';

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
  tokenAnswers: string;
  answersMissing: string;
  formOverrideNote: string;
}

/** `{{formLink}}` is produced for the owner notice only; do not offer a dead chip on the receipt. */
function visibleTokens(key: string, tokens: string[]): string[] {
  return key === 'submission_confirmed' ? tokens.filter((t) => t !== 'formLink') : tokens;
}

/**
 * The Notifications section: one editable card per submission email. Rendered
 * as the whole of /admin/account/notifications, so it carries no outer margin.
 */
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
    <section data-testid="notification-settings" className="rounded-xl border border-border bg-card p-6">
      <h2 className="text-lg font-semibold tracking-tight">{labels.heading}</h2>
      <p className="mt-0.5 text-sm text-muted-foreground">{labels.subtitle}</p>
      {/* These are the ACCOUNT templates — any form can pin its own copy. */}
      <p className="mt-1 text-xs text-muted-foreground" data-testid="notifications-form-override-note">
        <i aria-hidden className="pi pi-info-circle" style={{ fontSize: 11 }} /> {labels.formOverrideNote}
      </p>
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

  const def = locale === 'es' ? setting.defaults.es : setting.defaults.en;

  // The last persisted state; the editable fields start from the effective copy
  // (override, or the shipped default when none). "Customized" reflects `saved`.
  const [saved, setSaved] = useState(setting);
  const [value, setValue] = useState<NotificationEmailValue>({
    enabled: setting.enabled,
    subject: setting.subject ?? def.subject,
    body: setting.body ?? def.body,
  });

  const savedSubject = saved.subject ?? def.subject;
  const savedBody = saved.body ?? def.body;
  const isCustom = saved.subject !== null || saved.body !== null;
  const dirty =
    value.enabled !== saved.enabled || value.subject !== savedSubject || value.body !== savedBody;

  const tokenLabels: Record<string, string> = {
    formName: labels.tokenFormName,
    respondentEmail: labels.tokenRespondentEmail,
    score: labels.tokenScore,
    outcomeLabel: labels.tokenOutcomeLabel,
    formLink: labels.tokenFormLink,
    answers: labels.tokenAnswers,
  };
  // The owner notice exists to carry the answers; a body without the token
  // silently sends an email with nothing useful in it, so say so permanently.
  const answersMissing = setting.emailKey === 'submission_received' && !hasToken(value.body, 'answers');

  /** Reconcile local state with a freshly-persisted setting. */
  function applyPersisted(next: NotificationSettingView) {
    setSaved(next);
    setValue({
      enabled: next.enabled,
      subject: next.subject ?? def.subject,
      body: next.body ?? def.body,
    });
  }

  function onSave() {
    startTransition(async () => {
      // Fields equal to the shipped default persist as `null` (stay on default),
      // so editing back to the default cleanly reverts "Customized".
      const res = await callAction(() =>
        saveNotificationAction(setting.emailKey, {
          enabled: value.enabled,
          subject: value.subject === def.subject ? null : value.subject,
          body: value.body === def.body ? null : value.body,
        }),
      );
      if (res.ok) {
        applyPersisted(res.setting);
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
      const res = await callAction(() => resetNotificationAction(setting.emailKey));
      if (res.ok) {
        applyPersisted(res.setting);
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
          className={`shrink-0 rounded-full border px-2 py-0.5 text-2xs font-medium uppercase tracking-wide ${
            isCustom
              ? 'border-primary-edge/50 text-primary'
              : 'border-border text-muted-foreground'
          }`}
        >
          {isCustom ? labels.customized : labels.usingDefault}
        </span>
      </div>

      {/* Toggle + subject/body + chips + preview (shared with the per-form editor) */}
      <NotificationEmailFields
        value={value}
        onChange={setValue}
        tokens={visibleTokens(setting.emailKey, setting.tokens)}
        labels={{
          enabledLabel: labels.enabledLabel,
          enabledHint: labels.enabledHint,
          subjectLabel: labels.subjectLabel,
          bodyLabel: labels.bodyLabel,
          tokensLabel: labels.tokensLabel,
          tokensHint: labels.tokensHint,
          previewLabel: labels.previewLabel,
          previewSubject: labels.previewSubject,
          tokenLabels,
        }}
        notice={answersMissing ? labels.answersMissing : null}
      />

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
