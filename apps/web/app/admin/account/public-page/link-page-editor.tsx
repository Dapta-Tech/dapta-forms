'use client';

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import type { FormsMessages } from '@quill/shared';
import { t } from '@quill/shared';
import {
  LINK_PAGE_COLOR_FIELDS,
  LINK_PAGE_LOGO_MAX_CHARS,
  LINK_PAGE_MAX_ITEMS,
  LINK_PAGE_SOCIALS,
  isLinkPageLogo,
  linkPageSchema,
  normalizeSocial,
  resolveLinkPage,
  type LinkPage,
  type LinkPageColors,
  type LinkPageInput,
  type LinkPageItem,
  type LinkPageSocial,
} from '@quill/types';
import { isSafeHttpUrl, validateVanitySlug } from '@quill/engine';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { SettingsRow } from '@/components/ui/settings';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/components/toast';
import { LinkPageView } from '@/components/link-page/link-page-view';
import { QrModal } from '@/app/admin/forms/[id]/edit/qr-modal';
import { callAction, isTransportError } from '@/lib/call-action';
import { linkPagePublicPath, workspacePagePath } from '@/lib/public-page';
import type { LinkPageEditorView } from '@/lib/admin-api';
import { makeDefaultPageAction, saveLinkPageAction, savePageAction, type LinkPageActionResult } from './actions';
import { downscaleLogo } from './logo-upload';
import { savedBody, unpublishBody } from './unpublish';

type Msgs = FormsMessages['admin']['linkPage'];

/** One row of the button list, with a key that survives reordering. */
type Row =
  | { key: string; type: 'form'; formId: string }
  | { key: string; type: 'link'; label: string; url: string };

type LogoMode = 'kit' | 'custom' | 'none';

let nextKey = 0;
const newKey = () => `row-${(nextKey += 1)}`;

/** A social value as the editor shows it: stored WhatsApp digits get their `+` back. */
function socialDisplay(network: LinkPageSocial, stored: string | null | undefined): string {
  if (!stored) return '';
  return network === 'whatsapp' ? `+${stored}` : stored;
}

type ColorField = (typeof LINK_PAGE_COLOR_FIELDS)[number];

/** What the colour pickers start from when a field follows the kit: the kit's colour, else a neutral one. */
const PICKER_FALLBACK: Record<ColorField, string> = { primaryColor: '#3ddc84', background: '#ffffff', foreground: '#1a1a1c' };

