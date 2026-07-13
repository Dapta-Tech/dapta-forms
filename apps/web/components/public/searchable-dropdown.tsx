'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { FormOption } from '@quill/engine';

/**
 * A searchable single-select for `dropdown` steps — filters options as you type,
 * good for long lists (country, industry…). Combobox aria, click-outside to
 * close, and selecting an option advances the form (auto-next).
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

  return (
    <div className="pf-dropdown" ref={wrapperRef}>
      <input
        type="text"
        className="pf-input"
        value={query}
        placeholder={placeholder}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
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
            filtered.map((option) => (
              <li key={option.value} role="option" aria-selected={value === option.value}>
                <button
                  type="button"
                  className={`pf-dropdown__option${value === option.value ? ' pf-dropdown__option--selected' : ''}`}
                  onMouseDown={(e) => e.preventDefault()}
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
