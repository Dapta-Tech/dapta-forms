'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { getMessages, type Locale } from '@quill/shared';
import { Button } from '@/components/ui/button';
import { useConfirmDialog } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/toast';
import {
  NotificationEmailFields,
  type NotificationEmailValue,
} from '@/components/notification-email-fields';
import type { FormNotificationView, NotificationEmailKey } from '@/lib/admin-api';
import { interpolate, NOTIFICATION_SAMPLE as SAMPLE } from '@/lib/notification-preview';
import {
  loadFormNotificationsAction,
  resetFormNotificationAction,
  saveFormNotificationAction,
} from './connect-emails-actions';
import type { EditorMessages } from './messages';
import { callAction } from '@/lib/call-action';

/**
 * Emails on the Connect tab — PER-FORM template overrides (Typeform's per-form
 * Follow-ups model). Each of the two submission emails shows one card:
 *
 *   no override — "Using the account template" + a muted sample preview of the
 *                 effective account/stock subject, and a "Customize for this
 *                 form" button that expands the editor prefilled from the
 *                 account layer;
 *   override    — the editor (same fields as Settings → Notifications: toggle,
 *                 subject, body, {{token}} chips, live preview) plus "Use
 *                 account template", which removes the override behind the
 *                 branded confirm dialog.
 *
 * Send-time precedence is form → account → stock, per field. The account-wide
 * template itself is edited in Settings → Notifications (footer note).
 */
export function ConnectEmailsSection({
  formId,
  m,
  locale,
}: {
  formId: string;
  m: EditorMessages['connect'];
  locale: string;
}) {
  const loc: Locale = locale === 'es' ? 'es' : 'en';
  // The shared catalog is a plain typed object (same pattern as ConnectPanel's
  // integrations subtree) — safe to resolve in the browser.
  const nm = useMemo(() => getMessages(loc).admin.notifications, [loc]);

  type LoadState =
    | { status: 'loading' }
    | { status: 'error' }
    | { status: 'ready'; settings: FormNotificationView[] };
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  // Fetch on tab activation — the panel mounts only while Connect is active,
  // so re-entering the tab always shows the latest stored overrides.
  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    loadFormNotificationsAction(formId)
      .then((res) => {
        if (cancelled) return;
        setState(res.ok ? { status: 'ready', settings: res.settings } : { status: 'error' });
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'error' });
      });
    return () => {
      cancelled = true;
    };
  }, [formId, attempt]);

  return (
    <section
      data-testid="connect-emails"
      className="flex flex-col gap-4 rounded-xl border border-border bg-card p-4"
    >
      <div className="min-w-0">
        <h3 className="text-sm font-semibold text-foreground">{m.emailsTitle}</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">{m.emailsSubtitle}</p>
      </div>

      {state.status === 'loading' ? (
        <div aria-hidden className="flex flex-col gap-3">
          <div className="h-20 animate-pulse rounded-md border border-border bg-muted" />
          <div className="h-20 animate-pulse rounded-md border border-border bg-muted" />
        </div>
      ) : state.status === 'error' ? (
        <div className="flex flex-col items-start gap-3 rounded-md border border-border bg-background/40 p-4">
          <p className="text-sm text-muted-foreground" role="alert">
            {m.emailsLoadError}
          </p>
          <Button variant="outline" size="sm" onClick={() => setAttempt((n) => n + 1)}>
            <i aria-hidden className="pi pi-refresh" style={{ fontSize: 12 }} />
            {m.retry}
          </Button>
        </div>
      ) : (
        state.settings.map((s) => (
          <FormEmailCard key={s.emailKey} formId={formId} setting={s} locale={loc} mc={m} nm={nm} />
        ))
      )}

      <p className="text-xs text-muted-foreground">
        <i aria-hidden className="pi pi-info-circle" style={{ fontSize: 11 }} /> {m.emailsGlobalNote}
      </p>
    </section>
  );
}

