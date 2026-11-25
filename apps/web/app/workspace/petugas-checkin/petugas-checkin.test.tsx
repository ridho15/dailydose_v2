import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { canAccessSessionPath, defaultSessionDestination } from '../../session-context';
import { badgePeran } from '../../app-navigation';
import { PetugasCheckinView, type PetugasClient } from './petugas-checkin-view';

vi.mock('../../session-context', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../session-context')>()),
  useSessionContext: () => ({ activeBranchId: 'gg', session: { branches: [{ id: 'gg', name: 'Green Garden' }] } }),
}));

const sesiPetugas = {
  roles: ['CHECKIN_STAFF'],
  capabilities: ['attendance:desk'],
  globalCapabilities: [],
  branches: [],
} as never;

describe('Sesi Petugas Check-in', () => {
  it('langsung ke layar check-in; halaman lain tertutup; badge Petugas Check-in', () => {
    expect(defaultSessionDestination(sesiPetugas)).toBe('/workspace/check-in');
    expect(canAccessSessionPath(sesiPetugas, '/workspace/check-in')).toBe(true);
    for (const p of ['/workspace', '/customers', '/workspace/kas', '/ledger', '/workspace/classes', '/workspace/payments'])
      expect(canAccessSessionPath(sesiPetugas, p)).toBe(false);
    expect(badgePeran(['CHECKIN_STAFF'], false)).toBe('Petugas Check-in');
  });
});

describe('PetugasCheckinView', () => {
  it('membuat akun: username dikecilkan, tombol aktif hanya bila isian sah, lalu tampil di daftar', async () => {
    const user = userEvent.setup();
    const items: any[] = [];
    const client: PetugasClient = {
      daftar: vi.fn(async () => ({ items: [...items] })),
      buat: vi.fn(async (input) => {
        const p = { userId: 'u1', ...input, branchName: 'Green Garden', status: 'ACTIVE', createdAt: '' };
        items.push(p);
        return p;
      }),
      gantiPassword: vi.fn(),
      ubahStatus: vi.fn(),
    };
    render(<PetugasCheckinView client={client} />);
    expect(await screen.findByText('Belum ada petugas check-in.')).toBeVisible();
    const tombol = screen.getByRole('button', { name: 'Buat akun petugas' });
    await user.type(screen.getByLabelText('Nama'), 'Andi OB');
    await user.type(screen.getByLabelText('Username untuk login'), 'Andi.GG');
    await user.type(screen.getByLabelText('Kata sandi awal'), 'pendek');
    expect(tombol).toBeDisabled();
    await user.type(screen.getByLabelText('Kata sandi awal'), '123');
    expect(tombol).toBeEnabled();
    await user.click(tombol);
    await waitFor(() =>
      expect(client.buat).toHaveBeenCalledWith({ displayName: 'Andi OB', username: 'andi.gg', password: 'pendek123', branchId: 'gg' }),
    );
    expect(await screen.findByText(/Login dengan username "andi.gg"/)).toBeVisible();
    expect(await screen.findByRole('button', { name: 'Nonaktifkan' })).toBeVisible();
  });
});
