'use client';

import { useRef, useState, useTransition } from 'react';
import { commonTimeZones, type BookingMessages } from '@slate/shared';
import { FieldHelp } from '@/components/field-help';
import { Button } from '@/components/ui/button';
import { FormHeader } from '@/components/ui/page-header';
import { createTeamFullAction } from '../actions';

type TeamsMessages = BookingMessages['admin']['teams'];

/** Read an image File as a size/type-validated data URL (offline-safe, no host). */
function readImageFile(file: File, onOk: (dataUrl: string) => void, onErr: (msg: string) => void, m: TeamsMessages) {
  if (!file.type.startsWith('image/')) return onErr(m.imageInvalidType);
  if (file.size > 1_000_000) return onErr(m.imageTooLarge);
  const reader = new FileReader();
  reader.onload = () => onOk(String(reader.result));
  reader.onerror = () => onErr(m.imageReadError);
  reader.readAsDataURL(file);
}

export function CreateTeamForm({
  messages: m,
  defaultTimeZone,
  accountCode,
  backHref,
  backLabel,
  heading,
}: {
  messages: TeamsMessages;
  defaultTimeZone: string;
  accountCode: string;
  backHref: string;
  backLabel: string;
  heading: string;
}) {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [bio, setBio] = useState('');
  const [logoUrl, setLogoUrl] = useState('');
  const [timeZone, setTimeZone] = useState(defaultTimeZone);
  const [err, setErr] = useState<string | null>(null);
  const [imgErr, setImgErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  const onName = (v: string) => {
    setName(v);
    if (!slugTouched) setSlug(v.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''));
  };

  const submit = () =>
    start(async () => {
      setErr(null);
      const r = await createTeamFullAction({
        name: name.trim(),
        slug: slug.trim(),
        bio: bio.trim() || null,
        logoUrl: logoUrl.trim() || null,
        timeZone,
      });
      // A successful create redirects (no return); only an error comes back.
      if (r && !r.ok) setErr(r.message ?? m.genericError);
    });

  return (
    <form onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <FormHeader
        backHref={backHref}
        backLabel={backLabel}
        title={heading}
        actions={
          <Button type="submit" disabled={pending || !name.trim() || !slug.trim()}>
            {pending ? m.creating : m.createTeam}
          </Button>
        }
      />
      <div className="flex max-w-2xl flex-col gap-4 rounded-md border border-border bg-card p-6">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">
          <span className="flex items-center gap-1 text-muted-foreground">
            {m.name}
            <FieldHelp text={m.nameHelp} />
          </span>
          <input value={name} onChange={(e) => onName(e.target.value)} className="rounded-md border border-input bg-background px-3 py-2" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="flex items-center gap-1 text-muted-foreground">
            {m.slug}
            <FieldHelp text={m.slugHelp} />
          </span>
          <input
            value={slug}
            onChange={(e) => {
              setSlug(e.target.value);
              setSlugTouched(true);
            }}
            className="rounded-md border border-input bg-background px-3 py-2"
          />
          {/* Live public-URL preview (R25). */}
          <span className="truncate text-xs text-muted-foreground">
            /{accountCode || '…'}/team/{slug || '…'}
          </span>
        </label>
      </div>

      <label className="flex flex-col gap-1 text-sm">
        <span className="flex items-center gap-1 text-muted-foreground">
          {m.bioLabel}
          <FieldHelp text={m.bioHelp} />
        </span>
        <textarea value={bio} onChange={(e) => setBio(e.target.value)} rows={2} placeholder={m.bioPlaceholder} className="rounded-md border border-input bg-background px-3 py-2" />
      </label>

      <div className="flex flex-col gap-2">
        <span className="flex items-center gap-1 text-sm text-muted-foreground">
          {m.logoLabel}
          <FieldHelp text={m.logoHelp} />
        </span>
        <div className="flex items-center gap-3">
          {logoUrl ? (
            <img src={logoUrl} alt={m.logoLabel} className="h-12 w-12 rounded-md border border-border object-cover" />
          ) : (
            <span className="flex h-12 w-12 items-center justify-center rounded-md border border-dashed border-border text-xs text-muted-foreground">
              {(name.trim()[0] ?? 'T').toUpperCase()}
            </span>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              setImgErr(null);
              if (f) readImageFile(f, setLogoUrl, setImgErr, m);
              e.target.value = '';
            }}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="inline-flex min-h-[44px] items-center rounded-md border border-border px-3 py-2 text-sm hover:border-primary"
          >
            {m.uploadImage}
          </button>
          {logoUrl ? (
            <button
              type="button"
              onClick={() => setLogoUrl('')}
              className="inline-flex min-h-[44px] items-center rounded-md border border-border px-3 py-2 text-sm text-muted-foreground hover:border-destructive hover:text-destructive"
            >
              {m.clearImage}
            </button>
          ) : null}
        </div>
        <input value={logoUrl.startsWith('data:') ? '' : logoUrl} onChange={(e) => setLogoUrl(e.target.value)} placeholder={m.orPasteUrl} className="rounded-md border border-input bg-background px-3 py-2 text-sm" />
        {imgErr ? <p role="alert" className="text-sm text-destructive">{imgErr}</p> : null}
      </div>

      <label className="flex flex-col gap-1 text-sm">
        <span className="text-muted-foreground">{m.timezone}</span>
        <select value={timeZone} onChange={(e) => setTimeZone(e.target.value)} className="rounded-md border border-input bg-background px-3 py-2 text-sm">
          {commonTimeZones(timeZone).map((z) => (
            <option key={z} value={z}>
              {z}
            </option>
          ))}
        </select>
      </label>

      {err ? <p role="alert" className="text-sm text-destructive">{err}</p> : null}
      </div>
    </form>
  );
}
