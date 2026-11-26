'use client';

import { useEffect, useId, useState, useTransition, type FormEvent } from 'react';
import { formAiStatusAction, generateFormDraftAction } from '@/app/admin/actions';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import type { GeneratedFormDraft } from '@/lib/admin-api';
import { callAction } from '@/lib/call-action';
import type { BuilderMessages } from './builder-messages';

export function AiFormStarter({
  onApply,
  m,
}: {
  onApply: (draft: GeneratedFormDraft) => void;
  m: BuilderMessages['empty']['ai'];
}) {
  const promptId = useId();
  const [available, setAvailable] = useState(false);
  const [useLeadQualification, setUseLeadQualification] = useState(false);
  const [description, setDescription] = useState('');
  const [draft, setDraft] = useState<GeneratedFormDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [generating, startGeneration] = useTransition();

  useEffect(() => {
    let active = true;
    void callAction(formAiStatusAction).then((result) => {
      if (active && 'available' in result) setAvailable(result.available === true);
    });
    return () => {
      active = false;
    };
  }, []);

  function generate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!description.trim() || generating) return;
    setError(null);
    setDraft(null);
    startGeneration(async () => {
      const skill = useLeadQualification ? 'qualify-leads' : undefined;
      const result = await callAction(() => generateFormDraftAction(description, skill), { timeoutMs: 48_000 });
      if (result.ok) setDraft(result.draft);
      else if ('skillUnavailable' in result && result.skillUnavailable) setError(m.skillUnavailable);
      else setError('unavailable' in result && result.unavailable ? m.unavailable : m.error);
    });
  }

  if (!available) return null;

  return (
    <details className="group mt-3 w-full max-w-xl rounded-xl border border-border bg-card text-left">
      <summary className="flex cursor-pointer list-none items-center gap-4 rounded-xl p-5 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-muted text-foreground">
          <i aria-hidden className="pi pi-sparkles text-lg" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-semibold">{m.title}</span>
          <span className="mt-0.5 block text-sm text-muted-foreground">{m.description}</span>
        </span>
        <i aria-hidden className="pi pi-chevron-down shrink-0 text-xs text-muted-foreground transition-transform group-open:rotate-180" />
      </summary>
      <div className="border-t border-border p-5">
        <form onSubmit={generate} aria-busy={generating} className="space-y-3">
          <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm font-medium">
            <Checkbox
              checked={useLeadQualification}
              disabled={generating}
              onChange={(event) => {
                setUseLeadQualification(event.target.checked);
                setDraft(null);
                setError(null);
              }}
            />
            {m.leadQualification}
          </label>
          <label htmlFor={promptId} className="block text-sm font-semibold">
            {useLeadQualification ? m.productSummary : m.prompt}
          </label>
          <textarea
            id={promptId}
            value={description}
            onChange={(event) => {
              setDescription(event.target.value);
              setDraft(null);
              setError(null);
            }}
            placeholder={useLeadQualification ? m.productSummaryPlaceholder : m.placeholder}
            rows={4}
            maxLength={4000}
            required
            disabled={generating}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <Button type="submit" disabled={generating || !description.trim()}>
            {generating ? m.generating : m.generate}
          </Button>
        </form>
        {error ? <p role="alert" className="mt-3 text-sm text-destructive">{error}</p> : null}
        {draft ? (
          <div className="mt-5 space-y-3 border-t border-border pt-4">
            <h2 className="text-sm font-semibold">{m.preview}</h2>
            <ol className="max-h-60 list-decimal space-y-1 overflow-y-auto break-words pl-5 text-sm">
              {draft.steps.map((step) => (
                <li key={step.key}>{step.question || step.helper || step.type}</li>
              ))}
            </ol>
            <Button onClick={() => onApply(draft)}>{m.apply}</Button>
          </div>
        ) : null}
      </div>
    </details>
  );
}
