'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { FormOption } from '@quill/engine';

/**
 * A searchable single-select for `dropdown` steps — filters options as you type,
 * good for long lists (country, industry…). Combobox aria, click-outside to
 * close, and selecting an option advances the form (auto-next).
 *
 * Keyboard: ArrowDown/ArrowUp move focus through the listbox options (real DOM
 * focus, so Enter/Space activate the focused option's native button), Escape
 * closes and returns focus to the input.
 */
export function SearchableDropdown({
  options,
  value,
  onSelect,
  placeholder,
  emptyLabel,
}: {
  options: FormOption[];
  value: string;
  onSelect: (value: string) => void;
  placeholder: string;
  emptyLabel: string;
}) {
  const listId = useId();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);

  const selected = useMemo(() => options.find((o) => o.value === value), [options, value]);

  useEffect(() => {
    setQuery(selected?.label ?? '');
    setOpen(false);
  }, [selected?.label, value]);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery(selected?.label ?? '');
      }
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [selected?.label]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [query, options]);

  const focusOption = (i: number) => {
    const el = optionRefs.current[i];
    if (el) el.focus();
  };

  const closeAndReset = () => {
    setOpen(false);
    setQuery(selected?.label ?? '');
  };

  const onInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      // Focus the first option once the list has rendered.
      requestAnimationFrame(() => focusOption(0));
    } else if (e.key === 'Escape') {
      if (open) {
        e.preventDefault();
        closeAndReset();
      }
    }
  };

  const onOptionKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>, i: number) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      focusOption(Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (i === 0) inputRef.current?.focus();
      else focusOption(i - 1);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeAndReset();
      inputRef.current?.focus();
    }
    // Enter/Space: the focused option is a native <button>, which fires its
    // onClick on both keys — no extra handling needed to "select the focused option".
  };

  return (
    <div className="pf-dropdown" ref={wrapperRef}>
      <input
        ref={inputRef}
        type="text"
        className="pf-input"
        value={query}
        placeholder={placeholder}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onInputKeyDown}
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
      />
      {open && (
        <ul id={listId} className="pf-dropdown__list" role="listbox">
          {filtered.length === 0 ? (
            <li className="pf-dropdown__empty" role="option" aria-disabled aria-selected={false}>
              {emptyLabel}
            </li>
          ) : (
            filtered.map((option, i) => (
              <li key={option.value} role="option" aria-selected={value === option.value}>
                <button
                  ref={(el) => {
                    optionRefs.current[i] = el;
                  }}
                  type="button"
                  className={`pf-dropdown__option${value === option.value ? ' pf-dropdown__option--selected' : ''}`}
                  onMouseDown={(e) => e.preventDefault()}
                  onKeyDown={(e) => onOptionKeyDown(e, i)}
                  onClick={() => {
                    setQuery(option.label);
                    setOpen(false);
                    onSelect(option.value);
                  }}
                >
                  {option.label}
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
