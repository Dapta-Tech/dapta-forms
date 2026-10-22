import type { ReactNode } from 'react';

/**
 * A step body from the catalog: `**text**` bold, text between backticks as
 * inline code. Nothing else is markup, so the copy cannot inject HTML.
 */
export function stepText(text: string): ReactNode[] {
  return text.split('**').flatMap((part, i) => {
    const pieces = part.split('`').map((piece, j) =>
      j % 2 === 1 ? (
        <code
          key={`${i}-${j}`}
          className="break-words rounded bg-muted px-1 py-0.5 font-mono text-[0.85em] text-foreground"
        >
          {piece}
        </code>
      ) : (
        piece
      ),
    );
    return i % 2 === 1
      ? [
          <strong key={i} className="font-semibold text-foreground">
            {pieces}
          </strong>,
        ]
      : pieces;
  });
}
