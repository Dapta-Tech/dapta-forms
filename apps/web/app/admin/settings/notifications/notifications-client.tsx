'use client';

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { BookingMessages, NotificationEmailKey } from '@slate/shared';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/components/toast';
import {
  previewTemplateAction,
  resetTemplateAction,
  saveLeadsAction,
  saveTemplateAction,
  toggleNotificationAction,
  type PreviewResult,
} from './actions';

type Messages = BookingMessages['admin']['notifications'];

export interface NotificationSettingView {
  key: NotificationEmailKey;
  enabled: boolean;
  subject: string | null;
  body: string | null;
  defaultSubject: string;
  defaultBody: string;
  customized: boolean;
  reminderLeadMinutes?: number[];
}

export interface NotificationSettingsPayload {
  variables: string[];
  defaultReminderLeadMinutes: number[];
  settings: NotificationSettingView[];
}

const MAX_LEADS = 5;
const MIN_LEAD = 5;
const MAX_LEAD = 28 * 24 * 60;

/** "1440, 60" → [1440, 60]; null when anything is out of contract. */
function parseLeads(raw: string): number[] | null {
  const parts = raw.split(',').map((s) => s.trim()).filter(Boolean);
  if (parts.length === 0 || parts.length > MAX_LEADS) return null;
  const leads = [...new Set(parts.map(Number))];
  if (leads.some((n) => !Number.isInteger(n) || n < MIN_LEAD || n > MAX_LEAD)) return null;
  return leads.sort((a, b) => b - a);
}

export function NotificationsClient({ data, messages: m }: { data: NotificationSettingsPayload; messages: Messages }) {
  const [editing, setEditing] = useState<NotificationEmailKey | null>(null);
  const setting = data.settings.find((s) => s.key === editing) ?? null;

  if (editing && setting) {
    return (
      <TemplateEditor
        key={editing}
        setting={setting}
        variables={data.variables}
        m={m}
        onBack={() => setEditing(null)}
      />
    );
  }
  return <ToggleList data={data} m={m} onEdit={setEditing} />;
}

/* ------------------------------- list view ------------------------------- */

function ToggleList({
  data,
  m,
  onEdit,
}: {
  data: NotificationSettingsPayload;
  m: Messages;
  onEdit: (key: NotificationEmailKey) => void;
}) {
  // Attendee section = every non-host key (incl. follow_up, whose key carries
  // no attendee_ prefix by product decision).
  const attendee = data.settings.filter((s) => !s.key.startsWith('host_'));
  const host = data.settings.filter((s) => s.key.startsWith('host_'));
  return (
    <div className="flex flex-col gap-4">
      <Section title={m.attendeeSection} subtitle={m.attendeeSectionDesc}>
        {attendee.map((s) => (
          <Row key={s.key} s={s} m={m} onEdit={onEdit} />
        ))}
      </Section>
      <Section title={m.hostSection} subtitle={m.hostSectionDesc}>
        {host.map((s) => (
          <Row key={s.key} s={s} m={m} onEdit={onEdit} />
        ))}
      </Section>
    </div>
  );
}

function Section({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <section className="rounded-md border border-border bg-card p-4">
      <div className="mb-1">
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="text-xs text-muted-foreground">{subtitle}</p>
      </div>
      <ul className="divide-y divide-border">{children}</ul>
    </section>
  );
}

