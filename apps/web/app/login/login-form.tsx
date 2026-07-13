'use client';

import { useActionState } from 'react';
import type { BookingMessages } from '@slate/shared';
import { signInAction } from './actions';

/** Local dev login: email → session (sent as x-slate-email). A successful
 *  action redirects, so only the invalid-email branch returns here. */
export function LoginForm({ messages: m }: { messages: BookingMessages['admin']['login'] }) {
  const [state, action, pending] = useActionState(signInAction, null);
  return (
    <form action={action} className="flex flex-col gap-3">
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-muted-foreground">{m.emailLabel}</span>
        <input
          name="email"
          type="email"
          required
          autoFocus
          autoComplete="email"
          placeholder={m.emailPlaceholder}
          aria-invalid={state?.error ? true : undefined}
          className="rounded-md border border-input bg-background px-3 py-2.5"
        />
      </label>
      {state?.error ? (
        <p role="alert" className="text-sm text-destructive">
          {m.emailInvalid}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        className="inline-flex min-h-[44px] w-full items-center justify-center rounded-md bg-primary px-4 py-2.5 font-semibold text-primary-foreground transition-transform active:scale-[0.99] disabled:opacity-60"
      >
        {m.continue}
      </button>
    </form>
  );
}
