import { forwardRef } from 'react';
import { cn } from '@/lib/cn';

/**
 * shadcn-style Checkbox — replaces the native (browser-blue) checkbox with a
 * token-driven control: lime fill + near-black check when on, on-surface border
 * when off. No raw hex, both themes. (Design Quality Bar §11 — tokens only.)
 */
export const Checkbox = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  function Checkbox({ className, ...props }, ref) {
    return (
      <span className="relative inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center">
        <input
          ref={ref}
          type="checkbox"
          className={cn(
            'peer h-[18px] w-[18px] shrink-0 cursor-pointer appearance-none rounded-sm border border-input bg-background transition-colors',
            'hover:border-muted-foreground checked:border-primary-edge checked:bg-primary checked:hover:border-primary-edge',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            className,
          )}
          {...props}
        />
        <svg
          aria-hidden
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="pointer-events-none absolute h-3 w-3 text-primary-foreground opacity-0 transition-opacity peer-checked:opacity-100"
        >
          <path d="M13 4.5 6.25 11.5 3 8.25" />
        </svg>
      </span>
    );
  },
);
