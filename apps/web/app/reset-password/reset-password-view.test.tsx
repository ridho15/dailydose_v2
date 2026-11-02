import { render, screen } from '@testing-library/react';
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

    await user.type(screen.getByLabelText('Password baru'), 'passwordBaru123');
    await user.type(screen.getByLabelText('Ulangi password baru'), 'passwordBeda456');
    await user.click(screen.getByRole('button', { name: 'Simpan password baru' }));

    expect(client.resetPassword).not.toHaveBeenCalled();
    expect(
      screen.getByText('Konfirmasi password tidak cocok dengan password baru.'),
    ).toBeVisible();
  });

  it('surfaces expired token error when the server rejects the reset token', async () => {
    const user = userEvent.setup();
    const client = fakeClient({
      resetPassword: vi.fn().mockRejectedValue({ response: { status: 400 } }),
    });
    render(<ResetPasswordView client={client} />);

    await user.type(screen.getByLabelText('Password baru'), 'passwordBaru123');
    await user.type(screen.getByLabelText('Ulangi password baru'), 'passwordBaru123');
    await user.click(screen.getByRole('button', { name: 'Simpan password baru' }));

    expect(client.resetPassword).toHaveBeenCalledTimes(1);
    expect(
      await screen.findByText(
        'Tautan reset password sudah tidak berlaku atau sudah digunakan. Silakan minta tautan baru di halaman Lupa Password.',
      ),
    ).toBeVisible();
  });

  it('shows success message and link to sign in when password is reset successfully', async () => {
    const user = userEvent.setup();
    const client = fakeClient({
      resetPassword: vi.fn().mockResolvedValue(undefined),
    });
    render(<ResetPasswordView client={client} />);

    await user.type(screen.getByLabelText('Password baru'), 'passwordBaru123');
    await user.type(screen.getByLabelText('Ulangi password baru'), 'passwordBaru123');
    await user.click(screen.getByRole('button', { name: 'Simpan password baru' }));

    expect(client.resetPassword).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(/Password berhasil diperbarui\./i)).toBeVisible();
    expect(screen.getByRole('link', { name: /Silakan masuk ke akun/i })).toBeVisible();
  });
});
