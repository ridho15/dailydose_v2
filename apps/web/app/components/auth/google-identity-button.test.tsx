import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GOOGLE_CLIENT_ID_BAWAAN, googleClientId } from '../../lib/google-client-id';
import { GoogleIdentityButton } from './google-identity-button';
import type { IdentityClient } from '@/api-clients/identity-client';

describe('GoogleIdentityButton', () => {
  const originalEnv = process.env;
  const mockClient = {
    signInWithGoogleToken: vi.fn().mockResolvedValue(undefined),
  } as unknown as IdentityClient;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it('uses the studio Client ID when NEXT_PUBLIC_GOOGLE_CLIENT_ID is not configured', () => {
    delete process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
    expect(googleClientId()).toBe(GOOGLE_CLIENT_ID_BAWAAN);
    process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID = '';
    expect(googleClientId()).toBe(GOOGLE_CLIENT_ID_BAWAAN);
    const { container } = render(
      <GoogleIdentityButton
        client={mockClient}
        onComplete={vi.fn()}
        onFailure={vi.fn()}
      />,
    );
    expect(container.querySelector('div')).toBeInTheDocument();
  });

  it('renders container when NEXT_PUBLIC_GOOGLE_CLIENT_ID is configured', () => {
    process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID = 'test-client-id.apps.googleusercontent.com';
    const { container } = render(
      <GoogleIdentityButton
        client={mockClient}
        onComplete={vi.fn()}
        onFailure={vi.fn()}
      />,
    );
    expect(container.querySelector('div')).toBeInTheDocument();
  });
});
