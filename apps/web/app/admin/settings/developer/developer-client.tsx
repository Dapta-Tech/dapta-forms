'use client';

import { useState, useTransition } from 'react';
import type { BookingMessages } from '@slate/shared';
import { Modal } from '@/components/modal';
import type { ApiKeyRow, WebhookRow } from '@/lib/admin-api';
import {
  createApiKeyAction,
  createWebhookAction,
  deleteWebhookAction,
  pingWebhookAction,
  toggleWebhookAction,
  revokeApiKeyAction,
} from './actions';

type DevMessages = BookingMessages['admin']['developer'];

const SCOPES = ['availability:read', 'bookings:read', 'bookings:write'];
const TRIGGERS = ['booking.created', 'booking.rescheduled', 'booking.cancelled'];

const createBtn = 'inline-flex min-h-[44px] items-center rounded-md bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-transform active:scale-[0.98] disabled:opacity-60';

export function ApiKeys({ keys, messages: m }: { keys: ApiKeyRow[]; messages: DevMessages }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<string[]>(['availability:read']);
  const [reveal, setReveal] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const submit = () =>
    start(async () => {
      const r = await createApiKeyAction(name, scopes);
      if (r.plaintext) {
        setReveal(r.plaintext);
        setName('');
        setScopes(['availability:read']);
        setOpen(false);
      }
    });

  return (
    <section className="mb-10">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-xl font-semibold">{m.apiKeys}</h2>
        <button type="button" onClick={() => setOpen(true)} className={createBtn}>
          {m.createKey}
        </button>
      </div>

      {reveal ? (
        <div className="mb-4 rounded-md border border-primary bg-card p-3">
          <p className="mb-1 text-sm text-muted-foreground">{m.copyOnce}</p>
          <code className="break-all text-sm">{reveal}</code>
        </div>
      ) : null}

      <ul className="flex flex-col gap-2">
        {keys.map((k) => (
          <li key={k.id} className="flex items-center justify-between rounded-md border border-border bg-card p-3">
            <span className="text-sm">
              <span className="font-medium">{k.name}</span>{' '}
              <code className="text-muted-foreground">{k.prefix}…{k.last4}</code>
              {k.revoked_at_ms ? <span className="ml-2 text-destructive">{m.revoked}</span> : null}
            </span>
            {!k.revoked_at_ms ? (
              <button
                type="button"
                onClick={() => start(() => revokeApiKeyAction(k.id))}
                className="rounded-md border border-destructive px-3 py-1 text-sm text-destructive"
              >
                {m.revoke}
              </button>
            ) : null}
          </li>
        ))}
        {keys.length === 0 ? <li className="text-sm text-muted-foreground">{m.noKeys}</li> : null}
      </ul>

      <Modal open={open} onClose={() => setOpen(false)} title={m.createKey} labelId="new-api-key-title">
        <div className="flex flex-col gap-4">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground">{m.name}</span>
            <input value={name} onChange={(e) => setName(e.target.value)} className="rounded-md border border-input bg-background px-3 py-2" />
          </label>
          <div className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground">{m.scopes}</span>
            <div className="flex flex-wrap gap-3">
              {SCOPES.map((s) => (
                <label key={s} className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={scopes.includes(s)}
                    onChange={(e) => setScopes((cur) => (e.target.checked ? [...cur, s] : cur.filter((x) => x !== s)))}
                  />
                  {s}
                </label>
              ))}
            </div>
          </div>
          <div className="mt-1 flex justify-end gap-2">
            <button type="button" onClick={() => setOpen(false)} className="inline-flex min-h-[44px] items-center rounded-md border border-border px-4 py-2.5 text-sm">
              {m.cancel}
            </button>
            <button type="button" disabled={pending || !name || scopes.length === 0} onClick={submit} className={createBtn}>
              {pending ? '…' : m.createKey}
            </button>
          </div>
        </div>
      </Modal>
    </section>
  );
}

function WebhookItem({
  w,
  start,
  pending,
  m,
}: {
  w: WebhookRow;
  start: (fn: () => void) => void;
  pending: boolean;
  m: DevMessages;
}) {
  const [ping, setPing] = useState<string | null>(null);
  return (
    <li className="flex flex-col gap-2 rounded-md border border-border bg-card p-3">
      <div className="flex items-center justify-between gap-3">
        <code className="break-all text-sm">{w.subscriber_url}</code>
        <span className="flex items-center gap-2">
          <label className="flex items-center gap-1 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={w.active === 1}
              disabled={pending}
              onChange={(e) => start(() => toggleWebhookAction(w.id, e.target.checked))}
            />
            {m.active}
          </label>
          <button
            type="button"
            disabled={pending}
            onClick={() => start(async () => setPing((await pingWebhookAction(w.id)).message))}
            className="rounded-md border border-border px-3 py-1 text-sm hover:border-primary"
          >
            {m.ping}
          </button>
          <button
            type="button"
            onClick={() => start(() => deleteWebhookAction(w.id))}
            className="rounded-md border border-destructive px-3 py-1 text-sm text-destructive"
          >
            {m.delete}
          </button>
        </span>
      </div>
      {ping ? <span className="text-xs text-muted-foreground">{ping}</span> : null}
    </li>
  );
}

export function Webhooks({ webhooks, messages: m }: { webhooks: WebhookRow[]; messages: DevMessages }) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState('');
  const [triggers, setTriggers] = useState<string[]>(['booking.created']);
  const [pending, start] = useTransition();

  const submit = () =>
    start(async () => {
      await createWebhookAction(url, triggers);
      setUrl('');
      setTriggers(['booking.created']);
      setOpen(false);
    });

  return (
    <section>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-xl font-semibold">{m.webhooks}</h2>
        <button type="button" onClick={() => setOpen(true)} className={createBtn}>
          {m.addWebhook}
        </button>
      </div>
      <ul className="flex flex-col gap-2">
        {webhooks.map((w) => (
          <WebhookItem key={w.id} w={w} start={start} pending={pending} m={m} />
        ))}
        {webhooks.length === 0 ? <li className="text-sm text-muted-foreground">{m.noWebhooks}</li> : null}
      </ul>

      <Modal open={open} onClose={() => setOpen(false)} title={m.addWebhook} labelId="new-webhook-title">
        <div className="flex flex-col gap-4">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground">{m.subscriberUrl}</span>
            <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" className="rounded-md border border-input bg-background px-3 py-2" />
          </label>
          <div className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground">{m.events}</span>
            <div className="flex flex-wrap gap-3">
              {TRIGGERS.map((t) => (
                <label key={t} className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={triggers.includes(t)}
                    onChange={(e) => setTriggers((cur) => (e.target.checked ? [...cur, t] : cur.filter((x) => x !== t)))}
                  />
                  {t.replace('booking.', '')}
                </label>
              ))}
            </div>
          </div>
          <div className="mt-1 flex justify-end gap-2">
            <button type="button" onClick={() => setOpen(false)} className="inline-flex min-h-[44px] items-center rounded-md border border-border px-4 py-2.5 text-sm">
              {m.cancel}
            </button>
            <button type="button" disabled={pending || !url} onClick={submit} className={createBtn}>
              {pending ? '…' : m.addWebhook}
            </button>
          </div>
        </div>
      </Modal>
    </section>
  );
}
