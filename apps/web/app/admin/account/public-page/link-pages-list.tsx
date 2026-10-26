'use client';

import { useEffect, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { FormsMessages } from '@quill/shared';
import { formatDate, t } from '@quill/shared';
import { validateVanitySlug } from '@quill/engine';
import { slugFromName } from '@quill/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { useConfirmDialog } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/toast';
import { QrModal } from '@/app/admin/forms/[id]/edit/qr-modal';
import { callAction, isTransportError } from '@/lib/call-action';
import { linkPagePublicPath } from '@/lib/public-page';
import type { LinkPagesListView } from '@/lib/admin-api';
import {
  createPageAction,
  deletePageAction,
  duplicatePageAction,
  makeDefaultPageAction,
  setPagePublishedAction,
  type LinkPageActionResult,
} from './actions';

type Msgs = FormsMessages['admin']['linkPages'];
type PageRow = LinkPagesListView['pages'][number];

const iconButton =
  'flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40';

/**
 * The workspace's link pages (Account settings, Public page): one row per
 * page with its name, address, whether it is published, how many buttons it
 * holds and when it was last edited, and what people do with a page (edit,
 * copy the link, QR, duplicate, make it the main page, delete). "New page"
 * asks for an internal name and an address, then opens the editor.
 *
 * The rows come from the server on every render (each action revalidates the
 * route), so the list never drifts from what is stored.
 */
export function LinkPagesList({
  initial,
  m,
  qr,
  locale,
  timeZone,
}: {
  initial: LinkPagesListView;
  m: Msgs;
  /** The QR dialog's copy, shared with the editor. */
  qr: FormsMessages['admin']['linkPage'];
  locale: string;
  timeZone: string;
}) {
  const router = useRouter();
  const { success, error } = useToast();
  const { confirm, dialog } = useConfirmDialog();
  const [pending, start] = useTransition();
  const [origin, setOrigin] = useState('');
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newSlug, setNewSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [newError, setNewError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [qrFor, setQrFor] = useState<PageRow | null>(null);

  useEffect(() => setOrigin(window.location.origin), []);

  const pages = initial.pages;
  const atMax = pages.length >= initial.max;
  const pathOf = (p: PageRow) => linkPagePublicPath(initial.accountCode, p);
  const urlOf = (p: PageRow) => `${origin}${pathOf(p)}`;
  const nameOf = (p: PageRow) => p.name.trim() || (p.isDefault ? m.defaultName : p.slug);

  /** Run an action; on success show `done`, on failure the API's message. */
  function run(work: () => Promise<LinkPageActionResult>, done: string | null, then?: (r: LinkPageActionResult) => void) {
    start(async () => {
      const res = await callAction<LinkPageActionResult>(work);
      if (res.ok) {
        if (done) success(done);
        then?.(res);
        router.refresh();
      } else if (!isTransportError(res) && res.code === 'DEFAULT_PAGE') {
        error(m.cannotRemoveDefault);
      } else {
        error((isTransportError(res) ? null : res.message) ?? m.error);
      }
    });
  }

  async function copy(p: PageRow) {
    try {
      await navigator.clipboard.writeText(urlOf(p));
      setCopiedId(p.id);
      setTimeout(() => setCopiedId((id) => (id === p.id ? null : id)), 2000);
    } catch {
      /* clipboard blocked: the address stays on screen to copy by hand */
    }
  }

  async function remove(p: PageRow) {
    const ok = await confirm({
      title: m.removeTitle,
      message: t(m.removeBody, { name: nameOf(p) }),
      confirmLabel: m.removeConfirm,
      destructive: true,
    });
    if (ok) run(() => deletePageAction(p.id), m.removed);
  }

  const newSlugIssue = newSlug ? validateVanitySlug(newSlug) : null;

  function create() {
    if (newSlugIssue) {
      setNewError(newSlugIssue === 'reserved' ? qr.slugReserved : qr.slugInvalid);
      return;
    }
    setNewError(null);
    start(async () => {
      const res = await callAction<LinkPageActionResult>(() =>
        createPageAction({ name: newName.trim(), ...(newSlug ? { slug: newSlug } : {}) }),
      );
      if (res.ok && res.id) {
        router.push(`/admin/account/public-page/${encodeURIComponent(res.id)}`);
        return;
      }
      const code = isTransportError(res) ? null : res.code;
      if (code === 'SLUG_TAKEN') setNewError(qr.slugTaken);
      else if (code === 'PAGE_LIMIT') setNewError(t(m.limitReached, { max: String(initial.max) }));
      else setNewError((isTransportError(res) ? null : res.message) ?? m.error);
    });
  }

  const newPanel = creating ? (
    <div className="mt-6 rounded-xl border border-border bg-card p-4" data-testid="link-pages-new-panel">
      <h3 className="text-sm font-semibold">{m.createTitle}</h3>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          {m.createName}
          <Input
            value={newName}
            maxLength={80}
            autoFocus
            placeholder={m.createNamePlaceholder}
            onChange={(e) => {
              setNewName(e.target.value);
              if (!slugTouched) setNewSlug(slugFromName(e.target.value) ?? '');
            }}
            data-testid="link-pages-new-name"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          {m.createSlug}
          <Input
            value={newSlug}
            maxLength={30}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            aria-invalid={Boolean(newError)}
            onChange={(e) => {
              setSlugTouched(true);
              setNewSlug(e.target.value.toLowerCase().replace(/\s+/g, '-'));
              setNewError(null);
            }}
            data-testid="link-pages-new-slug"
          />
          <span className="truncate">{`${origin.replace(/^https?:\/\//, '')}/${initial.accountCode}/p/${newSlug}`}</span>
        </label>
      </div>
      {newError ? (
        <p className="mt-2 text-xs text-destructive" role="alert" data-testid="link-pages-new-error">
          {newError}
        </p>
      ) : null}
      <div className="mt-4 flex flex-wrap gap-2">
        <Button size="sm" onClick={create} disabled={pending} data-testid="link-pages-create">
          {pending ? m.creating : m.create}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            setCreating(false);
            setNewError(null);
          }}
        >
          {m.cancel}
        </Button>
      </div>
    </div>
  ) : null;

  return (
    <section data-testid="link-pages" className="mb-10">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-xl font-semibold tracking-tight">{m.heading}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{m.subtitle}</p>
          <p className="mt-1 text-xs text-muted-foreground">{m.anyMember}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <Button onClick={() => setCreating(true)} disabled={atMax || creating} data-testid="link-pages-new">
            <i aria-hidden className="pi pi-plus" style={{ fontSize: 12 }} />
            {m.newPage}
          </Button>
          {pages.length > 0 ? (
            <span className="text-xs text-muted-foreground" data-testid="link-pages-count">
              {t(m.count, { n: String(pages.length), max: String(initial.max) })}
            </span>
          ) : null}
        </div>
      </div>
      {atMax ? (
        <p className="mt-3 text-sm text-muted-foreground" data-testid="link-pages-limit">
          {t(m.limitReached, { max: String(initial.max) })}
        </p>
      ) : null}

      {newPanel}

      {pages.length === 0 ? (
        <div
          className="mt-6 flex flex-col items-center rounded-xl border border-dashed border-border px-6 py-12 text-center"
          data-testid="link-pages-empty"
        >
          <i aria-hidden className="pi pi-link text-muted-foreground" style={{ fontSize: 24 }} />
          <h3 className="mt-3 text-base font-semibold">{m.emptyTitle}</h3>
          <p className="mt-1 max-w-md text-sm text-muted-foreground">{m.emptyBody}</p>
          {!creating ? (
            <Button className="mt-4" onClick={() => setCreating(true)} data-testid="link-pages-empty-new">
              <i aria-hidden className="pi pi-plus" style={{ fontSize: 12 }} />
              {m.newPage}
            </Button>
          ) : null}
        </div>
      ) : (
        <ul className="mt-6 divide-y divide-border rounded-xl border border-border" data-testid="link-pages-list">
          {pages.map((p) => {
            const name = nameOf(p);
            const edit = `/admin/account/public-page/${encodeURIComponent(p.id)}`;
            return (
              <li
                key={p.id}
                className="flex flex-col gap-3 p-4 md:flex-row md:items-center md:gap-4"
                data-testid="link-pages-row"
                data-default={p.isDefault ? 'true' : 'false'}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <Link
                      href={edit}
                      className="min-w-0 truncate text-sm font-medium text-foreground hover:underline"
                      data-testid="link-pages-name"
                    >
                      {name}
                    </Link>
                    {p.isDefault ? (
                      <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                        {m.defaultBadge}
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground" title={urlOf(p)} data-testid="link-pages-url">
                    {(origin ? urlOf(p) : pathOf(p)).replace(/^https?:\/\//, '')}
                  </p>
                  <p className="mt-0.5 text-xs text-faint">
                    {t(m.buttons, { n: String(p.buttons) })}
                    {' · '}
                    {t(m.edited, { date: formatDate(p.updatedAt, { locale, timeZone }) })}
                  </p>
                </div>

                <label className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                  <Switch
                    checked={p.live}
                    disabled={pending}
                    aria-label={t(m.toggleLabel, { name })}
                    onCheckedChange={(v) => run(() => setPagePublishedAction(p.id, v), v ? m.published : m.unpublished)}
                    data-testid="link-pages-toggle"
                  />
                  <span className="w-24">{p.live ? m.live : m.off}</span>
                </label>

                <div className="flex shrink-0 flex-wrap items-center gap-1">
                  <Link
                    href={edit}
                    className="inline-flex h-8 items-center rounded-md px-3 text-sm font-medium text-foreground hover:bg-muted"
                    data-testid="link-pages-edit"
                  >
                    {m.edit}
                  </Link>
                  <button
                    type="button"
                    className={iconButton}
                    aria-label={copiedId === p.id ? m.copied : m.copyLink}
                    title={copiedId === p.id ? m.copied : m.copyLink}
                    onClick={() => void copy(p)}
                    disabled={!origin}
                    data-testid="link-pages-copy"
                  >
                    <i aria-hidden className={`pi ${copiedId === p.id ? 'pi-check' : 'pi-copy'}`} style={{ fontSize: 13 }} />
                  </button>
                  <button
                    type="button"
                    className={iconButton}
                    aria-label={m.qr}
                    title={m.qr}
                    onClick={() => setQrFor(p)}
                    disabled={!origin}
                    data-testid="link-pages-qr"
                  >
                    <i aria-hidden className="pi pi-qrcode" style={{ fontSize: 13 }} />
                  </button>
                  <button
                    type="button"
                    className={iconButton}
                    aria-label={m.duplicate}
                    title={m.duplicate}
                    onClick={() => run(() => duplicatePageAction(p.id, t(m.copyName, { name })), m.duplicated)}
                    disabled={pending || atMax}
                    data-testid="link-pages-duplicate"
                  >
                    <i aria-hidden className="pi pi-clone" style={{ fontSize: 13 }} />
                  </button>
                  {!p.isDefault ? (
                    <>
                      <button
                        type="button"
                        className={iconButton}
                        aria-label={m.makeDefault}
                        title={m.makeDefault}
                        onClick={() => run(() => makeDefaultPageAction(p.id), m.madeDefault)}
                        disabled={pending}
                        data-testid="link-pages-make-default"
                      >
                        <i aria-hidden className="pi pi-star" style={{ fontSize: 13 }} />
                      </button>
                      <button
                        type="button"
                        className={`${iconButton} hover:text-destructive`}
                        aria-label={m.remove}
                        title={m.remove}
                        onClick={() => void remove(p)}
                        disabled={pending}
                        data-testid="link-pages-delete"
                      >
                        <i aria-hidden className="pi pi-trash" style={{ fontSize: 13 }} />
                      </button>
                    </>
                  ) : (
                    // The main page has neither action; two empty slots keep every row's columns aligned.
                    <span aria-hidden className="hidden h-8 w-[4.25rem] md:block" />
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {qrFor && origin ? (
        <QrModal
          url={urlOf(qrFor)}
          slug={qrFor.isDefault ? initial.accountCode : `${initial.accountCode}-${qrFor.slug}`}
          copied={copiedId === qrFor.id}
          onCopy={() => void copy(qrFor)}
          labels={{
            qrTitle: qr.qrTitle,
            qrIntro: qr.qrIntro,
            qrAlt: qr.qrAlt,
            qrDownloadPng: qr.qrDownloadPng,
            qrDownloadSvg: qr.qrDownloadSvg,
            qrPngFailed: qr.qrPngFailed,
            copyLink: qr.copy,
            copied: qr.copied,
          }}
          onClose={() => setQrFor(null)}
        />
      ) : null}
      {dialog}
    </section>
  );
}
