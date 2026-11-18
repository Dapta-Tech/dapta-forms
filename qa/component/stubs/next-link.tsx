import type { AnchorHTMLAttributes, ReactNode } from 'react';

/**
 * `next/link` for qa/component: a plain anchor. The real one needs the App
 * Router's context for prefetching; a layout spec only needs the element.
 */
export default function Link({
  href,
  prefetch: _prefetch,
  children,
  ...rest
}: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; prefetch?: boolean; children?: ReactNode }) {
  return (
    <a href={href} {...rest}>
      {children}
    </a>
  );
}
