'use client';

/**
 * The `file` step's control: pick a file, watch it upload, keep going.
 *
 * The upload happens the moment a file is chosen, not on Continue. A visitor
 * who picks a 9 MB PDF and immediately presses the button would otherwise sit
 * on a frozen screen with nothing to look at, and the answer this step commits
 * is a reference to an object that has to already exist.
 *
 * Three moving parts, in order: ask the server action for a signed URL, PUT the
 * bytes straight to the bucket, then hand the step an answer describing what
 * landed. Only the last one is state the form cares about, so a failure at
 * either of the first two leaves the answer untouched and the step invalid,
 * which is exactly what the engine's required check already knows how to say.
 *
 * XMLHttpRequest rather than fetch, deliberately: `fetch` still cannot report
 * upload progress, and a progress bar is the entire difference between this
 * feeling broken and feeling normal on a slow connection.
 */
import { useCallback, useRef, useState } from 'react';
import type { AnswerValue, FormStep } from '@quill/engine';
import { getMessages } from '@quill/shared';

type Phase =
  | { kind: 'idle' }
  | { kind: 'uploading'; percent: number; name: string }
  | { kind: 'failed'; message: string };

export interface UploadTicket {
  url: string;
  key: string;
  contentType: string;
}

export type RequestTicket = (file: {
  name: string;
  size: number;
  mime: string;
}) => Promise<{ ok: true; ticket: UploadTicket } | { ok: false; message: string }>;

/** PUT the bytes, reporting progress. Resolves false when the bucket refuses. */
function put(url: string, contentType: string, file: File, onProgress: (pct: number) => void): Promise<boolean> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url, true);
    // Must match the signature byte for byte, or S3 rejects it before storing.
    xhr.setRequestHeader('Content-Type', contentType);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => resolve(xhr.status >= 200 && xhr.status < 300);
    xhr.onerror = () => resolve(false);
    xhr.onabort = () => resolve(false);
    xhr.send(file);
  });
}

export function FileUploadInput({
  step,
  value,
  onChange,
  requestTicket,
  locale,
  maxSizeMb,
}: {
  step: FormStep;
  value: AnswerValue;
  onChange: (value: AnswerValue) => void;
  requestTicket: RequestTicket;
  locale?: string;
  /** The deployment's ceiling, so the visitor is told before a pointless upload. */
  maxSizeMb: number;
}) {
  const m = getMessages(locale ?? 'en').renderer.upload;
  const inputRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });

  const allowed = step.allowedTypes ?? [];
  const limitMb = Math.min(step.maxSizeMb && step.maxSizeMb > 0 ? step.maxSizeMb : maxSizeMb, maxSizeMb);
  const accept = allowed.map((e) => `.${e}`).join(',');

  // The committed answer, if there is one. Its shape is the engine's, and the
  // only field worth showing is the name the visitor's own file had.
  const uploaded =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, string>)
      : null;

  const onPick = useCallback(
    async (file: File | undefined) => {
      if (!file) return;

      // Checked here so an obviously doomed upload never starts. The server
      // checks both again on its own; this is courtesy, not enforcement.
      if (file.size > limitMb * 1_000_000) {
        setPhase({ kind: 'failed', message: m.tooLarge.replaceAll('{max}', String(limitMb)) });
        return;
      }
      const ext = /\.([A-Za-z0-9]{1,12})$/.exec(file.name)?.[1]?.toLowerCase() ?? '';
      if (allowed.length > 0 && !allowed.includes(ext)) {
        setPhase({ kind: 'failed', message: m.wrongType });
        return;
      }

      setPhase({ kind: 'uploading', percent: 0, name: file.name });
      const ticket = await requestTicket({
        name: file.name,
        size: file.size,
        mime: file.type || 'application/octet-stream',
      });
      if (!ticket.ok) {
        setPhase({ kind: 'failed', message: ticket.message });
        return;
      }

      const ok = await put(ticket.ticket.url, ticket.ticket.contentType, file, (percent) =>
        setPhase({ kind: 'uploading', percent, name: file.name }),
      );
      if (!ok) {
        setPhase({ kind: 'failed', message: m.failed });
        return;
      }

      setPhase({ kind: 'idle' });
      onChange({
        key: ticket.ticket.key,
        name: file.name,
        size: String(file.size),
        mime: ticket.ticket.contentType,
      });
    },
    [allowed, limitMb, m, onChange, requestTicket],
  );

  const reset = useCallback(() => {
    setPhase({ kind: 'idle' });
    onChange(null);
    if (inputRef.current) inputRef.current.value = '';
  }, [onChange]);

  return (
    <div className="pf-upload">
      <input
        ref={inputRef}
        type="file"
        className="sr-only"
        accept={accept || undefined}
        aria-label={step.question ?? step.key}
        onChange={(e) => void onPick(e.target.files?.[0])}
      />

      {uploaded ? (
        <div className="pf-upload-file" data-testid="upload-done">
          <i aria-hidden className="pi pi-paperclip" />
          <span className="pf-upload-name">{uploaded.name}</span>
          <button type="button" className="pf-upload-remove" onClick={reset}>
            {m.remove}
          </button>
        </div>
      ) : phase.kind === 'uploading' ? (
        <div
          className="pf-upload-progress"
          role="progressbar"
          aria-valuenow={phase.percent}
          aria-valuemin={0}
          aria-valuemax={100}
          data-testid="upload-progress"
        >
          <span className="pf-upload-name">{phase.name}</span>
          <span className="pf-upload-bar">
            <span className="pf-upload-bar-fill" style={{ width: `${phase.percent}%` }} />
          </span>
          <span className="pf-upload-percent">
            {m.uploading.replaceAll('{percent}', String(phase.percent))}
          </span>
        </div>
      ) : (
        <button
          type="button"
          className="pf-upload-drop"
          onClick={() => inputRef.current?.click()}
          data-testid="upload-choose"
        >
          <i aria-hidden className="pi pi-paperclip" />
          <span className="pf-upload-cta">{step.placeholder || m.choose}</span>
          <span className="pf-upload-accepts">
            {m.accepts
              .replaceAll('{types}', allowed.map((e) => e.toUpperCase()).join(', '))
              .replaceAll('{max}', String(limitMb))}
          </span>
        </button>
      )}

      {phase.kind === 'failed' ? (
        <p role="alert" className="pf-upload-error" data-testid="upload-error">
          {phase.message}{' '}
          <button type="button" className="pf-upload-retry" onClick={() => inputRef.current?.click()}>
            {m.retry}
          </button>
        </p>
      ) : null}
    </div>
  );
}
