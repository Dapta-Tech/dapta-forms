'use client';

import { useRef, useState } from 'react';
import { Modal } from '@/components/modal';
import { Button } from '@/components/ui/button';
import { AnchoredMenu } from '@/components/ui/anchored-menu';
import { cn } from '@/lib/cn';

/**
 * The topbar's share control: one icon button opening a menu with Copy link,
 * Embed and Open form.
 *
 * These were three labelled buttons sitting in the header next to Preview and
 * Publish, which is what pushed the tab labels behind a `2xl` breakpoint. They
 * are also the same KIND of thing — "get this form to somebody" — so collapsing
 * them into one affordance costs a click on actions nobody performs mid-edit and
 * buys the header enough room to label its tabs at every width.
 *
 * The panel goes through `AnchoredMenu`, i.e. a portal to `document.body`. A
 * plain absolute (or even `position: fixed`) panel would be trapped: the header
 * is a flex row inside the editor shell, and any positioned element in the
 * scrolling body below it paints over a panel whose z-index is scoped to the
 * header's own stacking context. That is the bug PR #61 fixed for the rail
 * menus, and it applies verbatim here.
 *
 * The public URL is resolved client-side from the real origin (`publicPath` is
 * a server-stable path). A 2s "Copied" flash confirms each copy.
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
    share: string;
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
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [embedOpen, setEmbedOpen] = useState(false);
  const [snippetCopied, setSnippetCopied] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

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

  const item =
    'flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-popover-foreground ' +
    'transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none';

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={labels.share}
        title={labels.share}
        data-testid="editor-share"
        className={cn(
          'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border text-foreground',
          'transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          open && 'bg-accent',
        )}
      >
        <i aria-hidden className="pi pi-share-alt" style={{ fontSize: 13 }} />
      </button>

      <AnchoredMenu
        anchorRef={triggerRef}
        open={open}
        onClose={() => setOpen(false)}
        label={labels.share}
        width={220}
        testId="editor-share-menu"
        className="py-1"
      >
        <button
          type="button"
          role="menuitem"
          onClick={() => void copy()}
          className={item}
          data-testid="editor-copy-link"
        >
          <i
            aria-hidden
            className={`pi ${copied ? 'pi-check' : 'pi-link'} shrink-0 text-muted-foreground`}
            style={{ fontSize: 13 }}
          />
          {copied ? labels.copied : labels.copyLink}
        </button>
        <button
          type="button"
          role="menuitem"
          onClick={() => {
            setOpen(false);
            setEmbedOpen(true);
          }}
          className={item}
          data-testid="editor-embed"
        >
          <i aria-hidden className="pi pi-code shrink-0 text-muted-foreground" style={{ fontSize: 13 }} />
          {labels.embed}
        </button>
        <a
          href={publicPath}
          target="_blank"
          rel="noreferrer"
          role="menuitem"
          onClick={() => setOpen(false)}
          className={item}
          data-testid="editor-open-form"
        >
          <i
            aria-hidden
            className="pi pi-external-link shrink-0 text-muted-foreground"
            style={{ fontSize: 13 }}
          />
          {labels.openForm}
        </a>
      </AnchoredMenu>

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
    </>
  );
}
