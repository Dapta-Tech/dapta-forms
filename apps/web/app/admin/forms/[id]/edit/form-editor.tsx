'use client';

import { useState, useTransition } from 'react';
import { saveFormAction } from '@/app/admin/actions';

/**
 * Placeholder editor (Phase 1 replaces this with a real step builder). It edits
 * the form name and the raw config JSON and saves via a server action — enough to
 * make the whole loop (edit → save → public render) work end to end.
 */
export function FormEditor({
  id,
  initialName,
  initialConfig,
}: {
  id: string;
  initialName: string;
  initialConfig: string;
}) {
  const [name, setName] = useState(initialName);
  const [config, setConfig] = useState(initialConfig);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function save() {
    setMessage(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(config);
    } catch {
      setMessage('Config is not valid JSON.');
      return;
    }
    start(async () => {
      const res = await saveFormAction(id, { name, config: parsed });
      setMessage(res.ok ? 'Saved.' : (res.message ?? 'Failed to save.'));
    });
  }

  return (
    <div className="mt-4 flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <label htmlFor="form-name" className="text-sm font-medium">
          Form name
        </label>
        <input
          id="form-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="rounded-md border border-border bg-background px-3 py-2"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="form-config" className="text-sm font-medium">
          Config (JSON)
        </label>
        <textarea
          id="form-config"
          value={config}
          onChange={(e) => setConfig(e.target.value)}
          spellCheck={false}
          rows={22}
          className="rounded-md border border-border bg-background px-3 py-2 font-mono text-xs"
        />
        <p className="text-xs text-muted-foreground">
          Placeholder editor — Phase 1 replaces this with a visual step builder.
        </p>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={pending}
          className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground active:scale-[0.98] disabled:opacity-50"
        >
          {pending ? 'Saving…' : 'Save'}
        </button>
        {message ? <span className="text-sm text-muted-foreground">{message}</span> : null}
      </div>
    </div>
  );
}
