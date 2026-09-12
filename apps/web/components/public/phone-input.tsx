'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  COUNTRIES,
  countryName,
  formatPhoneDigits,
  getMessages,
  longestDialPrefix,
  phoneNsnRange,
  phoneSubscriberDigits,
  type Country,
} from '@quill/shared';

/**
 * PhoneInput — the public form's `phone` step: an ISO country-code selector
 * (flag + dial + searchable listbox) beside a digits-only number input,
 * emitting a single E.164 string ('+525512345678') or ''. Replaces the bare
 * `<input type="tel">`, which accepted any text and gave respondents no
 * dial-code guidance.
 *
 * Styled with the renderer's BEM `pf-*` classes (NOT Tailwind) so it matches the
 * public surface, and it reuses the SearchableDropdown keyboard/ARIA model:
 * a combobox-style trigger opens a panel with a search box and native <button>
 * options navigated by real DOM focus (ArrowUp/Down), Enter/Space to pick,
 * Escape to close. The stored value is always bare E.164 regardless of the
 * grouped display in the input.
 */

const US = COUNTRIES.find((c) => c.code === 'US')!;

/** ISO alpha-2 the selector starts on, from the form locale (es → MX, else US). */
function defaultCountryForLocale(locale: string): Country {
  if (locale.toLowerCase().startsWith('es')) {
    return COUNTRIES.find((c) => c.code === 'MX') ?? US;
  }
  return US;
}

/**
 * The country the picker starts on: the form's configured `defaultCountry`
 * (ISO alpha-2, e.g. "CO") when it resolves to a known country, else the
 * locale-based default. A bad/unknown code can only fall back, never break.
 */
function initialCountry(defaultCountry: string | null | undefined, locale: string): Country {
  if (defaultCountry) {
    const code = defaultCountry.trim().toUpperCase();
    const found = COUNTRIES.find((c) => c.code === code);
    if (found) return found;
  }
  return defaultCountryForLocale(locale);
}

/** The country a value implies. Shared dials (+1 is US/CA/…) are ambiguous:
 *  keep the already-picked country when it fits, else fall back to US. */
function deriveCountry(value: string, picked: Country): Country {
  const dial = longestDialPrefix(value);
  if (!dial || picked.dial === dial) return picked;
  const candidates = COUNTRIES.filter((c) => c.dial === dial);
  return candidates.find((c) => c.code === 'US') ?? candidates[0] ?? picked;
}

