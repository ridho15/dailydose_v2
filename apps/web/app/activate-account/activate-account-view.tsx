'use client';

import { useState } from 'react';
import { browserIdentityClient, type IdentityClient } from '@/api-clients/identity-client';
import { Feedback } from '../ui';
import { useSessionContext } from '../session-context';
import { AuthPageShell } from '../components/auth/auth-page-shell';

export function ActivateAccountView({
  client = browserIdentityClient,
}: {
  client?: IdentityClient;
}) {
  const context = useSessionContext();
  const [show, setShow] = useState(false);
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  return (
    <AuthPageShell
      eyebrow="Welcome to Daily Dose"
      title="Create your password"
      description="Set a password to activate your account. This link works only once."
    >
      <form
        method="post"
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          const password = String(data.get('password'));
          if (password !== String(data.get('confirmation'))) {
            setStatus('error');
            return;
          }
          const token = new URLSearchParams(window.location.search).get('token') ?? '';
          setStatus('loading');
          void client
            .activatePassword(token, password)
            .then(async () => {
              setStatus('done');
              await context?.completeSignIn('/workspace');
            })
            .catch(() => setStatus('error'));
        }}
      >
        <label className="grid gap-2 text-sm font-bold">
          Password
          <span className="relative">
            <input
              className="min-h-[50px] w-full rounded-none border border-ed-line bg-white px-4 pr-24 text-sm text-ed-ink outline-none transition-colors focus:border-ed-forest focus:ring-1 focus:ring-ed-forest"
              name="password"
              type={show ? 'text' : 'password'}
              minLength={8}
              maxLength={128}
              autoComplete="new-password"
              required
            />
            <button
              className="absolute inset-y-0 right-1 px-3 text-[13px] font-bold text-ed-forest hover:text-ed-deep"
              type="button"
              onClick={() => setShow((value) => !value)}
            >
              {show ? 'Hide' : 'Show'}
            </button>
          </span>
        </label>
        <label className="grid gap-2 text-sm font-bold">
          Confirm password
          <input
            className="min-h-[50px] rounded-none border border-ed-line bg-white px-4 text-sm text-ed-ink outline-none transition-colors focus:border-ed-forest focus:ring-1 focus:ring-ed-forest"
            name="confirmation"
            type={show ? 'text' : 'password'}
            minLength={8}
            maxLength={128}
            autoComplete="new-password"
            required
          />
        </label>
        <button
          className="min-h-[50px] rounded-none bg-dd-forest px-5 font-bold text-white transition-colors hover:bg-ed-deep disabled:bg-ed-line disabled:text-ed-muted"
          disabled={status === 'loading'}
        >
          {status === 'loading' ? 'Activating…' : 'Activate account'}
        </button>
      </form>
      {status === 'done' && <Feedback kind="status">Your account is ready. Welcome in.</Feedback>}
      {status === 'error' && (
        <Feedback kind="error">
          The two passwords need to match, and the link must still be valid. Ask the studio for a new link if it has expired.
        </Feedback>
      )}
    </AuthPageShell>
  );
}
