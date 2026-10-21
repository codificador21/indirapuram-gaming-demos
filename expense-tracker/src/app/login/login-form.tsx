'use client';

import { useActionState } from 'react';
import { loginAction } from '@/app/actions';
import { buttonClass, inputClass } from '@/components/ui';

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(loginAction, null);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="next" value={next} />
      <input
        name="password"
        type="password"
        autoComplete="current-password"
        placeholder="Password"
        required
        autoFocus
        className={inputClass}
        aria-label="Password"
      />
      {state?.error && <p className="px-1 text-sm text-critical-ink">{state.error}</p>}
      <button type="submit" disabled={pending} className={`${buttonClass.primary} w-full`}>
        {pending ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}
