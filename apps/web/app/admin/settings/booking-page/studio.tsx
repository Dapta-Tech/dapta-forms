'use client';

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import {
  ALL_BOOKING_THEMES,
  THEME_PRESETS,
  accentVars,
  widgetStyleVars,
  brandingClassOf,
  clampAccent,
  accentWasAdjusted,
  accentLabelContrast,
  onAccent,
  matchTheme,
  monogram,
  t,
  type BookingMessages,
  type PublicBranding,
} from '@slate/shared';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/toast';
import { CopyLink } from '@/components/copy-link';
import { checkHandleAction, saveStudioAction, toggleEventHiddenAction } from './actions';

type StudioMessages = BookingMessages['admin']['studio'];

type Axes = Pick<
  PublicBranding,
  'template' | 'cardStyle' | 'corners' | 'buttons' | 'density' | 'font' | 'slotLayout' | 'dayGroup' | 'slotSelect'
>;

const AXIS_LABEL: Record<keyof Axes, keyof StudioMessages> = {
  template: 'axisTemplate',
  cardStyle: 'axisCardStyle',
  corners: 'axisCorners',
  buttons: 'axisButtons',
  density: 'axisDensity',
  font: 'axisFont',
  slotLayout: 'axisSlotLayout',
  dayGroup: 'axisDayGroup',
  slotSelect: 'axisSlotSelect',
};

const AXIS_OPTIONS: Record<keyof Axes, string[]> = {
  template: ['classic', 'split', 'banded'],
  cardStyle: ['outline', 'elevated', 'filled'],
  corners: ['sharp', 'soft', 'round'],
  buttons: ['rounded', 'pill', 'square'],
  density: ['comfortable', 'compact'],
  font: ['sans', 'rounded', 'serif'],
  slotLayout: ['grid', 'list'],
  dayGroup: ['flat', 'boxed'],
  slotSelect: ['soft', 'solid'],
};

const ACCENT_PRESETS = ['#cbe84f', '#9059fc', '#4f9cff', '#4fd18b', '#ff9f4f', '#ff6fae'];

interface EventTypeLite {
  slug: string;
  title: string;
  lengthMinutes: number;
}

/** Read an image file to a data-URL (like the old app): image/* only, ≤1MB.
 *  Returns a stable error code the caller localizes. */
function readImageFile(file: File): Promise<{ ok: true; dataUrl: string } | { ok: false; code: 'invalid' | 'tooLarge' | 'read' }> {
  return new Promise((resolve) => {
    if (!file.type.startsWith('image/')) return resolve({ ok: false, code: 'invalid' });
    if (file.size > 1024 * 1024) return resolve({ ok: false, code: 'tooLarge' });
    const reader = new FileReader();
    reader.onload = () => resolve({ ok: true, dataUrl: String(reader.result) });
    reader.onerror = () => resolve({ ok: false, code: 'read' });
    reader.readAsDataURL(file);
  });
}

export interface StudioInit {
  accountCode: string;
  /** Vanity claim state: the shareable-link section renders from this. */
  vanity: { vanitySlug: string | null; shortCode: string; canClaim: boolean };
  /** Where "included with your Dapta AI subscription" links (deploy-config
   *  destination, same switch as the growth badge; null = plain text). */
  subscriptionUrl: string | null;
  displayName: string;
  handle: string;
  bio: string;
  avatarUrl: string;
  coverUrl: string;
  accent: string;
  axes: Axes;
  landingEnabled: boolean;
  defaultEventSlug: string | null;
  eventTypes: EventTypeLite[];
  manageableEvents: { id: string; slug: string; title: string; hidden: boolean }[];
  eventOrder: string[];
  messages: StudioMessages;
}

type HandleState = 'idle' | 'checking' | 'available' | 'taken' | 'invalid';