function Row({
  s,
  m,
  onEdit,
}: {
  s: NotificationSettingView;
  m: Messages;
  onEdit: (key: NotificationEmailKey) => void;
}) {
  // Optimistic toggle: flip locally, revert on failure.
  const [enabled, setEnabled] = useState(s.enabled);
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();

  const toggle = (next: boolean) => {
    setEnabled(next);
    start(async () => {
      const r = await toggleNotificationAction(s.key, next);
      if (r.ok) {
        toast.success(m.updated);
        router.refresh();
      } else {
        setEnabled(!next);
        toast.error(r.message ?? m.updateFailed);
      }
    });
  };

  return (
    <li className="flex items-start justify-between gap-4 py-3">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{m.labels[s.key]}</span>
          {s.customized ? (
            <span className="rounded-sm bg-secondary px-1.5 py-0.5 text-[11px] text-secondary-foreground">
              {m.customizedBadge}
            </span>
          ) : null}
        </div>
        <p className="text-xs text-muted-foreground">{m.descriptions[s.key]}</p>
        <button
          type="button"
          onClick={() => onEdit(s.key)}
          className="mt-1 self-start text-xs text-primary hover:underline"
        >
          {m.editTemplate}
        </button>
        {s.key === 'attendee_reminder' || s.key === 'follow_up' ? <LeadsField s={s} m={m} /> : null}
      </div>
      <Switch checked={enabled} disabled={pending} onCheckedChange={toggle} aria-label={m.labels[s.key]} />
    </li>
  );
}

/** Lead times (reminders: before start; follow-up: after end) — comma list,
 *  saved on blur/Enter when valid + changed. */
