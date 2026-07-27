'use client';

import { useState } from 'react';
import { Modal } from '@/components/modal';
import { Button } from '@/components/ui/button';

/**
 * Compact copy-link + embed + open-in-new-tab controls for the editor header.
 * The public URL is resolved client-side from the real origin (the `publicPath`
 * prop is a server-stable path). A 2s "Copied" flash confirms each copy.
 */
export function LinkActions({
  publicPath,
  formName,
  labels,
}: {
  publicPath: string;
  /** The form's name — becomes the embed iframe's accessible title. */
  formName: string;
  labels: {
    copyLink: string;
    copied: string;
    openForm: string;
    embed: string;
    embedTitle: string;
    embedIntro: string;
    embedCopy: string;
    embedCopied: string;
  };
}) {
  const [copied, setCopied] = useState(false);
  const [embedOpen, setEmbedOpen] = useState(false);
  const [snippetCopied, setSnippetCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${publicPath}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked — no-op */
    }
  };

  /**
   * The paste-into-your-site snippet: the form at `?embed=1` (content-height
   * mode) inside a `data-dapta-forms` iframe, plus `embed.js`, which listens
   * for the page's height reports and sizes the iframe to match. Built lazily
   * so it always carries the CURRENT origin (localhost in dev, the real host
   * in production).
   */
  const buildSnippet = () =>
    [
      `<iframe data-dapta-forms src="${window.location.origin}${publicPath}?embed=1"`,
      `        title="${formName.replace(/"/g, '&quot;')}" loading="lazy"`,
      `        style="width:100%;border:0;min-height:480px;"></iframe>`,
      `<script src="${window.location.origin}/embed.js" async></script>`,
    ].join('\n');

  const copySnippet = async () => {
    try {
      await navigator.clipboard.writeText(buildSnippet());
      setSnippetCopied(true);
      setTimeout(() => setSnippetCopied(false), 2000);
    } catch {
      /* clipboard blocked — the snippet stays selectable in the code block */
    }
  };

  // `shrink-0` + `whitespace-nowrap`: these live in a flex topbar that gets tight
  // between the `lg` label breakpoint and a roomy viewport. Without both, the
  // label wraps to a second line inside a fixed `h-9` box and the button breaks.
  const btn =
    'inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-border px-3 text-sm font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

  return (
    <div className="flex shrink-0 items-center gap-2">
      <button
        type="button"
        onClick={copy}
        className={btn}
        aria-label={labels.copyLink}
        title={labels.copyLink}
        data-testid="editor-copy-link"
      >
        <i aria-hidden className={`pi ${copied ? 'pi-check' : 'pi-link'}`} style={{ fontSize: 13 }} />
        <span className="hidden xl:inline">{copied ? labels.copied : labels.copyLink}</span>
      </button>
      <button
        type="button"
        onClick={() => setEmbedOpen(true)}
        className={btn}
        aria-label={labels.embed}
        title={labels.embed}
        data-testid="editor-embed"
      >
        <i aria-hidden className="pi pi-code" style={{ fontSize: 13 }} />
        {/* xl like its siblings — the topbar's staggered breakpoints (PR #31)
            keep it from overflowing between lg and xl. */}
        <span className="hidden xl:inline">{labels.embed}</span>
      </button>
      <a
        href={publicPath}
        target="_blank"
        rel="noreferrer"
        className={btn}
        aria-label={labels.openForm}
        title={labels.openForm}
        data-testid="editor-open-form"
      >
        <i aria-hidden className="pi pi-external-link" style={{ fontSize: 13 }} />
        <span className="hidden xl:inline">{labels.openForm}</span>
      </a>

      <Modal open={embedOpen} onClose={() => setEmbedOpen(false)} title={labels.embedTitle} labelId="embed-form-title">
        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">{labels.embedIntro}</p>
          <pre
            data-testid="embed-snippet"
            className="overflow-x-auto rounded-md border border-border bg-muted/40 p-3 font-mono text-xs leading-relaxed text-foreground"
          >
            {embedOpen ? buildSnippet() : ''}
          </pre>
          <div className="flex justify-end">
            <Button onClick={() => void copySnippet()} data-testid="embed-copy">
              <i aria-hidden className={`pi ${snippetCopied ? 'pi-check' : 'pi-copy'}`} style={{ fontSize: 12 }} />{' '}
              {snippetCopied ? labels.embedCopied : labels.embedCopy}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
