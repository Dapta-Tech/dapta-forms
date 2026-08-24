'use client';

import { useState, useTransition } from 'react';
import type { FormsMessages, Locale } from '@quill/shared';
import { setLocaleAction } from '@/app/admin/locale-actions';
import { Select } from '@/components/ui/select';
import { callAction, isTransportError } from '@/lib/call-action';

type PreferencesMessages = FormsMessages['admin']['account']['preferences'];

/**
 * The language control.
 *
 * A `Select` rather than the segmented toggle the theme uses: the options are
 * language NAMES, each written in its own language ("Español", not "Spanish"),
 * because the one person who most needs to find this control is the one who
 * cannot currently read the page. That also means the labels are literals and
 * never come from the catalog - translating them would defeat the point.
 *
 * The whole page re-renders in the new language on success, which is the only
 * confirmation this needs: nothing that says "saved" would be as convincing as
 * the heading above it changing. A failure is the case that does need words,
 * because the screen would otherwise look exactly like a no-op, so the previous
 * value stays selected and the error takes its place under the control.
 */
export function LanguageSettings({ locale, m }: { locale: Locale; m: PreferencesMessages }) {
  const [pending, start] = useTransition();
  const [failed, setFailed] = useState(false);

  const choose = (next: string) => {
    setFailed(false);
    start(async () => {
      const res = await callAction(() => setLocaleAction(next === 'es' ? 'es' : 'en'));
      // A transport failure and a refusal land in the same place on purpose:
      // neither stored anything, so from here they are one outcome.
      setFailed(isTransportError(res) || !res.ok);
    });
  };

  return (
    <section className="rounded-xl border border-border bg-card p-6" data-testid="preferences-language">
      <h2 className="text-lg font-semibold tracking-tight">{m.title}</h2>
      <p className="mt-0.5 text-sm text-muted-foreground">{m.subtitle}</p>

      <label className="mt-5 flex flex-col gap-1.5 text-sm">
        <span className="font-medium text-foreground">{m.languageLabel}</span>
        <div className="max-w-xs">
          <Select
            ariaLabel={m.languageLabel}
            locale={locale}
            value={locale}
            disabled={pending}
            id="language-select"
            onChange={choose}
            options={[
              { value: 'en', label: 'English' },
              { value: 'es', label: 'Español' },
            ]}
          />
        </div>
      </label>

      <p className="mt-2 max-w-prose text-sm text-muted-foreground">{m.languageHelp}</p>

      {failed ? (
        <p
          role="alert"
          data-testid="language-error"
          className="mt-3 text-sm text-destructive"
        >
          {m.languageError}
        </p>
      ) : null}
    </section>
  );
}