function LeadsField({ s, m }: { s: NotificationSettingView; m: Messages }) {
  const isFollowUp = s.key === 'follow_up';
  const saved = (s.reminderLeadMinutes ?? []).join(', ');
  const [value, setValue] = useState(saved);
  const [invalid, setInvalid] = useState(false);
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();

  const commit = () => {
    if (value.trim() === saved.trim()) return;
    const leads = parseLeads(value);
    if (!leads) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    start(async () => {
      const r = await saveLeadsAction(s.key, leads);
      if (r.ok) {
        setValue(leads.join(', '));
        toast.success(m.updated);
        router.refresh();
      } else {
        toast.error(r.message ?? m.updateFailed);
      }
    });
  };

  return (
    <div className="mt-2 flex max-w-xs flex-col gap-1">
      <label className="text-xs text-muted-foreground" htmlFor={`${s.key}-leads`}>
        {isFollowUp ? m.followUpLead : m.reminderLeads}
      </label>
      <input
        id={`${s.key}-leads`}
        value={value}
        disabled={pending}
        onChange={(e) => {
          setValue(e.target.value);
          setInvalid(false);
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
        className="rounded-md border border-input bg-background px-2 py-1.5 text-sm"
      />
      <span className={`text-xs ${invalid ? 'text-destructive' : 'text-muted-foreground'}`}>
        {invalid ? m.reminderLeadsInvalid : isFollowUp ? m.followUpLeadHint : m.reminderLeadsHint}
      </span>
    </div>
  );
}

/* ------------------------------ editor view ------------------------------ */

function TemplateEditor({
  setting,
  variables,
  m,
  onBack,
}: {
  setting: NotificationSettingView;
  variables: string[];
  m: Messages;
  onBack: () => void;
}) {
  const [subject, setSubject] = useState(setting.subject ?? setting.defaultSubject);
  const [body, setBody] = useState(setting.body ?? setting.defaultBody);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [saveState, setSaveState] = useState<'idle' | 'saved' | 'error'>('idle');
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const toast = useToast();
  const router = useRouter();

  const snapshot = useMemo(() => JSON.stringify({ subject, body }), [subject, body]);
  const savedSnapshot = useRef(snapshot);
  const isDirty = snapshot !== savedSnapshot.current;
  const isDefault = subject === setting.defaultSubject && body === setting.defaultBody;

  // Debounced server-side preview — the exact renderer the outbox uses.
  useEffect(() => {
    let stale = false;
    const t = setTimeout(async () => {
      const r = await previewTemplateAction(setting.key, subject, body);
      if (!stale) setPreview(r);
    }, 350);
    return () => {
      stale = true;
      clearTimeout(t);
    };
  }, [setting.key, subject, body]);

  const insertVariable = (v: string) => {
    const token = `{{${v}}}`;
    const el = bodyRef.current;
    if (!el) {
      setBody((b) => b + token);
      return;
    }
    const start_ = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    setBody((b) => b.slice(0, start_) + token + b.slice(end));
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start_ + token.length, start_ + token.length);
    });
  };

  const save = () =>
    start(async () => {
      // Saving the untouched default stores NULL (stay on the shipped copy).
      const r = await saveTemplateAction(
        setting.key,
        isDefault || subject === setting.defaultSubject ? null : subject,
        isDefault || body === setting.defaultBody ? null : body,
      );
      if (r.ok) {
        savedSnapshot.current = snapshot;
        setSaveState('saved');
        setSaveMsg(null);
        router.refresh();
      } else {
        setSaveState('error');
        setSaveMsg(r.message ?? m.saveFailed);
      }
    });

  const reset = () =>
    start(async () => {
      const r = await resetTemplateAction(setting.key);
      if (r.ok) {
        setSubject(setting.defaultSubject);
        setBody(setting.defaultBody);
        savedSnapshot.current = JSON.stringify({
          subject: setting.defaultSubject,
          body: setting.defaultBody,
        });
        setSaveState('idle');
        toast.success(m.resetDone);
        router.refresh();
      } else {
        toast.error(r.message ?? m.saveFailed);
      }
    });

  return (
    <div className="flex flex-col gap-4">
      {/* Header: back + state chip left, Reset/Save (single primary CTA) right */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button type="button" onClick={onBack} className="text-sm text-muted-foreground hover:text-foreground">
            ← {m.back}
          </button>
          <span className="text-sm font-semibold">{m.labels[setting.key]}</span>
          <span className="rounded-sm bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
            {isDefault ? m.usingDefault : m.usingCustom}
          </span>
          {saveState === 'saved' && !isDirty ? <span className="text-xs text-primary">{m.saved}</span> : null}
          {saveState === 'error' ? <span className="text-xs text-destructive">{saveMsg}</span> : null}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={reset}
            disabled={pending || (isDefault && !setting.customized)}
            className="rounded-md border border-border px-4 py-2 text-sm disabled:opacity-50"
          >
            {m.reset}
          </button>
          <button
            type="button"
            onClick={save}
            disabled={!isDirty || pending}
            className="rounded-md bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground transition-transform active:scale-[0.98] disabled:opacity-60"
          >
            {pending ? m.saving : m.save}
          </button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Edit side */}
        <div className="flex flex-col gap-4">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground">{m.editorSubject}</span>
            <input
              value={subject}
              maxLength={200}
              onChange={(e) => setSubject(e.target.value)}
              className="rounded-md border border-input bg-background px-3 py-2"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground">{m.editorBody}</span>
            <textarea
              ref={bodyRef}
              value={body}
              rows={10}
              maxLength={5000}
              onChange={(e) => setBody(e.target.value)}
              className="rounded-md border border-input bg-background px-3 py-2 font-mono text-sm"
            />
          </label>
          <div>
            <div className="mb-1 text-sm text-muted-foreground">{m.variables}</div>
            <div className="flex flex-wrap gap-1.5">
              {variables.map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => insertVariable(v)}
                  className="rounded-sm border border-border bg-muted px-2 py-0.5 font-mono text-xs text-muted-foreground transition-colors hover:border-primary hover:text-foreground"
                >
                  {`{{${v}}}`}
                </button>
              ))}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{m.variablesHint}</p>
          </div>
        </div>

        {/* Preview side (server-rendered plain text — what the email says) */}
        <div className="lg:sticky lg:top-6 lg:self-start">
          <div className="mb-1 text-sm text-muted-foreground">{m.preview}</div>
          <div className="rounded-md border border-border bg-card p-4">
            {preview?.ok ? (
              <>
                <div className="mb-3 border-b border-border pb-2 text-sm font-semibold">{preview.subject}</div>
                <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed">{preview.text}</pre>
              </>
            ) : (
              <div className="h-24 animate-pulse rounded-sm bg-muted" />
            )}
          </div>
          {preview?.ok && preview.unknownTokens && preview.unknownTokens.length > 0 ? (
            <p className="mt-2 text-xs text-destructive">
              {m.unknownTokensWarn} {preview.unknownTokens.map((t) => `{{${t}}}`).join(', ')}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
