"use client";

import { useEffect, useRef, useState } from "react";
import { TextField } from "./fields";

/**
 * A pasted or typed redirect, made storable: trimmed, empty becomes `null`
 * (= show the thank-you screen), and a schemeless entry ("example.com") is
 * upgraded to `https://` so it passes the schema's `.url()` check.
 */
export function normalizeRedirect(raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(v)) return v; // already carries a scheme
  return `https://${v}`;
}

/** Whether a normalized value would survive the config schema's `.url()`. */
function parsesAsUrl(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * What the field may hand to the config for the text on screen right now:
 * the normalized URL, `null` for an emptied field, or `undefined` when the
 * text is not (yet) something the schema would accept, in which case it
 * stays local until the next keystroke or blur makes it whole.
 */
export function committableRedirect(raw: string): string | null | undefined {
  const normalized = normalizeRedirect(raw);
  if (normalized === null || parsesAsUrl(normalized)) return normalized;
  return undefined;
}

/**
 * The redirect URL input shared by the Design tab (form-level ending) and the
 * per-outcome editor, so both behave identically.
 *
 * It commits on every change, like the headline and body next to it, but only
 * while the normalized text parses as a URL: a half-typed "exa mple" stays
 * local instead of sending the autosave a value the schema would refuse and
 * turning the status red mid-word. Blur and Enter commit too and tidy the
 * visible text up to the normalized form. Before this, the URL committed on
 * blur ONLY, so typing it and pressing Publish in one gesture published a
 * draft the server had not received yet (GF-26, point 2).
 */
export function RedirectField({
  value,
  placeholder,
  onCommit,
  id,
  className,
  testId,
}: {
  value: string | null;
  placeholder: string;
  onCommit: (url: string | null) => void;
  id?: string;
  className?: string;
  testId: string;
}) {
  const [text, setText] = useState(value ?? "");
  // The value this field last committed. A prop change that merely echoes our
  // own commit must not reset the text mid-typing (it would drop the caret to
  // the end and insert the `https://` prefix under the person's fingers); one
  // that comes from elsewhere (ranges re-sorted, recovery banner) must.
  const committed = useRef<string | null>(value ?? null);
  useEffect(() => {
    if ((value ?? null) === committed.current) return;
    committed.current = value ?? null;
    setText(value ?? "");
  }, [value]);

  function commit(normalized: string | null) {
    if (normalized === committed.current) return;
    committed.current = normalized;
    onCommit(normalized);
  }

  return (
    <TextField
      id={id}
      type="url"
      inputMode="url"
      value={text}
      placeholder={placeholder}
      data-testid={testId}
      className={className}
      onChange={(e) => {
        const next = e.target.value;
        setText(next);
        const committable = committableRedirect(next);
        if (committable !== undefined) commit(committable);
      }}
      onBlur={() => {
        setText(normalizeRedirect(text) ?? "");
        const committable = committableRedirect(text);
        if (committable !== undefined) commit(committable);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          e.currentTarget.blur();
        }
      }}
    />
  );
}
