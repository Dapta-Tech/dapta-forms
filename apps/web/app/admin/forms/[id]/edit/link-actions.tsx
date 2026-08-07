'use client';

import { useState } from 'react';
import { Modal } from '@/components/modal';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';

/**
 * The topbar's sharing controls: Copy link, Embed and Open form as THREE
 * visible icon-only buttons.
 *
 * They were labelled buttons once (which crowded the tab labels out of the
 * header), then briefly a single popover menu — which tested as one hop too
 * many: "reduce them to icons" meant icons you can SEE, not a menu you must
 * discover. Icon-only is the compromise that keeps the header narrow AND the
 * actions one click away; the label reaches hover (title) and assistive tech
 * (aria-label).
 *
 * The public URL is resolved client-side from the real origin (`publicPath` is
 * a server-stable path). A 2s check-flash confirms each copy.
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

  const icon =
    'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border text-foreground ' +
    'transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

  return (
    <div className="flex shrink-0 items-center gap-1.5">
      <button
        type="button"
        onClick={() => void copy()}
        className={cn(icon, copied && 'border-primary text-primary')}
        aria-label={copied ? labels.copied : labels.copyLink}
        title={copied ? labels.copied : labels.copyLink}
        data-testid="editor-copy-link"
      >
        <i aria-hidden className={`pi ${copied ? 'pi-check' : 'pi-link'}`} style={{ fontSize: 13 }} />
      </button>
      <button
        type="button"
        onClick={() => setEmbedOpen(true)}
        className={icon}
        aria-label={labels.embed}
        title={labels.embed}
        data-testid="editor-embed"
      >
        <i aria-hidden className="pi pi-code" style={{ fontSize: 13 }} />
      </button>
      <a
        href={publicPath}
        target="_blank"
        rel="noreferrer"
        className={icon}
        aria-label={labels.openForm}
        title={labels.openForm}
        data-testid="editor-open-form"
      >
        <i aria-hidden className="pi pi-external-link" style={{ fontSize: 13 }} />
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
