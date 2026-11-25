import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { IdentityClient } from '@/api-clients/identity-client';
import { ResetPasswordView } from './reset-password-view';

const fakeClient = (overrides: Partial<IdentityClient> = {}): IdentityClient =>
  ({
    resetPassword: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as IdentityClient);

describe('ResetPasswordView', () => {
  it('surfaces a clear mismatch error when password confirmation does not match', async () => {
    const user = userEvent.setup();
    const client = fakeClient();
    render(<ResetPasswordView client={client} />);

    await user.type(screen.getByLabelText('New password'), 'passwordBaru123');
    await user.type(screen.getByLabelText('Confirm new password'), 'passwordBeda456');
    await user.click(screen.getByRole('button', { name: 'Save new password' }));

    expect(client.resetPassword).not.toHaveBeenCalled();
    expect(
      screen.getByText("The two passwords don't match yet. Please try again."),
    ).toBeVisible();
  });

  it('surfaces expired token error when the server rejects the reset token', async () => {
    const user = userEvent.setup();
    const client = fakeClient({
      resetPassword: vi.fn().mockRejectedValue({ response: { status: 400 } }),
    });
    render(<ResetPasswordView client={client} />);

    await user.type(screen.getByLabelText('New password'), 'passwordBaru123');
    await user.type(screen.getByLabelText('Confirm new password'), 'passwordBaru123');
    await user.click(screen.getByRole('button', { name: 'Save new password' }));

    expect(client.resetPassword).toHaveBeenCalledTimes(1);
    expect(
      await screen.findByText(
        'This reset link has expired or was already used. Request a fresh one from the Forgot password page.',
      ),
    ).toBeVisible();
  });

  it('shows success message and link to sign in when password is reset successfully', async () => {
    const user = userEvent.setup();
    const client = fakeClient({
      resetPassword: vi.fn().mockResolvedValue(undefined),
    });
    render(<ResetPasswordView client={client} />);

    await user.type(screen.getByLabelText('New password'), 'passwordBaru123');
    await user.type(screen.getByLabelText('Confirm new password'), 'passwordBaru123');
    await user.click(screen.getByRole('button', { name: 'Save new password' }));

    expect(client.resetPassword).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(/Your password is updated\./i)).toBeVisible();
    expect(within(screen.getByRole('status')).getByRole('link', { name: /^Sign in$/i })).toBeVisible();
  });
});