export function Studio(init: StudioInit) {
  const m = init.messages;
  const [displayName, setDisplayName] = useState(init.displayName);
  const [handle, setHandle] = useState(init.handle);
  const [vanity, setVanity] = useState(init.vanity.vanitySlug ?? '');
  const [bio, setBio] = useState(init.bio);
  const [avatarUrl, setAvatarUrl] = useState(init.avatarUrl);
  const [coverUrl, setCoverUrl] = useState(init.coverUrl);
  const [accent, setAccent] = useState(init.accent);
  const [axes, setAxes] = useState<Axes>(init.axes);
  const [landingEnabled, setLandingEnabled] = useState(init.landingEnabled);
  const [defaultEventSlug, setDefaultEventSlug] = useState(init.defaultEventSlug ?? '');
  // Slug order: saved order first, then any events not yet in it.
  const [eventOrder, setEventOrder] = useState<string[]>(() => {
    const all = init.manageableEvents.map((e) => e.slug);
    const ordered = init.eventOrder.filter((s) => all.includes(s));
    return [...ordered, ...all.filter((s) => !ordered.includes(s))];
  });
  const [eventPending, startEvent] = useTransition();
  const router = useRouter();
  const toast = useToast();

  const moveEvent = (slug: string, dir: -1 | 1) =>
    setEventOrder((o) => {
      const i = o.indexOf(slug);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= o.length) return o;
      const next = [...o];
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    });
  const toggleHidden = (id: string, hidden: boolean) =>
    startEvent(async () => {
      const r = await toggleEventHiddenAction(id, hidden);
      if (r.ok) {
        toast.success(hidden ? m.eventHidden : m.eventShown);
        router.refresh();
      } else {
        toast.error(r.message ?? m.couldNotUpdateVisibility);
      }
    });
  const [customizeOpen, setCustomizeOpen] = useState(matchTheme(init.axes) === null);
  const [surface, setSurface] = useState<'profile' | 'booking'>('profile');
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop');
  const [handleState, setHandleState] = useState<HandleState>('idle');
  const [handleSuggestion, setHandleSuggestion] = useState<string | null>(null);
  const [saved, setSaved] = useState<'idle' | 'ok' | 'err'>('idle');
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const snapshot = useMemo(
    () => JSON.stringify({ displayName, handle, vanity, bio, avatarUrl, coverUrl, accent, axes, landingEnabled, defaultEventSlug, eventOrder }),
    [displayName, handle, vanity, bio, avatarUrl, coverUrl, accent, axes, landingEnabled, defaultEventSlug, eventOrder],
  );
  const initialSnapshot = useRef(snapshot);
  const isDirty = snapshot !== initialSnapshot.current;

  const activeTheme = useMemo(() => matchTheme(axes), [axes]);
  const previewVars = useMemo(
    () => ({ ...accentVars(accent), ...widgetStyleVars(axes) }) as Record<string, string>,
    [accent, axes],
  );
  const adjusted = accentWasAdjusted(accent);

  // Live handle availability (debounced, per-account).
  useEffect(() => {
    if (handle === init.handle) {
      setHandleState('idle');
      return;
    }
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(handle) || handle.length < 3) {
      setHandleState('invalid');
      return;
    }
    setHandleState('checking');
    const t = setTimeout(async () => {
      try {
        // Server action (identity-scoped endpoint — no client-side API fetch).
        const j = await checkHandleAction(handle);
        setHandleState(j.available ? 'available' : 'taken');
        setHandleSuggestion(j.available ? null : (j.suggestion ?? null));
      } catch {
        setHandleState('idle');
      }
    }, 350);
    return () => clearTimeout(t);
  }, [handle, init.handle]);

  const applyTheme = (t: keyof typeof THEME_PRESETS) => setAxes({ ...THEME_PRESETS[t] });
  const setAxis = (k: keyof Axes, v: string) => setAxes((a) => ({ ...a, [k]: v as never }));
  const handleBlocksSave = handleState === 'taken' || handleState === 'invalid' || handleState === 'checking';

  const reset = () => {
    setDisplayName(init.displayName);
    setHandle(init.handle);
    setBio(init.bio);
    setAvatarUrl(init.avatarUrl);
    setCoverUrl(init.coverUrl);
    setAccent(init.accent);
    setAxes(init.axes);
    setLandingEnabled(init.landingEnabled);
    setDefaultEventSlug(init.defaultEventSlug ?? '');
    setEventOrder(() => {
      const all = init.manageableEvents.map((e) => e.slug);
      const ordered = init.eventOrder.filter((s) => all.includes(s));
      return [...ordered, ...all.filter((s) => !ordered.includes(s))];
    });
  };

  const save = () =>
    start(async () => {
      const vanityTrim = vanity.trim().toLowerCase();
      const vanityChanged = init.vanity.canClaim && vanityTrim !== (init.vanity.vanitySlug ?? '');
      const r = await saveStudioAction({
        handle: handle !== init.handle ? handle : undefined,
        // One Save persists everything (R30): the vanity change rides along.
        vanitySlug: vanityChanged ? vanityTrim || null : undefined,
        displayName,
        avatarUrl: avatarUrl.trim() || null,
        coverUrl: coverUrl.trim() || null,
        brandColor: clampAccent(accent),
        style: { ...axes, bio: bio.trim() || null, landingEnabled, defaultEventSlug: defaultEventSlug || null, eventOrder },
      });
      if (r.ok) {
        setSaved('ok');
        setSaveMsg(null);
        initialSnapshot.current = snapshot;
      } else {
        setSaved('err');
        setSaveMsg(r.message ?? m.saveFailed);
      }
    });

  return (
    <div className="flex flex-col gap-6">
      {/* Header: dirty chip + Reset/Save top-right */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span
            className={`rounded-sm px-2 py-1 text-xs ${
              isDirty ? 'bg-secondary text-secondary-foreground' : 'bg-muted text-muted-foreground'
            }`}
          >
            {isDirty ? m.unsavedChanges : m.allChangesSaved}
          </span>
          {saved === 'ok' ? <span className="text-sm text-primary">{m.saved}</span> : null}
          {saved === 'err' ? <span className="text-sm text-destructive">{saveMsg}</span> : null}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={reset}
            disabled={!isDirty || pending}
            className="rounded-md border border-border px-4 py-2 text-sm disabled:opacity-50"
          >
            {m.reset}
          </button>
          <button
            type="button"
            onClick={save}
            disabled={!isDirty || pending || handleBlocksSave}
            className="rounded-md bg-primary px-5 py-2 font-semibold text-primary-foreground transition-transform active:scale-[0.98] disabled:opacity-60"
          >
            {pending ? m.saving : m.save}
          </button>
        </div>
      </div>

      <div className="grid gap-8 lg:grid-cols-[400px_1fr]">
        {/* Controls */}
        <div className="flex flex-col gap-6">
          {/* PROFILE */}
          <Section title={m.profile}>
            <Field label={m.displayName}>
              <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} className={inputCls} />
            </Field>
            <Field label={m.publicHandle}>
              <input
                value={handle}
                onChange={(e) => setHandle(e.target.value.toLowerCase())}
                className={inputCls}
              />
              <HandleHint state={handleState} m={m} />
              {handleState === 'taken' && handleSuggestion ? (
                <button
                  type="button"
                  onClick={() => setHandle(handleSuggestion)}
                  className="self-start text-xs text-primary hover:underline"
                >
                  {t(m.tryHandle, { handle: handleSuggestion })}
                </button>
              ) : null}
            </Field>
            {/* The shareable link as ONE compact copyable unit (no raw hex —
                short-links §5). Live preview: edits to the handle/vanity above
                update the path immediately. */}
            <Field label={m.yourLink}>
              <CopyLink
                path={`/${(init.vanity.canClaim && vanity.trim().toLowerCase()) || init.vanity.shortCode || init.accountCode}/${handle || init.handle}`}
                labels={{ copy: m.linkCopy, copied: m.linkCopied, open: m.linkOpen }}
              />
            </Field>
            {init.vanity.canClaim ? (
              <Field label={m.vanityLabel}>
                <input
                  value={vanity}
                  onChange={(e) => setVanity(e.target.value.toLowerCase())}
                  placeholder={init.vanity.shortCode}
                  className={inputCls}
                />
                <span className="text-xs text-muted-foreground">{m.vanityHint}</span>
              </Field>
            ) : (
              <p className="text-xs text-muted-foreground">
                {m.vanityIncluded}
                {init.subscriptionUrl ? (
                  <>
                    {' '}
                    <a
                      href={init.subscriptionUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-primary hover:underline"
                    >
                      {m.vanityIncludedLink}
                    </a>
                  </>
                ) : null}
              </p>
            )}
            <Field label={m.bio}>
              <textarea value={bio} onChange={(e) => setBio(e.target.value)} rows={2} className={inputCls} />
            </Field>
          </Section>

          {/* BRAND */}
          <Section title={m.brand}>
            <Field label={m.accent}>
              <div className="mb-2 flex flex-wrap gap-2">
                {ACCENT_PRESETS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setAccent(c)}
                    aria-label={c}
                    style={{ background: c }}
                    className={`h-7 w-7 rounded-full border-2 ${
                      accent.toLowerCase() === c ? 'border-foreground' : 'border-transparent'
                    }`}
                  />
                ))}
                <input
                  type="color"
                  value={/^#[0-9a-fA-F]{6}$/.test(accent) ? accent : '#cbe84f'}
                  onChange={(e) => setAccent(e.target.value)}
                  className="h-7 w-9 rounded-md border border-input bg-background"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                {t(m.contrast, { ratio: accentLabelContrast(accent) })}
                {adjusted ? t(m.adjustedNote, { hex: clampAccent(accent) }) : ''}
              </p>
            </Field>
            <Field label={m.photoAvatar}>
              <ImageInput value={avatarUrl} onChange={setAvatarUrl} preview="avatar" m={m} />
            </Field>
            <Field label={m.coverImage}>
              <ImageInput value={coverUrl} onChange={setCoverUrl} preview="cover" m={m} />
            </Field>
          </Section>

          {/* APPEARANCE */}
          <Section title={m.appearance}>
            <div className="mb-3 flex flex-wrap gap-2">
              {ALL_BOOKING_THEMES.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => applyTheme(t)}
                  className={`rounded-md border px-3 py-1.5 text-sm capitalize transition-transform active:scale-[0.97] ${
                    activeTheme === t ? 'border-primary bg-primary text-primary-foreground' : 'border-border'
                  }`}
                >
                  {t}
                </button>
              ))}
              <span className="self-center text-xs text-muted-foreground">{activeTheme ? '' : m.custom}</span>
            </div>
            <button
              type="button"
              onClick={() => setCustomizeOpen((o) => !o)}
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              {customizeOpen ? '▾' : '▸'} {m.customizeAppearance}
            </button>
            {customizeOpen ? (
              <div className="mt-3 grid grid-cols-2 gap-3">
                {(Object.keys(AXIS_OPTIONS) as (keyof Axes)[]).map((k) => (
                  <label key={k} className="flex flex-col gap-1 text-sm">
                    <span className="text-muted-foreground">{m[AXIS_LABEL[k]]}</span>
                    <select
                      value={axes[k]}
                      onChange={(e) => setAxis(k, e.target.value)}
                      data-testid={`bp-${k}-${axes[k]}`}
                      className="rounded-md border border-input bg-background px-2 py-1.5 capitalize"
                    >
                      {AXIS_OPTIONS[k].map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
            ) : null}
          </Section>

          {/* MEETINGS — reorder (↑/↓) + show/hide on the public page */}
          <Section title={m.meetings}>
            <ul className="flex flex-col gap-1 text-sm">
              {eventOrder
                .map((s) => init.manageableEvents.find((e) => e.slug === s))
                .filter((e): e is NonNullable<typeof e> => !!e)
                .map((et, i, arr) => (
                  <li
                    key={et.slug}
                    className={`flex items-center gap-2 rounded-sm bg-muted px-2 py-1.5 ${et.hidden ? 'opacity-50' : ''}`}
                  >
                    <span className="flex flex-col">
                      <button type="button" aria-label={m.moveUp} disabled={i === 0} onClick={() => moveEvent(et.slug, -1)} className="leading-none text-muted-foreground hover:text-foreground disabled:opacity-30">▲</button>
                      <button type="button" aria-label={m.moveDown} disabled={i === arr.length - 1} onClick={() => moveEvent(et.slug, 1)} className="leading-none text-muted-foreground hover:text-foreground disabled:opacity-30">▼</button>
                    </span>
                    <span className="flex-1 truncate">{et.title}</span>
                    <button
                      type="button"
                      disabled={eventPending}
                      onClick={() => toggleHidden(et.id, !et.hidden)}
                      className="rounded-sm border border-border px-2 py-0.5 text-xs text-muted-foreground hover:border-primary disabled:opacity-60"
                    >
                      {et.hidden ? m.show : m.hide}
                    </button>
                  </li>
                ))}
              {init.manageableEvents.length === 0 ? <li className="text-muted-foreground">{m.noEvents}</li> : null}
            </ul>
            <p className="mt-1 text-xs text-muted-foreground">{m.orderVisibilityNote}</p>
            <a href="/admin/event-types" className="mt-1 inline-block text-xs text-primary hover:underline">
              {m.configureEventTypes}
            </a>

            {/* Landing (R25): show the picker, or send visitors straight to one event. */}
            <div className="mt-4 flex flex-col gap-2 border-t border-border pt-3">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={landingEnabled}
                  onChange={(e) => setLandingEnabled(e.target.checked)}
                />
                {m.showLandingPage}
              </label>
              {!landingEnabled ? (
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-muted-foreground">{m.sendVisitorsTo}</span>
                  <select
                    value={defaultEventSlug}
                    onChange={(e) => setDefaultEventSlug(e.target.value)}
                    className={inputCls}
                  >
                    <option value="">{m.chooseEvent}</option>
                    {init.eventTypes.map((et) => (
                      <option key={et.slug} value={et.slug}>
                        {et.title}
                      </option>
                    ))}
                  </select>
                  {!defaultEventSlug ? (
                    <span className="text-xs text-destructive">{m.pickDefaultEvent}</span>
                  ) : null}
                </label>
              ) : null}
            </div>
          </Section>
        </div>

        {/* Live preview (sticky) */}
        <div className="lg:sticky lg:top-6 lg:self-start">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex rounded-md border border-border p-0.5 text-sm">
              {(['profile', 'booking'] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setSurface(s)}
                  className={`rounded-sm px-3 py-1 ${surface === s ? 'bg-accent' : ''}`}
                >
                  {s === 'booking' ? m.bookingFlow : m.previewProfile}
                </button>
              ))}
            </div>
            <div className="flex rounded-md border border-border p-0.5 text-sm">
              {(['desktop', 'mobile'] as const).map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setDevice(d)}
                  className={`rounded-sm px-3 py-1 capitalize ${device === d ? 'bg-accent' : ''}`}
                >
                  {d === 'desktop' ? m.desktop : m.mobile}
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-md border border-border p-6" style={previewVars}>
            <div className={`${brandingClassOf(axes)} ${device === 'mobile' ? 'mx-auto w-[360px]' : 'mx-auto max-w-md'}`}>
              {surface === 'profile' ? (
                <ProfilePreview
                  displayName={displayName}
                  bio={bio}
                  avatarUrl={avatarUrl}
                  coverUrl={coverUrl}
                  accent={accent}
                  eventTypes={init.eventTypes}
                  m={m}
                />
              ) : (
                <BookingPreview accent={accent} m={m} />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ProfilePreview({
  displayName,
  bio,
  avatarUrl,
  coverUrl,
  accent,
  eventTypes,
  m,
}: {
  displayName: string;
  bio: string;
  avatarUrl: string;
  coverUrl: string;
  accent: string;
  eventTypes: EventTypeLite[];
  m: StudioMessages;
}) {
  return (
    <div>
      {coverUrl ? (
        <img src={coverUrl} alt="" className="bp-cover mb-3 h-24 w-full rounded-md object-cover" />
      ) : (
        <div className="bp-cover mb-3 h-20 w-full rounded-md" style={{ background: 'var(--accent-wash)' }} />
      )}
      <div className="mb-4 flex items-center gap-3">
        {avatarUrl ? (
          <img src={avatarUrl} alt="" className="h-12 w-12 rounded-full object-cover" />
        ) : (
          <div
            className="flex h-12 w-12 items-center justify-center text-lg font-semibold"
            style={{ background: 'var(--accent)', color: onAccent(clampAccent(accent)), borderRadius: 'var(--bp-radius)' }}
          >
            {monogram(displayName)}
          </div>
        )}
        <div>
          <div style={{ fontFamily: 'var(--bp-font-display)' }} className="text-lg font-semibold">
            {displayName}
          </div>
          {bio ? <div className="text-sm text-muted-foreground">{bio}</div> : null}
        </div>
      </div>
      <div className="flex flex-col" style={{ gap: 'var(--bp-gap)' }}>
        {(eventTypes.length ? eventTypes : [{ slug: 'intro', title: m.introCall, lengthMinutes: 30 }]).map((et) => (
          <div key={et.slug} className="bp-card flex items-center justify-between">
            <span className="font-medium">{et.title}</span>
            <span className="text-sm text-muted-foreground">{et.lengthMinutes} {m.minSuffix}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function BookingPreview({ accent: _accent, m }: { accent: string; m: StudioMessages }) {
  return (
    <div>
      <div className="bp-card mb-4">
        <div className="font-medium">{m.introCall}</div>
        <div className="text-sm text-muted-foreground">30 {m.minSuffix}</div>
      </div>
      <div className="bp-slots">
        {['9:00', '9:30', '10:00', '10:30'].map((s, i) => (
          <button key={s} type="button" aria-pressed={i === 0} className="bp-slot text-sm">
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

function HandleHint({ state, m }: { state: HandleState; m: StudioMessages }) {
  const map: Record<HandleState, { text: string; cls: string } | null> = {
    idle: null,
    checking: { text: m.checking, cls: 'text-muted-foreground' },
    available: { text: m.available, cls: 'text-primary' },
    taken: { text: m.taken, cls: 'text-destructive' },
    invalid: { text: m.invalid, cls: 'text-destructive' },
  };
  const h = map[state];
  return h ? <span className={`text-xs ${h.cls}`}>{h.text}</span> : null;
}

const inputCls = 'rounded-md border border-input bg-background px-3 py-2 w-full';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded-md border border-border bg-card p-4">
      <h3 className="text-sm font-semibold text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

/** Image picker: upload (data-URL, 1MB/type-validated) with a preview + clear,
 *  or paste a URL. Matches the old app's dropzone-to-data-URL behaviour. */
function ImageInput({
  value,
  onChange,
  preview,
  m,
}: {
  value: string;
  onChange: (v: string) => void;
  preview: 'avatar' | 'cover';
  m: StudioMessages;
}) {
  const [err, setErr] = useState<string | null>(null);
  const isData = value.startsWith('data:');
  const errText = (code: 'invalid' | 'tooLarge' | 'read') =>
    code === 'invalid' ? m.imageInvalid : code === 'tooLarge' ? m.imageTooLarge : m.couldNotRead;
  return (
    <div className="flex flex-col gap-2">
      {value ? (
        <img
          src={value}
          alt=""
          className={preview === 'avatar' ? 'h-12 w-12 rounded-full object-cover' : 'h-16 w-full rounded-md object-cover'}
        />
      ) : null}
      <div className="flex items-center gap-2">
        <label className="cursor-pointer rounded-md border border-border px-3 py-1.5 text-xs transition-colors hover:border-primary">
          {m.uploadImage}
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              const r = await readImageFile(f);
              if (r.ok) {
                onChange(r.dataUrl);
                setErr(null);
              } else {
                setErr(errText(r.code));
              }
            }}
          />
        </label>
        {value ? (
          <button
            type="button"
            onClick={() => {
              onChange('');
              setErr(null);
            }}
            className="text-xs text-muted-foreground hover:text-destructive"
          >
            {m.clear}
          </button>
        ) : null}
      </div>
      <input
        value={isData ? '' : value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={m.orPasteUrl}
        className={inputCls}
      />
      {err ? <span className="text-xs text-destructive">{err}</span> : null}
    </div>
  );
}
