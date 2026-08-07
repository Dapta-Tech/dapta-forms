'use client';

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';

type ToastType = 'success' | 'error' | 'info';
interface Toast {
  id: number;
  type: ToastType;
  message: string;
}

interface ToastApi {
  toast: (message: string, type?: ToastType) => void;
  success: (message: string) => void;
  error: (message: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

/** Global feedback (replaces the old inline-text / swallowed-error pattern).
 *  Bottom-right stack, auto-dismiss, a11y live region, R22. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);

  const remove = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const toast = useCallback(
    (message: string, type: ToastType = 'info') => {
      const id = ++seq.current;
      setToasts((t) => [...t, { id, type, message }]);
      // Errors linger a little longer than successes.
      setTimeout(() => remove(id), type === 'error' ? 6000 : 3500);
    },
    [remove],
  );

  const api: ToastApi = {
    toast,
    success: (m) => toast(m, 'success'),
    error: (m) => toast(m, 'error'),
  };

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex flex-col items-center gap-2 p-4 sm:items-end"
        aria-live="polite"
        aria-atomic="false"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            role={t.type === 'error' ? 'alert' : 'status'}
            className={[
              'pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-md border px-4 py-3 text-sm shadow-lg',
              'bg-popover text-popover-foreground',
              t.type === 'error' ? 'border-destructive' : t.type === 'success' ? 'border-primary-edge/50' : 'border-border',
            ].join(' ')}
          >
            <span
              aria-hidden
              className={
                'mt-0.5 h-2 w-2 shrink-0 rounded-full ' +
                (t.type === 'error' ? 'bg-destructive' : t.type === 'success' ? 'bg-primary' : 'bg-muted-foreground')
              }
            />
            <span className="flex-1">{t.message}</span>
            <button
              type="button"
              onClick={() => remove(t.id)}
              aria-label="Dismiss"
              className="shrink-0 text-muted-foreground hover:text-foreground"
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/** Access the toast API. Safe no-op if a provider isn't mounted (SSR/tests). */
export function useToast(): ToastApi {
  return (
    useContext(ToastContext) ?? {
      toast: () => undefined,
      success: () => undefined,
      error: () => undefined,
    }
  );
}
