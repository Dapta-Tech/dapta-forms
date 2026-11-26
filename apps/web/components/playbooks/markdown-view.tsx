import type { ReactNode } from 'react';
import { headingId } from '@/lib/playbooks';
import { inlineText, parseInline, type Block, type Inline } from '@/lib/markdown';
import { PlaybookMediaView } from './playbook-media';

/**
 * Draws parsed markdown (`lib/markdown.ts`) as React elements in the reader's
 * type: Hanken Grotesk throughout, the code blocks included (the design system
 * has no monospaced face; they keep their line breaks instead). Nothing here
 * sets HTML from a string. An inline media marker becomes a figure
 * (`playbook-media.tsx`).
 */

function InlineRun({ nodes }: { nodes: Inline[] }): ReactNode {
  return nodes.map((n, i) => {
    switch (n.kind) {
      case 'text':
        return n.text;
      case 'strong':
        return (
          <strong key={i} className="font-semibold text-foreground">
            <InlineRun nodes={n.children} />
          </strong>
        );
      case 'em':
        return (
          <em key={i}>
            <InlineRun nodes={n.children} />
          </em>
        );
      case 'code':
        return (
          <code key={i} className="rounded bg-muted px-1 py-0.5 text-[0.9em] font-medium text-foreground">
            {n.text}
          </code>
        );
      case 'link': {
        const external = /^https?:/i.test(n.href);
        return (
          <a
            key={i}
            href={n.href}
            className="font-medium text-foreground underline decoration-signal-edge underline-offset-2 hover:decoration-2"
            {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
          >
            <InlineRun nodes={n.children} />
          </a>
        );
      }
    }
  });
}

function Text({ text }: { text: string }) {
  return <InlineRun nodes={parseInline(text)} />;
}

/** The anchor of each level-2 heading, unique within one text. */
export function headingIds(blocks: Block[]): Map<Block, string> {
  const ids = new Map<Block, string>();
  const used = new Map<string, number>();
  for (const b of blocks) {
    if (b.kind !== 'heading' || b.level !== 2) continue;
    const base = headingId(inlineText(b.text));
    const n = used.get(base) ?? 0;
    used.set(base, n + 1);
    ids.set(b, n === 0 ? base : `${base}-${n + 1}`);
  }
  return ids;
}

function BlockView({ block, ids, tight }: { block: Block; ids?: Map<Block, string>; tight?: boolean }): ReactNode {
  switch (block.kind) {
    case 'heading': {
      if (block.level <= 2) {
        return (
          <h2
            id={ids?.get(block)}
            className="mt-12 scroll-mt-24 text-2xl font-semibold tracking-tight text-foreground first:mt-0"
          >
            <Text text={block.text} />
          </h2>
        );
      }
      return (
        <h3 className="mt-8 text-lg font-semibold text-foreground first:mt-0">
          <Text text={block.text} />
        </h3>
      );
    }
    case 'paragraph':
      return tight ? (
        <Text text={block.text} />
      ) : (
        <p className="mt-4 first:mt-0">
          <Text text={block.text} />
        </p>
      );
    case 'list': {
      const Tag = block.ordered ? 'ol' : 'ul';
      // A one-paragraph item reads as a line, without the paragraph's margin.
      return (
        <Tag
          start={block.ordered && block.start !== 1 ? block.start : undefined}
          className={`mt-4 flex flex-col gap-2 pl-6 first:mt-0 marker:text-muted-foreground ${
            block.ordered ? 'list-decimal marker:font-semibold' : 'list-disc'
          }`}
        >
          {block.items.map((item, i) => (
            <li key={i} className="pl-1">
              {item.map((b, j) => (
                <BlockView key={j} block={b} tight={item.length === 1 || (j === 0 && b.kind === 'paragraph')} />
              ))}
            </li>
          ))}
        </Tag>
      );
    }
    case 'quote':
      return (
        <blockquote className="mt-6 border-l-2 border-signal-edge pl-4 text-lg font-semibold leading-7 text-foreground first:mt-0">
          {block.blocks.map((b, i) => (
            <BlockView key={i} block={b} />
          ))}
        </blockquote>
      );
    case 'code':
      return (
        <pre className="mt-4 overflow-x-auto whitespace-pre-wrap rounded-lg border border-border bg-panel p-4 font-sans text-sm leading-6 text-foreground first:mt-0">
          {block.text}
        </pre>
      );
    case 'table':
      return (
        <div className="mt-4 overflow-x-auto rounded-lg border border-border first:mt-0">
          <table className="w-full border-collapse text-left text-sm">
            <thead className="bg-muted">
              <tr>
                {block.header.map((cell, i) => (
                  <th key={i} scope="col" className="px-3 py-2 font-semibold text-foreground">
                    <Text text={cell} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, i) => (
                <tr key={i} className="border-t border-border">
                  {block.header.map((_, j) => (
                    <td key={j} className="px-3 py-2 align-top">
                      <Text text={row[j] ?? ''} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case 'rule':
      return <hr className="my-8 border-border" />;
    case 'media':
      return <PlaybookMediaView media={block.media} />;
  }
}

/** A run of blocks in the reader's body type. */
export function MarkdownView({ blocks, ids, className = '' }: { blocks: Block[]; ids?: Map<Block, string>; className?: string }) {
  return (
    <div className={`text-base leading-7 text-foreground/90 ${className}`}>
      {blocks.map((b, i) => (
        <BlockView key={i} block={b} ids={ids} />
      ))}
    </div>
  );
}
