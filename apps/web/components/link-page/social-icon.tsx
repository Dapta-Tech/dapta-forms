import type { LinkPageSocial } from '@quill/types';

/**
 * The five network glyphs the link page draws. Inline SVG on `currentColor`
 * rather than the app's icon sheet: the sheet is Lucide, which carries no
 * brand marks, and the icons have to follow the page's own foreground colour.
 * Decorative: the link around each one carries the accessible name.
 *
 * The X and TikTok marks follow Simple Icons (CC0); the outlined ones follow
 * Lucide's older brand outlines (ISC, see `app/icons.css`).
 */
export function SocialIcon({ network }: { network: LinkPageSocial }) {
  const common = { viewBox: '0 0 24 24', width: 20, height: 20, 'aria-hidden': true, focusable: false } as const;
  switch (network) {
    case 'instagram':
      return (
        <svg {...common} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="2" width="20" height="20" rx="5" />
          <circle cx="12" cy="12" r="4" />
          <circle cx="17.5" cy="6.5" r="0.6" fill="currentColor" />
        </svg>
      );
    case 'x':
      return (
        <svg {...common} fill="currentColor">
          <path d="M18.9 1.15h3.68l-8.04 9.19L24 22.85h-7.4l-5.8-7.59-6.64 7.59H.47l8.6-9.83L0 1.15h7.59l5.24 6.93 6.07-6.93Zm-1.29 19.5h2.04L6.49 3.24H4.3l13.31 17.41Z" />
        </svg>
      );
    case 'youtube':
      return (
        <svg {...common} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M2.5 17a24 24 0 0 1 0-10 2 2 0 0 1 1.4-1.4 49.6 49.6 0 0 1 16.2 0A2 2 0 0 1 21.5 7a24 24 0 0 1 0 10 2 2 0 0 1-1.4 1.4 49.6 49.6 0 0 1-16.2 0A2 2 0 0 1 2.5 17" />
          <path d="m10 15 5-3-5-3z" fill="currentColor" />
        </svg>
      );
    case 'tiktok':
      return (
        <svg {...common} fill="currentColor">
          <path d="M12.53.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07Z" />
        </svg>
      );
    case 'whatsapp':
      return (
        <svg {...common} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 21l1.65-4.6A9 9 0 1 1 7.9 19.6L3 21Z" />
          <path
            d="M9 8.6c0-.4.3-.8.7-.8h.6c.3 0 .5.2.6.4l.6 1.4c.1.3 0 .6-.2.8l-.5.5a6 6 0 0 0 2.5 2.5l.5-.5c.2-.2.5-.3.8-.2l1.4.6c.3.1.4.3.4.6v.6c0 .4-.4.7-.8.7A6.4 6.4 0 0 1 9 8.6Z"
            fill="currentColor"
            stroke="none"
          />
        </svg>
      );
  }
}
