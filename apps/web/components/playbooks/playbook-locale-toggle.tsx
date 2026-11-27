'use client';

import type { FormsMessages } from '@quill/shared';
import { PLAYBOOK_CONTENT_LOCALES, type PlaybookContentLocale } from '@/lib/playbooks';

type Messages = FormsMessages['admin']['playbooks']['contentLanguage'];

/**
 * The ES / EN toggle of the playbooks: a segmented pair of buttons, the one
 * on screen pressed (`aria-pressed`), in a group named "Language of the
 * playbooks". It changes the language of the resources only, never the
 * platform's; what happens on a change (the address, the stored choice, the
 * event) is the caller's.
 *
 * Each button shows the code and is named by the language with its code
 * ("Spanish (ES)"), so the visible text is part of the accessible name.
 */
export function PlaybookLocaleToggle({
  value,
  onChange,
  m,
  className = '',
}: {
  value: PlaybookContentLocale;
  onChange: (next: PlaybookContentLocale) => void;
  m: Messages;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label={m.label}
      data-testid="playbooks-locale"
      className={`inline-flex shrink-0 items-center gap-0.5 rounded-full bg-muted p-0.5 ${className}`}
    >
      <span aria-hidden className="flex h-7 items-center pl-2 pr-1 text-muted-foreground">
        <i className="pi pi-globe" style={{ fontSize: 14 }} />
      </span>
      {PLAYBOOK_CONTENT_LOCALES.map((locale) => {
        const on = locale === value;
        const code = locale.toUpperCase();
        return (
          <button
            key={locale}
            type="button"
            aria-pressed={on}
            aria-label={`${m.names[locale]} (${code})`}
            data-testid={`playbooks-locale-${locale}`}
            onClick={() => {
              if (!on) onChange(locale);
            }}
            className={`flex h-7 min-w-9 items-center justify-center rounded-full px-2.5 text-xs font-semibold tabular-nums transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${
              on ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {code}
          </button>
        );
      })}
    </div>
  );
}
