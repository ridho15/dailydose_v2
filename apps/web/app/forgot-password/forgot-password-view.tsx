'use client';

import { useState } from 'react';
import {
  browserIdentityClient,
  failureCode,
  type IdentityClient,
} from '@/api-clients/identity-client';
import { Feedback } from '../ui';
import { AuthPageShell } from '../components/auth/auth-page-shell';

export function ForgotPasswordView({
  client = browserIdentityClient,
}: {
  client?: IdentityClient;
}) {
  const [status, setStatus] = useState<'idle' | 'loading' | 'sent' | 'error'>('idle');
  return (
    <AuthPageShell
      eyebrow="Account help"
      title="Forgot your password?"
      description="Enter the email on your account and we'll send you a link to set a new password."
    >
      <form
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          setStatus('loading');
          void client
            .requestPasswordReset(String(new FormData(event.currentTarget).get('email')))
            .then(() => setStatus('sent'))
            .catch((error) => {
              failureCode(error);
              setStatus('error');
            });
        }}
      >
        <label className="grid gap-2 text-sm font-bold">
          Email
          <input
            className="min-h-[50px] rounded-none border border-ed-border-ui bg-white px-4 text-sm text-ed-ink transition-colors focus-visible:outline focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[#09371f]"
            name="email"
            type="email"
            autoComplete="email"
            placeholder="you@email.com"
            required
          />
        </label>
        <button
          className="min-h-[50px] rounded-none bg-dd-forest px-5 font-bold text-white transition-colors hover:bg-ed-deep focus-visible:outline focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[#09371f] disabled:bg-ed-line disabled:text-ed-muted"
          disabled={status === 'loading'}
        >
          {status === 'loading' ? 'Sending…' : 'Send reset link'}
        </button>
      </form>
      {status === 'sent' && (
        <Feedback kind="status">
          If that email belongs to an account, a reset link is on its way. Check your inbox, and your spam folder just in case.
        </Feedback>
      )}
      {status === 'error' && (
        <Feedback kind="error">We couldn&apos;t send the link just now. Please try again in a moment.</Feedback>
      )}
    </AuthPageShell>
  );
}
