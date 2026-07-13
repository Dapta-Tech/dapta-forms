'use client';

import { useTransition } from 'react';
import type { Locale } from '@slate/shared';
import { setLocaleAction } from '@/app/admin/locale-actions';

/** F8 language toggle — persists the choice via a cookie (server action) and
 *  re-renders the admin in EN/ES. Mirrors the old app's language selector. */
export function LanguageSwitcher({ locale, label }: { locale: Locale; label: string }) {
  const [pending, start] = useTransition();
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <select
        value={locale}
        disabled={pending}
        onChange={(e) => {
          const next = e.target.value;
          start(() => {
            void setLocaleAction(next);
          });
        }}
        className="w-full max-w-xs rounded-md border border-input bg-background px-3 py-2 text-sm disabled:opacity-60"
      >
        <option value="en">English</option>
        <option value="es">Español</option>
      </select>
    </label>
  );
}
