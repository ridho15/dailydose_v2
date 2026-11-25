import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../lib/api-client';
import { LengkapiAkunView } from './lengkapi-akun-view';

const replace = vi.fn();
let session: Record<string, unknown> | null = null;
const refresh = vi.fn(async () => null);

vi.mock('../../components/app-loading', () => ({
  useTrackedRouter: () => ({ replace, push: vi.fn() }),
}));
vi.mock('../../session-context', () => ({
  useSessionContext: () => ({ session, refresh }),
}));

const klien = () => ({
  setujuiSyarat: vi.fn().mockResolvedValue({}),
  simpanNomor: vi.fn().mockResolvedValue({}),
  kirimSelfie: vi.fn().mockResolvedValue({}),
});

describe('LengkapiAkunView', () => {
  beforeEach(() => {
    replace.mockClear();
    refresh.mockClear();
  });

  it('member Google: syarat dulu (langkah 1 dari 3), tombol aktif hanya setelah dicentang', async () => {
    session = {
      displayName: 'Ayu Lestari',
      termsRequired: true,
      phoneRequired: true,
      identityVerificationStatus: 'ACTION_REQUIRED',
    };
    const client = klien();
    const view = render(<LengkapiAkunView client={client} />);
    expect(screen.getByText('Langkah 1 dari 3')).toBeVisible();
    expect(screen.getByText(/maksimal 3 kali per paket/)).toBeVisible();
    expect(screen.getByRole('link', { name: 'Syarat & Ketentuan' })).toHaveAttribute('href', '/terms');
    expect((await axe(view.container)).violations).toHaveLength(0);
    const tombol = screen.getByRole('button', { name: 'Setuju dan lanjut' });
    expect(tombol).toBeDisabled();
    await userEvent.click(screen.getByRole('checkbox', { name: /telah membaca dan menyetujui/ }));
    await userEvent.click(tombol);
    expect(client.setujuiSyarat).toHaveBeenCalled();
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it('member lama yang sudah lengkap hanya diminta menyetujui syarat versi baru', () => {
    session = { displayName: 'Ayu', termsRequired: true, identityVerificationStatus: 'APPROVED' };
    render(<LengkapiAkunView client={klien()} />);
    expect(screen.getByText('Langkah 1 dari 1')).toBeVisible();
    expect(screen.getByText(/Syarat & Ketentuan Daily Dose diperbarui/)).toBeVisible();
    expect(replace).not.toHaveBeenCalled();
  });

  it('meminta nomor WhatsApp lebih dulu lalu menyegarkan sesi', async () => {
    session = {
      displayName: 'Ayu Lestari',
      phoneRequired: true,
      identityVerificationStatus: 'ACTION_REQUIRED',
    };
    const client = klien();
    const view = render(<LengkapiAkunView client={client} />);
    expect(screen.getByText('Langkah 1 dari 2')).toBeVisible();
    expect((await axe(view.container)).violations).toHaveLength(0);
    await userEvent.type(screen.getByLabelText('Nomor WhatsApp'), '0812 3456 7890');
    await userEvent.click(screen.getByRole('button', { name: 'Simpan dan lanjut' }));
    expect(client.simpanNomor).toHaveBeenCalledWith('0812 3456 7890');
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it('menjelaskan bila nomor sudah dipakai akun lain', async () => {
    session = {
      displayName: 'Ayu',
      phoneRequired: true,
      identityVerificationStatus: 'ACTION_REQUIRED',
    };
    const client = klien();
    client.simpanNomor.mockRejectedValueOnce(
      new ApiError('PHONE_ALREADY_REGISTERED', 409, { code: 'PHONE_ALREADY_REGISTERED' }),
    );
    render(<LengkapiAkunView client={client} />);
    await userEvent.type(screen.getByLabelText('Nomor WhatsApp'), '081234567890');
    await userEvent.click(screen.getByRole('button', { name: 'Simpan dan lanjut' }));
    expect(await screen.findByText(/sudah dipakai akun lain/)).toBeVisible();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('menjelaskan bila nomor sudah dipakai akun lain dengan format galat asli server ({ error: { code } })', async () => {
    session = {
      displayName: 'Ayu',
      phoneRequired: true,
      identityVerificationStatus: 'ACTION_REQUIRED',
    };
    const client = klien();
    client.simpanNomor.mockRejectedValueOnce(
      new ApiError('Permintaan tidak dapat diproses.', 409, {
        error: { code: 'PHONE_ALREADY_REGISTERED', message: 'Permintaan tidak dapat diproses.' },
      }, 'PHONE_ALREADY_REGISTERED'),
    );
    render(<LengkapiAkunView client={client} />);
    await userEvent.type(screen.getByLabelText('Nomor WhatsApp'), '081234567890');
    await userEvent.click(screen.getByRole('button', { name: 'Simpan dan lanjut' }));
    expect(await screen.findByText(/sudah dipakai akun lain/)).toBeVisible();
    expect(screen.getByRole('link', { name: 'Masuk ke Akun Lama' })).toBeVisible();
  });

  it('setelah nomor tersimpan, meminta selfie; akun lengkap kembali ke beranda', () => {
    session = {
      displayName: 'Ayu',
      phoneRequired: false,
      identityVerificationStatus: 'ACTION_REQUIRED',
    };
    const { rerender } = render(<LengkapiAkunView client={klien()} />);
    expect(screen.getByText('Langkah 2 dari 2')).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Foto selfie' })).toBeVisible();
    expect(replace).not.toHaveBeenCalled();

    session = { displayName: 'Ayu', phoneRequired: false, identityVerificationStatus: 'APPROVED' };
    rerender(<LengkapiAkunView client={klien()} />);
    expect(replace).toHaveBeenCalledWith('/account');
  });
});
