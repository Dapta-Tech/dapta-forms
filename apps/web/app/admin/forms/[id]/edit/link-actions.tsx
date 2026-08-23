'use client';

import { useEffect, useState, useTransition } from 'react';
import { validateFormSlug, FORM_SLUG_MAX_LENGTH } from '@quill/engine';
import { Modal } from '@/components/modal';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { callAction, isTransportError } from '@/lib/call-action';
import { renameFormSlugAction } from '@/app/admin/actions';

/**
 * The topbar's sharing controls: Copy link, Edit link, Embed and Open form as
 * FOUR visible icon-only buttons.
 *
 * They were labelled buttons once (which crowded the tab labels out of the
 * header), then briefly a single popover menu — which tested as one hop too
 * many: "reduce them to icons" meant icons you can SEE, not a menu you must
 * discover. Icon-only is the compromise that keeps the header narrow AND the
 * actions one click away; the label reaches hover (title) and assistive tech
 * (aria-label).
 *
 * Edit link sits HERE, next to Copy link, rather than in a settings panel. This
 * is the one place in the product that already shows the public URL, so it is
 * where somebody goes when they want to change it.
 *
 * The public URL is resolved client-side from the real origin (`publicPath` is
 * a server-stable path). A 2s check-flash confirms each copy.
 */
export function LinkActions({
  publicPath,
  formId,
  formName,
  onRenamed,
  labels,
}: {
  publicPath: string;
  /** Target of the rename. The slug itself is read off `publicPath`. */
  formId: string;
  /** The form's name — becomes the embed iframe's accessible title. */
  formName: string;
  /**
   * Hand the new path back to the editor. Everything built from `publicPath`
   * (this component's own Copy/Embed/Open, the design panel, the prefill example)
   * reads a prop threaded down from a server component, so without this the
   * topbar would keep copying the OLD link until a reload, and the person who
   * just renamed it is the likeliest person to copy it seconds later.
   */
  onRenamed: (publicPath: string) => void;
  labels: {
    copyLink: string;
    copied: string;
    openForm: string;
    embed: string;
    embedTitle: string;
    embedIntro: string;
    embedCopy: string;
    embedCopied: string;
    renameLink: string;
    renameTitle: string;
    renameIntro: string;
    renameLabel: string;
    renameSave: string;
    renameSaving: string;
    renameCancel: string;
    renameTaken: string;
    renameInvalid: string;
    renameTooLong: string;
    renameFailed: string;
  };
}) {
  const [copied, setCopied] = useState(false);
  const [embedOpen, setEmbedOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [snippetCopied, setSnippetCopied] = useState(false);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // `/{accountCode}/{handle}/{slug}` split at the last separator: the prefix is
  // fixed (it belongs to the workspace and the member, not to this form) and
  // only the tail is editable.
  const cut = publicPath.lastIndexOf('/');
  const prefix = publicPath.slice(0, cut + 1);
  const slug = publicPath.slice(cut + 1);

  /**
   * The real origin, for display only. Read after mount rather than during
   * render because the server has no `window`, and shown as a prefix so what
   * the dialog puts on screen is the whole link, not a fragment of one.
   */
  const [origin, setOrigin] = useState('');
  useEffect(() => setOrigin(window.location.origin.replace(/^https?:\/\//, '')), []);

  const openRename = () => {
    setDraft(slug);
    setError(null);
    setRenameOpen(true);
  };

  const trimmed = draft.trim().toLowerCase();
  const shapeIssue = trimmed.length === 0 ? 'invalid' : validateFormSlug(trimmed);
  const canSave = !pending && shapeIssue === null && trimmed !== slug;

  const submitRename = () => {
    if (!canSave) return;
    setError(null);
    startTransition(async () => {
      // Through `callAction`, never a bare await: a deploy rotating action ids
      // mid-session rejects the call, and an unguarded await would skip every
      // line below it, leaving the dialog stuck on "Saving" with no error.
      const res = await callAction(() => renameFormSlugAction(formId, trimmed));
      if (isTransportError(res)) {
        setError(labels.renameFailed);
        return;
      }
      if (res.ok) {
        onRenamed(res.publicPath);
        setRenameOpen(false);
        return;
      }
      setError(
        res.code === 'SLUG_TAKEN'
          ? labels.renameTaken
          : res.code === 'SLUG_INVALID'
            ? labels.renameInvalid
            : labels.renameFailed,
      );
    });
  };

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
        className={cn(icon, copied && 'border-primary-edge text-primary')}
        aria-label={copied ? labels.copied : labels.copyLink}
        title={copied ? labels.copied : labels.copyLink}
        data-testid="editor-copy-link"
      >
        <i aria-hidden className={`pi ${copied ? 'pi-check' : 'pi-link'}`} style={{ fontSize: 13 }} />
      </button>
      <button
        type="button"
        onClick={openRename}
        className={icon}
        aria-label={labels.renameLink}
        title={labels.renameLink}
        data-testid="editor-rename-link"
      >
        <i aria-hidden className="pi pi-pencil" style={{ fontSize: 13 }} />
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

      <Modal
        open={renameOpen}
        // Escape and a backdrop click are dismissals too, and Cancel is already
        // disabled while saving. Without the same guard here, dismissing mid
        // request lets the rename land server-side while `onRenamed` never
        // fires, so Copy link, Embed, Open form and the prefill example keep
        // the previous path for the rest of the session. That is precisely the
        // bug `publicPath`-as-state exists to prevent, reintroduced through the
        // one exit the button does not cover.
        onClose={() => {
          if (!pending) setRenameOpen(false);
        }}
        title={labels.renameTitle}
        labelId="rename-form-link-title"
      >
        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">{labels.renameIntro}</p>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="form-slug-input" className="text-sm font-medium">
              {labels.renameLabel}
            </label>
            {/* The fixed part of the URL is shown, not editable: it names the
                workspace and the member, so letting someone type over it here
                would offer an edit this dialog cannot make. */}
            <div className="flex items-center rounded-md border border-input bg-background focus-within:ring-2 focus-within:ring-ring">
              <span className="shrink-0 truncate py-2 pl-3 font-mono text-xs text-muted-foreground">
                {origin}
                {prefix}
              </span>
              <input
                id="form-slug-input"
                value={draft}
                onChange={(e) => {
                  setDraft(e.target.value);
                  setError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    submitRename();
                  }
                }}
                maxLength={FORM_SLUG_MAX_LENGTH}
                spellCheck={false}
                autoComplete="off"
                aria-describedby={error || shapeIssue ? 'form-slug-error' : undefined}
                aria-invalid={error != null || (draft.length > 0 && shapeIssue !== null)}
                className="min-w-0 flex-1 bg-transparent py-2 pr-3 font-mono text-sm focus-visible:outline-none"
                data-testid="form-slug-input"
              />
            </div>
            {/* One message at a time, and the server's wins: it knows about
                collisions the browser cannot see. The shape hint only appears
                once there is something to be wrong about. */}
            {error || (draft.length > 0 && shapeIssue !== null) ? (
              <p id="form-slug-error" role="alert" className="text-xs text-destructive" data-testid="form-slug-error">
                {error ?? (shapeIssue === 'too-long' ? labels.renameTooLong : labels.renameInvalid)}
              </p>
            ) : null}
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setRenameOpen(false)} disabled={pending}>
              {labels.renameCancel}
            </Button>
            <Button onClick={submitRename} disabled={!canSave} data-testid="form-slug-save">
              {pending ? labels.renameSaving : labels.renameSave}
            </Button>
          </div>
        </div>
      </Modal>

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