export function PhoneInput({
  value,
  onChange,
  locale = 'en',
  ariaLabel,
  defaultCountry,
  autoFocus = true,
}: {
  /** Full number including the dial code ('+525512345678'), or ''. */
  value: string;
  onChange: (value: string) => void;
  /** 'en' | 'es' — anything getMessages accepts. */
  locale?: string;
  /** aria-label for the digits input (the step question). */
  ariaLabel?: string;
  /** Per-form default country (ISO alpha-2, e.g. "CO"); falls back to locale. */
  defaultCountry?: string | null;
  /**
   * Focus the number input on mount. Default `true` — the slides layout shows
   * one question per screen, so focusing it is always right. The vertical
   * layout renders every question at once and passes `false`: competing
   * autofocused inputs would fight, and the winner would scroll the page.
   */
  autoFocus?: boolean;
}) {
  const m = getMessages(locale).renderer.phonePicker;
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<Country>(() => initialCountry(defaultCountry, locale));

  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const country = useMemo(() => deriveCountry(value, picked), [value, picked]);
  const digits = useMemo(() => phoneSubscriberDigits(value), [value]);
  // Per-country issue lengths: the input stops at max, and an inline hint shows
  // under min. The stored value stays bare E.164 regardless of the display.
  const [minLen, maxLen] = phoneNsnRange(country.code, country.dial);
  const tooShort = digits.length > 0 && digits.length < minLen;

  // Localized names once per locale; the list sorts by them so respondents scan
  // alphabetically in their own language, not by ISO code.
  const names = useMemo(
    () => new Map(COUNTRIES.map((c) => [c.code, countryName(c.code, locale)])),
    [locale],
  );
  const sorted = useMemo(
    () =>
      [...COUNTRIES].sort((a, b) =>
        (names.get(a.code) ?? a.code).localeCompare(names.get(b.code) ?? b.code, locale),
      ),
    [names, locale],
  );
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sorted;
    const qDial = q.startsWith('+') ? q : `+${q}`;
    return sorted.filter(
      (c) =>
        (names.get(c.code) ?? c.code).toLowerCase().includes(q) ||
        c.code.toLowerCase() === q ||
        (/^\+?\d+$/.test(q) && c.dial.startsWith(qDial)),
    );
  }, [sorted, names, query]);

  // Close on outside click; focus the search box when the panel opens.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    searchRef.current?.focus();
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const focusOption = (i: number) => optionRefs.current[i]?.focus();

  const close = (returnFocus: boolean) => {
    setOpen(false);
    setQuery('');
    if (returnFocus) triggerRef.current?.focus();
  };

  const pick = (c: Country) => {
    setPicked(c);
    // Re-prefix the kept subscriber digits with the new dial code, re-capped to
    // what the new country issues.
    const kept = digits.slice(0, phoneNsnRange(c.code, c.dial)[1]);
    onChange(kept ? `${c.dial}${kept}` : '');
    close(true);
  };

  const onSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      focusOption(0);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close(true);
    }
  };

  const onOptionKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>, i: number) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      focusOption(Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (i === 0) searchRef.current?.focus();
      else focusOption(i - 1);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close(true);
    }
    // Enter/Space: the focused option is a native <button> — its onClick fires
    // on both keys, so no extra handling is needed to pick the focused option.
  };

  return (
    <div className="pf-phone" ref={rootRef}>
      <div className="pf-phone__row">
        <button
          ref={triggerRef}
          type="button"
          className="pf-phone__country"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={listId}
          aria-label={m.countryLabel}
          onClick={() => (open ? close(false) : setOpen(true))}
        >
          <span className="pf-phone__flag" aria-hidden="true">
            {country.flag}
          </span>
          <span className="pf-phone__dial">{country.dial}</span>
          <span className={`pf-phone__chevron${open ? ' pf-phone__chevron--open' : ''}`} aria-hidden="true">
            ▾
          </span>
        </button>
        <input
          className={`pf-input pf-phone__number${tooShort ? ' pf-phone__number--invalid' : ''}`}
          type="tel"
          inputMode="tel"
          autoComplete="tel-national"
          value={formatPhoneDigits(country.dial, digits)}
          onChange={(e) => {
            // Digits only, capped at what the selected country issues; the
            // grouped display is visual-only.
            const d = e.target.value.replace(/\D/g, '').slice(0, maxLen);
            onChange(d ? `${country.dial}${d}` : '');
          }}
          placeholder={formatPhoneDigits(country.dial, '0'.repeat(minLen))}
          aria-label={ariaLabel}
          aria-invalid={tooShort || undefined}
          autoFocus={autoFocus}
        />
      </div>

      {tooShort ? (
        <p className="pf-phone__hint" role="alert">
          {m.invalid}
        </p>
      ) : null}

      {open ? (
        <div className="pf-phone__panel">
          <input
            ref={searchRef}
            className="pf-phone__search"
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onSearchKeyDown}
            placeholder={m.search}
            aria-label={m.search}
            autoComplete="off"
          />
          <ul id={listId} className="pf-phone__list" role="listbox" aria-label={m.countryLabel}>
            {filtered.length === 0 ? (
              <li className="pf-dropdown__empty" role="option" aria-disabled aria-selected={false}>
                {m.noResults}
              </li>
            ) : (
              filtered.map((c, i) => {
                const selected = c.code === country.code;
                return (
                  <li key={c.code} role="option" aria-selected={selected}>
                    <button
                      ref={(el) => {
                        optionRefs.current[i] = el;
                      }}
                      type="button"
                      className={`pf-phone__option${selected ? ' pf-phone__option--selected' : ''}`}
                      onMouseDown={(e) => e.preventDefault()}
                      onKeyDown={(e) => onOptionKeyDown(e, i)}
                      onClick={() => pick(c)}
                    >
                      <span className="pf-phone__flag" aria-hidden="true">
                        {c.flag}
                      </span>
                      <span className="pf-phone__name">{names.get(c.code) ?? c.code}</span>
                      <span className="pf-phone__option-dial">{c.dial}</span>
                    </button>
                  </li>
                );
              })
            )}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
