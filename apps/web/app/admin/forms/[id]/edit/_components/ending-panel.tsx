'use client';

import { useEffect, useState } from 'react';
import type { FormConfig, FormEnding } from '@quill/engine';
import { Field, TextField, TextArea, NumberField, PanelSection } from './fields';
import { HelpTip } from '@/components/ui/help-tip';
import type { EditorMessages } from './messages';

/** Above this, "hold the screen then redirect" stops reading as a transition. */
const MAX_DELAY_MS = 60_000;

/**
 * Design-tab panel for what happens when the form ends (`config.ending` — V5-B1).
 *
 * This screen previously did not exist: the generic thank-you was hardcoded
 * i18n copy with no editor, and a redirect could only be attached to a score
 * range — so a form with scoring off could not redirect at all, and sending
 * everyone to one URL meant repeating it on every range.
 *
 * Everything here is a DEFAULT. A score range that fills the same field in
 * Results overrides it for that range; a range that leaves it empty inherits
 * what is set here. The hint under each field says so, because inheritance you
 * cannot see reads as "my edit did nothing".
 */
export function EndingPanel({
  config,
  onEndingChange,
  hasOutcomes,
  m,
}: {
  config: FormConfig;
  onEndingChange: (patch: Partial<FormEnding>) => void;
  /** Whether any score range exists — drives the "ranges can override" note. */
  hasOutcomes: boolean;
  m: EditorMessages;
}) {
  const ending = config.ending ?? {};
  const em = m.ending;

  return (
    <div className="flex flex-col gap-4">
      <PanelSection title={em.title} subtitle={em.subtitle}>
        <Field
          label={em.headline}
          hint={em.headlineHint}
          labelAdornment={<HelpTip text={em.headlineHelp} label={em.headline} side="bottom" />}
        >
          <TextField
            value={ending.headline ?? ''}
            placeholder={em.headlinePlaceholder}
            data-testid="ending-headline"
            onChange={(e) => onEndingChange({ headline: e.target.value || null })}
          />
        </Field>

        <Field label={em.body} hint={em.bodyHint}>
          <TextArea
            value={ending.body ?? ''}
            rows={3}
            placeholder={em.bodyPlaceholder}
            data-testid="ending-body"
            onChange={(e) => onEndingChange({ body: e.target.value || null })}
          />
        </Field>

        <Field label={em.redirect} hint={em.redirectHint}>
          <RedirectField
            value={ending.redirectUrl ?? null}
            placeholder={em.redirectPlaceholder}
            onCommit={(url) => onEndingChange({ redirectUrl: url })}
          />
        </Field>

        {/* The delay only does anything alongside a URL, so it appears only then
            — a "wait 3s before going nowhere" control is pure confusion. */}
        {ending.redirectUrl ? (
          <Field
            label={em.delay}
            hint={em.delayHint}
            labelAdornment={<HelpTip text={em.delayHelp} label={em.delay} side="bottom" />}
          >
            <NumberField
              value={ending.redirectDelayMs ?? 0}
              min={0}
              max={MAX_DELAY_MS}
              step={100}
              data-testid="ending-delay"
              onChange={(e) => {
                const n = Number(e.target.value);
                onEndingChange({
                  redirectDelayMs: Number.isFinite(n) ? Math.min(MAX_DELAY_MS, Math.max(0, n)) : 0,
                });
              }}
            />
          </Field>
        ) : null}

        {hasOutcomes ? (
          <p
            data-testid="ending-outcomes-note"
            className="flex items-start gap-1.5 rounded-md border border-secondary/40 bg-secondary/10 px-2.5 py-2 text-xs leading-relaxed text-foreground"
          >
            <i aria-hidden className="pi pi-info-circle mt-0.5 shrink-0 text-secondary" style={{ fontSize: 11 }} />
            {em.outcomesNote}
          </p>
        ) : null}
      </PanelSection>
    </div>
  );
}

/**
 * A redirect URL with local text state, normalized to `https://` on blur so a
 * schemeless entry ("example.com") does not fail the schema's `.url()` check and
 * block the autosave. Empty commits `null` (= show the thank-you screen).
 * Mirrors the per-outcome field in Results so both behave identically.
 */
function RedirectField({
  value,
  placeholder,
  onCommit,
}: {
  value: string | null;
  placeholder: string;
  onCommit: (url: string | null) => void;
}) {
  const [text, setText] = useState(value ?? '');
  useEffect(() => setText(value ?? ''), [value]);

  function commit() {
    const raw = text.trim();
    if (!raw) {
      setText('');
      onCommit(null);
      return;
    }
    const normalized = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    setText(normalized);
    onCommit(normalized);
  }

  return (
    <TextField
      type="url"
      inputMode="url"
      value={text}
      placeholder={placeholder}
      data-testid="ending-redirect"
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          e.currentTarget.blur();
        }
      }}
    />
  );
}
