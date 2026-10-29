'use client';

import { useEffect, useRef, useState } from 'react';
import type { IdentityClient } from '@/api-clients/identity-client';
import { Feedback } from '../../ui';
import { googleClientId } from '../../lib/google-client-id';

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize(input: {
            client_id: string;
            nonce: string;
            callback(response: { credential: string }): void;
          }): void;
          renderButton(element: HTMLElement, options: Record<string, string | number>): void;
        };
      };
    };
  }
}

export interface GoogleIdentityButtonProps {
  client: IdentityClient;
  onComplete(): Promise<void>;
  onFailure(error: unknown): void;
  text?: 'continue_with' | 'signin_with' | 'signup_with';
  width?: number;
  className?: string;
}

export function GoogleIdentityButton({
  client,
  onComplete,
  onFailure,
  text = 'continue_with',
  width = 380,
  className = '',
}: GoogleIdentityButtonProps) {
  const target = useRef<HTMLDivElement>(null);
  const [unavailable, setUnavailable] = useState(false);
  const clientId = googleClientId();

  useEffect(() => {
    if (!clientId || !target.current) return;
    const nonce = crypto.randomUUID();

    const render = () => {
      if (!window.google || !target.current) return;
      window.google.accounts.id.initialize({
        client_id: clientId,
        nonce,
        callback: ({ credential }) => {
          void client.signInWithGoogleToken(credential, nonce).then(onComplete).catch(onFailure);
        },
      });

      // Sesuaikan lebar maksimum agar tidak meluap di layar ponsel sempit
      const containerWidth = target.current.parentElement?.clientWidth ?? width;
      const effectiveWidth = Math.max(220, Math.min(width, containerWidth));

      window.google.accounts.id.renderButton(target.current, {
        type: 'standard',
        theme: 'outline',
        size: 'large',
        shape: 'rectangular',
        text,
        width: effectiveWidth,
        locale: 'id',
      });
    };

    const existing = document.querySelector<HTMLScriptElement>('script[data-google-identity]');
    if (existing) {
      if (window.google) render();
      else existing.addEventListener('load', render, { once: true });
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.dataset.googleIdentity = 'true';
    script.addEventListener('load', render, { once: true });
    script.addEventListener('error', () => setUnavailable(true), { once: true });
    document.head.append(script);
  }, [client, clientId, onComplete, onFailure, text, width]);

  if (!clientId) return null;

  if (unavailable) {
    return (
      <Feedback kind="info">
        Layanan Google sementara tidak dapat diakses. Silakan gunakan metode email dan password.
      </Feedback>
    );
  }

  return (
    <div
      className={`flex min-h-[44px] w-full justify-center overflow-hidden ${className}`}
      ref={target}
    />
  );
}