/** A colour the native picker can show (`#rrggbb`), or null. */
function pickerValue(value: string | null | undefined): string | null {
  if (!value) return null;
  if (/^#[0-9a-fA-F]{6}$/.test(value)) return value.toLowerCase();
  const short = /^#([0-9a-fA-F])([0-9a-fA-F])([0-9a-fA-F])$/.exec(value);
  return short ? `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`.toLowerCase() : null;
}

/** Which slug message to show for a value, or null when it is fine. */
function slugIssue(value: string): 'invalid' | 'reserved' | null {
  return validateVanitySlug(value.trim().toLowerCase());
}

function linkValid(row: Extract<Row, { type: 'link' }>): boolean {
  return row.label.trim().length > 0 && isSafeHttpUrl(row.url.trim());
}

/**
 * The workspace link page editor (Account settings, Public page).
 *
 * Every field writes into one draft. The preview on the right renders that
 * draft through `resolveLinkPage` and `LinkPageView`, the same function and
 * component the public route uses, so what the editor shows is what visitors
 * get. Nothing is stored until Save (or the Published switch, which saves).
 *
 * Any member of the workspace can edit; the API checks membership, not role.
 */
export function LinkPageEditor({
  initial,
  m,
  networks,
  locale,
}: {
  initial: LinkPageEditorView;
  m: Msgs;
  /** Each network's display name, from the public catalog the page itself uses. */
  networks: Record<LinkPageSocial, string>;
  locale: string;
}) {
  const { success, error } = useToast();
  const [pending, start] = useTransition();
  const stored = initial.page;
  // The page as it was last saved, as a body the API accepts again. Turning
  // the page OFF writes this with `enabled: false`, never the draft: a
  // half-typed field must not keep a page published.
  const [lastSaved, setLastSaved] = useState<LinkPageInput | null>(() => savedBody(stored));
  const kitLogo = initial.brandKit?.logo ?? null;

  const [enabled, setEnabled] = useState(stored?.enabled ?? false);
  // Which page this is. The address shown is the SAVED one: a slug typed but
  // not saved does not answer yet.
  const [pageName, setPageName] = useState(initial.name ?? '');
  const [slug, setSlug] = useState(initial.slug ?? '');
  const [savedSlug, setSavedSlug] = useState(initial.slug);
  const [isDefault, setIsDefault] = useState(initial.isDefault);
  const [slugTaken, setSlugTaken] = useState(false);
  const [colors, setColors] = useState<Record<ColorField, string>>(() => ({
    primaryColor: stored?.colors?.primaryColor ?? '',
    background: stored?.colors?.background ?? '',
    foreground: stored?.colors?.foreground ?? '',
  }));
  const [name, setName] = useState(stored?.name ?? '');
  const [bio, setBio] = useState(stored?.bio ?? '');
  const [logoMode, setLogoMode] = useState<LogoMode>(
    stored?.logo === undefined || !stored ? 'kit' : stored.logo === null ? 'none' : 'custom',
  );
  const [logo, setLogo] = useState<string>(typeof stored?.logo === 'string' ? stored.logo : '');
  const [logoError, setLogoError] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>(() =>
    (stored?.items ?? []).map((item) =>
      item.type === 'form'
        ? { key: newKey(), type: 'form' as const, formId: item.formId }
        : { key: newKey(), type: 'link' as const, label: item.label, url: item.url },
    ),
  );
  const [socials, setSocials] = useState<Record<LinkPageSocial, string>>(() => {
    const out = {} as Record<LinkPageSocial, string>;
    for (const n of LINK_PAGE_SOCIALS) out[n] = socialDisplay(n, stored?.socials?.[n]);
    return out;
  });
  const [showErrors, setShowErrors] = useState(false);
  const [pickForm, setPickForm] = useState('');
  const [qrOpen, setQrOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [origin, setOrigin] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => setOrigin(window.location.origin), []);

  const path = savedSlug
    ? linkPagePublicPath(initial.accountCode, { slug: savedSlug, isDefault })
    : workspacePagePath(initial.accountCode);
  const url = `${origin}${path}`;
  const slugProblem = initial.id ? slugIssue(slug) : null;
  const slugMessage = slugProblem === 'invalid' ? m.slugInvalid : slugProblem === 'reserved' ? m.slugReserved : slugTaken ? m.slugTaken : null;
  const formsById = useMemo(() => new Map(initial.forms.map((f) => [f.id, f])), [initial.forms]);
  // A stored button whose form was deleted since is shown nowhere: the public
  // page drops it, so the editor does too, and the next save forgets it.
  const visibleRows = rows.filter((r) => r.type === 'link' || formsById.has(r.formId));
  const usedForms = new Set(visibleRows.flatMap((r) => (r.type === 'form' ? [r.formId] : [])));
  const availableForms = initial.forms.filter((f) => !usedForms.has(f.id));
  const atMax = visibleRows.length >= LINK_PAGE_MAX_ITEMS;

  const socialErrors = useMemo(() => {
    const out: Partial<Record<LinkPageSocial, boolean>> = {};
    for (const n of LINK_PAGE_SOCIALS) {
      if (socials[n].trim() && normalizeSocial(n, socials[n]) == null) out[n] = true;
    }
    return out;
  }, [socials]);
  const logoInvalid = logoMode === 'custom' && (!logo.trim() || !isLinkPageLogo(logo));

  /** The page's own colours, only the ones set; undefined when it follows the kit entirely. */
  function colorsOut(): LinkPageColors | undefined {
    const out: LinkPageColors = {};
    for (const f of LINK_PAGE_COLOR_FIELDS) if (colors[f]) out[f] = colors[f];
    return Object.keys(out).length ? out : undefined;
  }

  /** The draft as the API takes it. */
  function draft(nextEnabled = enabled): LinkPageInput {
    const items: LinkPageInput['items'] = visibleRows.map((r) =>
      r.type === 'form'
        ? { type: 'form' as const, formId: r.formId }
        : { type: 'link' as const, label: r.label.trim(), url: r.url.trim() },
    );
    const socialsOut: Record<string, string | null> = {};
    for (const n of LINK_PAGE_SOCIALS) socialsOut[n] = socials[n].trim() || null;
    return {
      version: 1,
      enabled: nextEnabled,
      name: name.trim() || null,
      bio: bio.trim() || null,
      ...(logoMode === 'kit' ? {} : { logo: logoMode === 'none' ? null : logo.trim() }),
      items,
      socials: socialsOut,
      ...(colorsOut() ? { colors: colorsOut() } : {}),
    };
  }

  // The preview never waits for a valid draft: a half-typed social or link is
  // left out of it, exactly as the public page would leave it out.
  const previewPage = useMemo(() => {
    const page: LinkPage = {
      version: 1,
      enabled: true,
      name: name.trim() || null,
      bio: bio.trim() || null,
      ...(logoMode === 'kit' ? {} : { logo: logoMode === 'none' || !isLinkPageLogo(logo) ? null : logo.trim() }),
      items: visibleRows.flatMap((r): LinkPageItem[] => {
        if (r.type === 'form') return [{ type: 'form', formId: r.formId }];
        return linkValid(r) ? [{ type: 'link', label: r.label.trim(), url: r.url.trim() }] : [];
      }),
      socials: Object.fromEntries(LINK_PAGE_SOCIALS.map((n) => [n, normalizeSocial(n, socials[n])])),
      ...(colorsOut() ? { colors: colorsOut() } : {}),
    };
    return resolveLinkPage(page, {
      accountCode: initial.accountCode,
      accountName: initial.accountName,
      forms: initial.forms,
      brandKit: initial.brandKit,
    });
  }, [name, bio, logoMode, logo, rows, socials, colors, initial]);

  /**
   * Write the page. `withMeta` also sends the internal name and the slug:
   * the Save button does, the Published switch does not (unpublishing must
   * work whatever state the rest of the form is in).
   */
  function persist(body: LinkPageInput, nextEnabled: boolean, withMeta: boolean) {
    const meta = withMeta && initial.id ? { name: pageName.trim(), slug: slug.trim().toLowerCase() } : {};
    start(async () => {
      const res = await callAction<LinkPageActionResult>(() =>
        initial.id ? savePageAction(initial.id, { ...meta, page: body }) : saveLinkPageAction(body),
      );
      if (res.ok) {
        setEnabled(nextEnabled);
        setLastSaved(body);
        if ('slug' in meta && meta.slug) setSavedSlug(meta.slug);
        setSlugTaken(false);
        success(m.saved);
      } else {
        const code = isTransportError(res) ? null : res.code;
        if (code === 'SLUG_TAKEN') {
          setSlugTaken(true);
          error(m.slugTaken);
          return;
        }
        error((isTransportError(res) ? null : res.message) ?? m.error);
      }
    });
  }

  /** Unpublish: always possible, whatever state the draft is in. */
  function unpublish() {
    persist(unpublishBody(lastSaved), false, false);
  }

  function save(nextEnabled = enabled) {
    const body = draft(nextEnabled);
    const parsed = linkPageSchema.safeParse(body);
    if (!parsed.success || slugProblem) {
      setShowErrors(true);
      error(m.fixErrors);
      return false;
    }
    persist(body, nextEnabled, true);
    return true;
  }

  function makeDefault() {
    if (!initial.id) return;
    const id = initial.id;
    start(async () => {
      const res = await callAction<LinkPageActionResult>(() => makeDefaultPageAction(id));
      if (res.ok) {
        setIsDefault(true);
        success(m.madeDefault);
      } else {
        error((isTransportError(res) ? null : res.message) ?? m.error);
      }
    });
  }

  function move(index: number, by: -1 | 1) {
    setRows((current) => {
      const list = current.filter((r) => r.type === 'link' || formsById.has(r.formId));
      const target = index + by;
      if (target < 0 || target >= list.length) return list;
      const next = [...list];
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });
  }

  function updateLink(key: string, patch: Partial<{ label: string; url: string }>) {
    setRows((current) => current.map((r) => (r.key === key && r.type === 'link' ? { ...r, ...patch } : r)));
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    setLogoError(null);
    try {
      const dataUrl = await downscaleLogo(file, LINK_PAGE_LOGO_MAX_CHARS);
      if (!dataUrl) {
        setLogoError(m.logoTooBig);
        return;
      }
      setLogo(dataUrl);
      setLogoMode('custom');
    } catch {
      setLogoError(m.logoInvalid);
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked: the link stays on screen to copy by hand */
    }
  }

  const inputError = 'border-destructive focus-visible:ring-destructive';

  return (
    <section data-testid="public-page-settings" className="mb-10">
      {initial.id ? (
        <Link
          href="/admin/account/public-page"
          className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          data-testid="link-page-back"
        >
          <i aria-hidden className="pi pi-arrow-left" style={{ fontSize: 12 }} />
          {m.back}
        </Link>
      ) : null}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="flex flex-wrap items-center gap-2 text-xl font-semibold tracking-tight">
            <span className="min-w-0 break-words">{initial.id ? pageName.trim() || (isDefault ? m.defaultBadge : m.heading) : m.heading}</span>
            {initial.id && isDefault ? (
              <span
                className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground"
                data-testid="link-page-default-badge"
              >
                {m.defaultBadge}
              </span>
            ) : null}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">{m.subtitle}</p>
          <p className="mt-1 text-xs text-muted-foreground">{m.anyMember}</p>
        </div>
        <label className="flex shrink-0 items-center gap-2 text-sm">
          <Switch
            checked={enabled}
            onCheckedChange={(v) => {
              if (v) save(true);
              else unpublish();
            }}
            disabled={pending}
            aria-label={m.enable}
            data-testid="link-page-enabled"
          />
          {m.enable}
        </label>
      </div>

      {/* The link, with the three things people do with it. */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <span
          className="min-w-0 max-w-full truncate rounded-full bg-muted px-3 py-1.5 text-xs text-muted-foreground"
          data-testid="public-page-url"
          title={url || path}
        >
          {(url || path).replace(/^https?:\/\//, '')}
        </span>
        <Button variant="soft" size="sm" onClick={() => void copy()} data-testid="link-page-copy">
          <i aria-hidden className={`pi ${copied ? 'pi-check' : 'pi-copy'}`} style={{ fontSize: 12 }} />
          {copied ? m.copied : m.copy}
        </Button>
        <Button variant="soft" size="sm" onClick={() => setQrOpen(true)} disabled={!origin} data-testid="link-page-qr">
          <i aria-hidden className="pi pi-qrcode" style={{ fontSize: 12 }} />
          {m.qr}
        </Button>
        {enabled ? (
          <a
            href={path}
            target="_blank"
            rel="noreferrer"
            className="px-2 text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
            data-testid="link-page-open"
          >
            {m.open}
          </a>
        ) : null}
        {initial.id && !isDefault ? (
          <Button variant="ghost" size="sm" onClick={makeDefault} disabled={pending} data-testid="link-page-make-default">
            <i aria-hidden className="pi pi-star" style={{ fontSize: 12 }} />
            {m.makeDefault}
          </Button>
        ) : null}
      </div>
      {initial.id && isDefault && origin ? (
        <p className="mt-3 text-xs text-muted-foreground" data-testid="link-page-default-hint">
          {t(m.defaultHint, { url: url.replace(/^https?:\/\//, '') })}
        </p>
      ) : null}
      {!enabled ? (
        <p className="mt-3 text-sm text-muted-foreground" data-testid="link-page-off-note">
          {m.offNote}
        </p>
      ) : null}

      <div className="mt-6 grid gap-8 xl:grid-cols-[minmax(0,1fr)_400px] xl:items-start">
        <div className="min-w-0 border-t border-border">
          {initial.id ? (
            <>
              <SettingsRow title={m.pageName} hint={m.pageNameHint} first testId="link-page-meta-name-row">
                <Input
                  value={pageName}
                  maxLength={80}
                  aria-label={m.pageName}
                  placeholder={m.pageNamePlaceholder}
                  onChange={(e) => setPageName(e.target.value)}
                  data-testid="link-page-page-name"
                />
              </SettingsRow>
              <SettingsRow
                title={m.slug}
                hint={
                  isDefault
                    ? t(m.defaultHint, { url: url.replace(/^https?:\/\//, '') })
                    : t(m.slugHint, { base: `${(origin || '').replace(/^https?:\/\//, '')}/${initial.accountCode}/p` })
                }
                testId="link-page-meta-slug-row"
              >
                <div className="flex flex-col gap-1">
                  <Input
                    value={slug}
                    maxLength={30}
                    aria-label={m.slug}
                    aria-invalid={Boolean(slugMessage)}
                    className={slugMessage ? inputError : undefined}
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    onChange={(e) => {
                      setSlug(e.target.value.toLowerCase().replace(/\s+/g, '-'));
                      setSlugTaken(false);
                    }}
                    data-testid="link-page-slug"
                  />
                  {slugMessage ? (
                    <p className="text-xs text-destructive" role="alert" data-testid="link-page-slug-error">
                      {slugMessage}
                    </p>
                  ) : null}
                </div>
              </SettingsRow>
            </>
          ) : null}
          {/* ── Header ── */}
          <SettingsRow title={m.logo} hint={m.logoHint} first={!initial.id} testId="link-page-logo-row">
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  className="sr-only"
                  aria-label={m.logoUpload}
                  data-testid="link-page-logo-file"
                  onChange={(e) => void onFile(e.target.files?.[0])}
                />
                <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
                  {m.logoUpload}
                </Button>
                <Button
                  variant={logoMode === 'kit' ? 'soft' : 'ghost'}
                  size="sm"
                  aria-pressed={logoMode === 'kit'}
                  onClick={() => {
                    setLogoMode('kit');
                    setLogoError(null);
                  }}
                  data-testid="link-page-logo-kit"
                >
                  {m.logoUseKit}
                </Button>
                <Button
                  variant={logoMode === 'none' ? 'soft' : 'ghost'}
                  size="sm"
                  aria-pressed={logoMode === 'none'}
                  onClick={() => {
                    setLogoMode('none');
                    setLogoError(null);
                  }}
                  data-testid="link-page-logo-none"
                >
                  {m.logoNone}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground" data-testid="link-page-logo-state">
                {logoMode === 'kit' ? (kitLogo ? m.logoFromKit : m.logoNoKit) : logoMode === 'none' ? m.logoInitials : null}
              </p>
              <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                {m.logoUrl}
                <Input
                  value={logoMode === 'custom' && !logo.startsWith('data:') ? logo : ''}
                  placeholder={m.logoUrlPlaceholder}
                  aria-invalid={showErrors && logoInvalid}
                  className={showErrors && logoInvalid ? inputError : undefined}
                  onChange={(e) => {
                    setLogo(e.target.value);
                    setLogoMode(e.target.value.trim() ? 'custom' : 'kit');
                  }}
                  data-testid="link-page-logo-url"
                />
              </label>
              {logoError || (logoMode === 'custom' && logo.trim() && !isLinkPageLogo(logo)) ? (
                <p className="text-xs text-destructive" role="alert">
                  {logoError ?? m.logoInvalid}
                </p>
              ) : null}
            </div>
          </SettingsRow>

          <SettingsRow title={m.name}>
            <Input
              value={name}
              maxLength={80}
              aria-label={m.name}
              placeholder={initial.accountName}
              onChange={(e) => setName(e.target.value)}
              data-testid="link-page-name"
            />
          </SettingsRow>

          <SettingsRow title={m.bio}>
            <textarea
              value={bio}
              maxLength={280}
              rows={3}
              aria-label={m.bio}
              placeholder={m.bioPlaceholder}
              onChange={(e) => setBio(e.target.value)}
              data-testid="link-page-bio"
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </SettingsRow>

          {/* ── Buttons ── */}
          <SettingsRow title={m.buttonsSection} hint={m.buttonsHint} testId="link-page-buttons-row">
            <div className="flex flex-col gap-3">
              {visibleRows.length === 0 ? (
                <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
                  {m.empty}
                </p>
              ) : (
                <ol className="flex flex-col gap-2" data-testid="link-page-items">
                  {visibleRows.map((row, i) => {
                    const bad = row.type === 'link' && showErrors && !linkValid(row);
                    return (
                      <li
                        key={row.key}
                        className="flex items-start gap-2 rounded-lg border border-border bg-card p-2"
                        data-testid="link-page-item"
                        data-type={row.type}
                      >
                        <div className="flex shrink-0 flex-col">
                          <button
                            type="button"
                            className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted disabled:opacity-30"
                            aria-label={m.moveUp}
                            title={m.moveUp}
                            disabled={i === 0}
                            onClick={() => move(i, -1)}
                            data-testid="link-page-item-up"
                          >
                            <i aria-hidden className="pi pi-chevron-up" style={{ fontSize: 12 }} />
                          </button>
                          <button
                            type="button"
                            className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted disabled:opacity-30"
                            aria-label={m.moveDown}
                            title={m.moveDown}
                            disabled={i === visibleRows.length - 1}
                            onClick={() => move(i, 1)}
                            data-testid="link-page-item-down"
                          >
                            <i aria-hidden className="pi pi-chevron-down" style={{ fontSize: 12 }} />
                          </button>
                        </div>
                        <div className="min-w-0 flex-1 py-1">
                          <span className="text-[11px] font-medium uppercase tracking-wider text-faint">
                            {row.type === 'form' ? m.formTag : m.linkTag}
                          </span>
                          {row.type === 'form' ? (
                            <p className="truncate text-sm text-foreground">
                              {formsById.get(row.formId)?.title || formsById.get(row.formId)?.name}
                            </p>
                          ) : (
                            <div className="mt-1 grid gap-2">
                              <Input
                                value={row.label}
                                maxLength={80}
                                aria-label={m.linkLabel}
                                placeholder={m.linkLabelPlaceholder}
                                aria-invalid={bad && !row.label.trim()}
                                className={bad && !row.label.trim() ? inputError : undefined}
                                onChange={(e) => updateLink(row.key, { label: e.target.value })}
                                data-testid="link-page-link-label"
                              />
                              <Input
                                value={row.url}
                                type="url"
                                inputMode="url"
                                aria-label={m.linkUrl}
                                placeholder={m.linkUrlPlaceholder}
                                aria-invalid={bad && !isSafeHttpUrl(row.url.trim())}
                                className={bad && !isSafeHttpUrl(row.url.trim()) ? inputError : undefined}
                                onChange={(e) => updateLink(row.key, { url: e.target.value })}
                                data-testid="link-page-link-url"
                              />
                              {bad ? <p className="text-xs text-destructive">{m.linkInvalid}</p> : null}
                            </div>
                          )}
                        </div>
                        <button
                          type="button"
                          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-destructive"
                          aria-label={m.remove}
                          title={m.remove}
                          onClick={() => setRows((current) => current.filter((r) => r.key !== row.key))}
                          data-testid="link-page-item-remove"
                        >
                          <i aria-hidden className="pi pi-trash" style={{ fontSize: 14 }} />
                        </button>
                      </li>
                    );
                  })}
                </ol>
              )}

              <div className="flex flex-wrap items-center gap-2">
                {initial.forms.length === 0 ? (
                  <span className="text-xs text-muted-foreground">{m.noForms}</span>
                ) : availableForms.length === 0 ? (
                  <span className="text-xs text-muted-foreground">{m.allFormsAdded}</span>
                ) : (
                  <div className="min-w-[14rem] flex-1 sm:max-w-xs" data-testid="link-page-add-form">
                    <Select
                      value={pickForm}
                      placeholder={m.addForm}
                      ariaLabel={m.addForm}
                      searchable={availableForms.length > 8}
                      locale={locale}
                      disabled={atMax}
                      options={availableForms.map((f) => ({ value: f.id, label: f.title || f.name }))}
                      onChange={(id) => {
                        if (!id || atMax) return;
                        setRows((current) => [...current, { key: newKey(), type: 'form', formId: id }]);
                        setPickForm('');
                      }}
                    />
                  </div>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  disabled={atMax}
                  onClick={() => setRows((current) => [...current, { key: newKey(), type: 'link', label: '', url: '' }])}
                  data-testid="link-page-add-link"
                >
                  <i aria-hidden className="pi pi-plus" style={{ fontSize: 12 }} />
                  {m.addLink}
                </Button>
              </div>
              {atMax ? (
                <p className="text-xs text-muted-foreground">{t(m.maxItems, { max: String(LINK_PAGE_MAX_ITEMS) })}</p>
              ) : null}
            </div>
          </SettingsRow>

          {/* ── Socials ── */}
          <SettingsRow title={m.socialsSection} hint={m.socialsHint} testId="link-page-socials-row">
            <div className="grid gap-3">
              {LINK_PAGE_SOCIALS.map((n) => {
                const bad = Boolean(socialErrors[n]);
                return (
                  <label key={n} className="grid gap-1 text-xs text-muted-foreground">
                    {networks[n]}
                    <Input
                      value={socials[n]}
                      maxLength={512}
                      type={n === 'whatsapp' ? 'tel' : 'text'}
                      inputMode={n === 'whatsapp' ? 'tel' : 'url'}
                      autoComplete="off"
                      placeholder={m.socialPlaceholders[n]}
                      aria-invalid={bad}
                      className={bad ? inputError : undefined}
                      onChange={(e) => setSocials((s) => ({ ...s, [n]: e.target.value }))}
                      onBlur={() => {
                        // Show the stored form as soon as it is recognised, so
                        // `@acme` visibly becomes the link that will be saved.
                        const normalized = normalizeSocial(n, socials[n]);
                        if (normalized) setSocials((s) => ({ ...s, [n]: socialDisplay(n, normalized) }));
                      }}
                      data-testid={`link-page-input-${n}`}
                    />
                    {bad ? (
                      <span className="text-destructive" role="alert">
                        {n === 'whatsapp' ? m.whatsappInvalid : t(m.socialInvalid, { network: networks[n] })}
                      </span>
                    ) : n === 'whatsapp' ? (
                      <span>{m.whatsappHint}</span>
                    ) : null}
                  </label>
                );
              })}
            </div>
          </SettingsRow>

          {/* ── Colours: this page over the brand kit ── */}
          <SettingsRow title={m.colorsSection} hint={m.colorsHint} testId="link-page-colors-row">
            <div className="grid gap-3">
              {LINK_PAGE_COLOR_FIELDS.map((f) => {
                const label = f === 'primaryColor' ? m.colorPrimary : f === 'background' ? m.colorBackground : m.colorForeground;
                const own = colors[f];
                const shown = pickerValue(own) ?? pickerValue(initial.brandKit?.[f] ?? null) ?? PICKER_FALLBACK[f];
                return (
                  <div key={f} className="flex flex-col gap-1 text-xs text-muted-foreground" data-testid={`link-page-color-${f}`}>
                    <span>{label}</span>
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        type="color"
                        value={shown}
                        aria-label={label}
                        onChange={(e) => setColors((c) => ({ ...c, [f]: e.target.value }))}
                        className="h-9 w-12 shrink-0 cursor-pointer rounded-md border border-input bg-background p-1"
                        data-testid={`link-page-color-input-${f}`}
                      />
                      {own ? (
                        <button
                          type="button"
                          className="whitespace-nowrap text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
                          onClick={() => setColors((c) => ({ ...c, [f]: '' }))}
                          data-testid={`link-page-color-reset-${f}`}
                        >
                          {m.colorReset}
                        </button>
                      ) : (
                        <span className="whitespace-nowrap">{m.colorFromKit}</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </SettingsRow>

          <div className="flex items-center gap-3 border-t border-border pt-6">
            <Button onClick={() => save()} disabled={pending} data-testid="link-page-save">
              {pending ? m.saving : m.save}
            </Button>
          </div>
        </div>

        {/* ── Preview: the public page's own component, in a phone-sized frame. ── */}
        <div className="flex min-w-0 flex-col gap-2 xl:sticky xl:top-6">
          <span className="text-xs font-medium uppercase tracking-wider text-faint">{m.preview}</span>
          <div
            className="mx-auto h-[640px] w-full max-w-[400px] overflow-y-auto rounded-[28px] border border-border shadow-sm"
            data-testid="link-page-preview"
            // `inert`: the preview is to look at. A click must not navigate
            // the editor away, and its links must not take keyboard focus.
            inert
          >
            <LinkPageView page={previewPage} locale={locale} preview />
          </div>
        </div>
      </div>

      {qrOpen && origin ? (
        <QrModal
          url={url}
          slug={savedSlug && !isDefault ? `${initial.accountCode}-${savedSlug}` : initial.accountCode}
          copied={copied}
          onCopy={() => void copy()}
          labels={{
            qrTitle: m.qrTitle,
            qrIntro: m.qrIntro,
            qrAlt: m.qrAlt,
            qrDownloadPng: m.qrDownloadPng,
            qrDownloadSvg: m.qrDownloadSvg,
            qrPngFailed: m.qrPngFailed,
            copyLink: m.copy,
            copied: m.copied,
          }}
          onClose={() => setQrOpen(false)}
        />
      ) : null}
    </section>
  );
}