/** One email's per-form card: inherit state or the expanded override editor. */
function FormEmailCard({
  formId,
  setting,
  locale,
  mc,
  nm,
}: {
  formId: string;
  setting: FormNotificationView;
  locale: Locale;
  mc: EditorMessages['connect'];
  nm: ReturnType<typeof getMessages>['admin']['notifications'];
}) {
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const { confirm: confirmDialog, dialog } = useConfirmDialog();

  const key: NotificationEmailKey = setting.emailKey;
  const def = locale === 'es' ? setting.defaults.es : setting.defaults.en;
  const title = key === 'submission_received' ? nm.receivedTitle : nm.confirmedTitle;
  const subtitle = key === 'submission_received' ? nm.receivedSubtitle : nm.confirmedSubtitle;

  // The effective ACCOUNT layer this form inherits (account override or stock).
  const accountSubject = setting.account.subject ?? def.subject;
  const accountBody = setting.account.body ?? def.body;

  // `override` = the last PERSISTED form row (null = inheriting); `value` = the
  // editor draft. The editor is open whenever an override exists, or after
  // "Customize" (draft prefilled from the account layer, saved only on Save).
  const [override, setOverride] = useState(setting.override);
  const [editing, setEditing] = useState(setting.override !== null);
  const [value, setValue] = useState<NotificationEmailValue>({
    enabled: setting.override?.enabled ?? setting.account.enabled,
    subject: setting.override?.subject ?? accountSubject,
    body: setting.override?.body ?? accountBody,
  });

  const savedValue: NotificationEmailValue = {
    enabled: override?.enabled ?? setting.account.enabled,
    subject: override?.subject ?? accountSubject,
    body: override?.body ?? accountBody,
  };
  const dirty =
    value.enabled !== savedValue.enabled ||
    value.subject !== savedValue.subject ||
    value.body !== savedValue.body;

  const tokenLabels: Record<string, string> = {
    formName: nm.tokenFormName,
    respondentEmail: nm.tokenRespondentEmail,
    score: nm.tokenScore,
    outcomeLabel: nm.tokenOutcomeLabel,
    formLink: nm.tokenFormLink,
  };

  function openEditor() {
    setValue({
      enabled: override?.enabled ?? setting.account.enabled,
      subject: override?.subject ?? accountSubject,
      body: override?.body ?? accountBody,
    });
    setEditing(true);
  }

  function onSave() {
    startTransition(async () => {
      // The override PINS this form's copy verbatim (subject/body/enabled) —
      // unlike the account editor there is no "equals default → null" collapse:
      // customizing means "keep this exact copy even if the account changes".
      const res = await callAction(() =>
        saveFormNotificationAction(formId, key, {
          enabled: value.enabled,
          subject: value.subject,
          body: value.body,
        }),
      );
      if (res.ok) {
        setOverride(res.setting.override);
        toast.success(nm.saveSuccess);
      } else {
        toast.error(nm.saveError);
      }
    });
  }

  async function onUseAccount() {
    // Unsaved draft (no stored override) → just collapse, nothing to remove.
    if (override === null) {
      setEditing(false);
      return;
    }
    const ok = await confirmDialog({
      title: getMessages(locale).dialog.resetEmailTitle,
      message: mc.emailsUseAccountConfirm,
      confirmLabel: mc.emailsUseAccount,
      destructive: true,
    });
    if (!ok) return;
    startTransition(async () => {
      const res = await callAction(() => resetFormNotificationAction(formId, key));
      if (res.ok) {
        setOverride(null);
        setEditing(false);
        toast.success(nm.resetSuccess);
      } else {
        toast.error(nm.saveError);
      }
    });
  }

  return (
    <div
      data-testid={`connect-email-${key}`}
      className="rounded-md border border-border bg-background/40 p-4"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h4 className="text-sm font-semibold">{title}</h4>
          <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>
        </div>
        <span
          data-testid={`connect-email-badge-${key}`}
          className={`shrink-0 rounded-full border px-2 py-0.5 text-2xs font-medium uppercase tracking-wide ${
            override !== null
              ? 'border-primary-edge/50 text-primary'
              : 'border-border text-muted-foreground'
          }`}
        >
          {override !== null ? mc.emailsCustomBadge : mc.emailsUsingAccount}
        </span>
      </div>

      {!editing ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
          {/* Muted sample preview of the account/stock subject this form inherits. */}
          <p
            data-testid={`connect-email-account-preview-${key}`}
            className="min-w-0 flex-1 truncate text-xs text-muted-foreground"
            title={accountSubject}
          >
            <span className="font-medium">{nm.previewSubject}: </span>
            {interpolate(accountSubject, SAMPLE)}
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-testid={`connect-email-customize-${key}`}
            onClick={openEditor}
          >
            <i aria-hidden className="pi pi-pencil" style={{ fontSize: 11 }} />
            {mc.emailsCustomize}
          </Button>
        </div>
      ) : (
        <>
          <NotificationEmailFields
            value={value}
            onChange={setValue}
            tokens={setting.tokens}
            labels={{
              enabledLabel: nm.enabledLabel,
              enabledHint: nm.enabledHint,
              subjectLabel: nm.subjectLabel,
              bodyLabel: nm.bodyLabel,
              tokensLabel: nm.tokensLabel,
              tokensHint: nm.tokensHint,
              previewLabel: nm.previewLabel,
              previewSubject: nm.previewSubject,
              tokenLabels,
            }}
            testIdPrefix={`connect-email-${key}`}
          />
          <div className="mt-4 flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              data-testid={`connect-email-use-account-${key}`}
              onClick={onUseAccount}
              disabled={pending}
            >
              {mc.emailsUseAccount}
            </Button>
            <Button
              type="button"
              data-testid={`connect-email-save-${key}`}
              onClick={onSave}
              disabled={pending || (override !== null && !dirty)}
              className="min-w-[130px]"
            >
              {pending ? nm.saving : nm.save}
            </Button>
          </div>
        </>
      )}
      {dialog}
    </div>
  );
}
