import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { VerificationView } from './verification-view';

const navigation = vi.hoisted(() => ({ push: vi.fn(), params: new URLSearchParams() }));
const sessionRefresh = vi.hoisted(() => vi.fn().mockResolvedValue(null));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: navigation.push }),
  useSearchParams: () => navigation.params,
}));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('../../session-context', () => ({
  useSessionContext: () => ({ refresh: sessionRefresh }),
}));

const client = (status: string, rejectionReason: string | null = null) => ({
  mine: vi.fn().mockResolvedValue({ status, documents: [], rejectionReason }),
  submit: vi.fn().mockResolvedValue({ status: 'APPROVED', message: 'ok' }),
});

describe('VerificationView (selfie saja)', () => {
  beforeEach(() => {
    sessionStorage.clear();
    navigation.push.mockReset();
    navigation.params = new URLSearchParams();
  });

  it('tidak meminta KTP, NIK, atau alamat; cukup foto selfie', async () => {
    const c = client('ACTION_REQUIRED');
    const { container } = render(<VerificationView client={c as never} />);
    expect(await screen.findByRole('heading', { level: 1, name: 'Foto selfie' })).toBeVisible();
    expect(screen.getByLabelText('Pilih foto selfie')).toHaveAttribute('capture', 'user');
    expect(screen.queryByText(/KTP/)).toHaveTextContent('tanpa KTP');
    expect(screen.queryByText(/NIK/)).toBeNull();
    expect((await axe(container)).violations).toHaveLength(0);
  });

  it('menyimpan foto, menyegarkan sesi, lalu kembali ke langkah pembelian', async () => {
    const user = userEvent.setup();
    navigation.params = new URLSearchParams({ returnTo: '/checkout?order=1' });
    const c = client('ACTION_REQUIRED');
    c.mine.mockResolvedValueOnce({ status: 'ACTION_REQUIRED', documents: [] });
    c.mine.mockResolvedValue({ status: 'APPROVED', documents: [] });
    render(<VerificationView client={c as never} />);

    const foto = new File(['x'], 'selfie.jpg', { type: 'image/jpeg' });
    await user.upload(await screen.findByLabelText('Pilih foto selfie'), foto);
    await user.click(screen.getByRole('button', { name: 'Simpan foto selfie' }));

    expect(c.submit).toHaveBeenCalledWith({ selfie: foto });
    await waitFor(() => expect(navigation.push).toHaveBeenCalledWith('/checkout?order=1'));
    expect(sessionRefresh).toHaveBeenCalled();
  });

  it('menyebut alasan bila foto sebelumnya ditolak staf', async () => {
    render(<VerificationView client={client('REJECTED', 'FOTO_BURAM') as never} />);
    expect(
      await screen.findByText(/Foto sebelumnya belum bisa dipakai \(FOTO_BURAM\)/),
    ).toBeVisible();
    expect(screen.getByLabelText('Pilih foto selfie')).toBeInTheDocument();
  });

  it('menampilkan foto yang sudah ada dan bisa diganti', async () => {
    const user = userEvent.setup();
    render(<VerificationView client={client('APPROVED') as never} />);
    expect(await screen.findByText('Foto selfie sudah ada')).toBeVisible();
    expect(screen.queryByLabelText('Pilih foto selfie')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Ganti foto' }));
    expect(screen.getByLabelText('Pilih foto selfie')).toBeInTheDocument();
  });
});
