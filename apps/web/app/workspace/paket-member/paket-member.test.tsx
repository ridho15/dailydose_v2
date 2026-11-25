import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { describe, expect, it, vi } from 'vitest';
import { canAccessSessionPath } from '../../session-context';
import { PaketMemberView, type PaketMember, type PaketMemberClient } from './paket-member-view';

let caps: string[] = [];
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock('../../session-context', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../session-context')>()),
  useSessionContext: () => ({
    activeBranchId: 'gg',
    activeBranch: { id: 'gg', name: 'Green Garden' },
    session: { branches: [{ id: 'gg', name: 'Green Garden' }] },
    hasCapability: (...c: string[]) => c.some((x) => caps.includes(x)),
  }),
}));

const hariLagi = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();
const paket = (over: Partial<PaketMember> = {}): PaketMember => ({
  id: 'cp-1',
  status: 'ACTIVE',
  expiryAt: hariLagi(5),
  ledgerBalance: 6,
  available: 6,
  packageName: 'Reformer 8 Sesi',
  branchName: 'Green Garden',
  classTypeName: 'Reformer',
  customer: { id: 'u-ayu', displayName: 'Ayu Lestari', phoneMasked: '0812****890' },
  usage: { initialSessions: 8 },
  ...over,
});

const klien = (items: PaketMember[]): PaketMemberClient => ({
  cari: vi.fn(async () => items),
  kelola: vi.fn(async () => ({})),
});

describe('PaketMemberView', () => {
  it('tiga langkah: klik Ubah tanggal berakhir, pilih +30 hari dan alasan, Simpan', async () => {
    caps = ['ledger:read', 'customer-package:manage'];
    const user = userEvent.setup();
    const utama = paket();
    const client = klien([utama, paket({ id: 'cp-2', packageName: 'Mat 4 Sesi', ledgerBalance: 0 })]);
    const view = render(<PaketMemberView client={client} />);
    const kartu = (await screen.findByText('Reformer 8 Sesi')).closest('li')!;
    expect(within(kartu).getByText('5 hari lagi')).toBeVisible();
    expect((await axe(view.container)).violations).toHaveLength(0);
    // Paket tanpa sisa sesi tidak menawarkan ubah tanggal.
    expect(within(screen.getByText('Mat 4 Sesi').closest('li')!).queryByRole('button', { name: 'Ubah tanggal berakhir' })).toBeNull();

    await user.click(within(kartu).getByRole('button', { name: 'Ubah tanggal berakhir' }));
    await user.click(within(kartu).getByRole('button', { name: '+30 hari' }));
    const simpan = within(kartu).getByRole('button', { name: 'Simpan tanggal' });
    expect(simpan).toBeDisabled();
    await user.click(within(kartu).getByRole('button', { name: 'Persetujuan owner' }));
    await user.click(simpan);
    await waitFor(() =>
      expect(client.kelola).toHaveBeenCalledWith('cp-1', 'extend', expect.objectContaining({ reason: 'Persetujuan owner', expectedValidUntil: utama.expiryAt })),
    );
    const tanggal = vi.mocked(client.kelola).mock.calls[0]![2].newValidUntil!;
    expect(tanggal).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(await screen.findByText(/Ayu Lestari: Reformer 8 Sesi sekarang berakhir/)).toBeVisible();
  });

  it('bekukan gagal karena ada booking mendatang: pesan jelas di kartu', async () => {
    caps = ['ledger:read', 'customer-package:manage'];
    const user = userEvent.setup();
    const client = klien([paket({ expiryAt: hariLagi(40) })]);
    vi.mocked(client.kelola).mockRejectedValueOnce({ status: 409, data: { error: { code: 'HAS_UPCOMING_BOOKINGS' } } });
    render(<PaketMemberView client={client} />);
    await user.click(await screen.findByRole('button', { name: 'Bekukan' }));
    await user.click(screen.getByRole('button', { name: 'Lainnya' }));
    await user.type(screen.getByLabelText('Tulis alasannya'), 'Cuti melahirkan');
    await user.click(screen.getByRole('button', { name: 'Bekukan' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/booking mendatang/);
    expect(client.kelola).toHaveBeenCalledWith('cp-1', 'freeze', expect.objectContaining({ reason: 'Cuti melahirkan' }));
  });

  it('paket sudah berakhir tetapi bersisa sesi: tawarkan Jual perpanjangan, tanpa Bekukan', async () => {
    caps = ['ledger:read', 'customer-package:manage', 'purchase:record'];
    render(<PaketMemberView client={klien([paket({ status: 'EXPIRED', expiryAt: hariLagi(-3) })])} />);
    const kartu = (await screen.findByText('Reformer 8 Sesi')).closest('li')!;
    expect(within(kartu).getByText('Berakhir 3 hari lalu')).toBeVisible();
    expect(within(kartu).getByRole('button', { name: 'Jual perpanjangan' })).toBeVisible();
    expect(within(kartu).queryByRole('button', { name: 'Bekukan' })).toBeNull();
  });

  it('Owner hanya melihat: tanpa tombol ubah atau bekukan, tetap ada Riwayat sesi', async () => {
    caps = ['ledger:read'];
    render(<PaketMemberView client={klien([paket()])} />);
    await screen.findByText('Reformer 8 Sesi');
    expect(screen.queryByRole('button', { name: 'Ubah tanggal berakhir' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Bekukan' })).toBeNull();
  });

  it('pencarian mengirim kata kunci; hasil kosong menjelaskan apa yang dicari', async () => {
    caps = ['ledger:read'];
    const user = userEvent.setup();
    const client = klien([]);
    render(<PaketMemberView client={client} />);
    expect(await screen.findByText('Tidak ada paket yang berakhir dalam 14 hari ke depan.')).toBeVisible();
    await user.type(screen.getByLabelText('Cari member'), 'sinta');
    expect(await screen.findByText(/Tidak ada paket untuk "sinta"/)).toBeVisible();
    expect(client.cari).toHaveBeenLastCalledWith(expect.objectContaining({ q: 'sinta' }));
  });

  it('rute: staf dengan ledger:read boleh membuka; petugas check-in tidak', () => {
    const staf = { roles: ['ADMIN'], capabilities: ['ledger:read'], globalCapabilities: [], branches: [] } as never;
    const petugas = { roles: ['CHECKIN_STAFF'], capabilities: ['attendance:desk'], globalCapabilities: [], branches: [] } as never;
    expect(canAccessSessionPath(staf, '/workspace/paket-member')).toBe(true);
    expect(canAccessSessionPath(petugas, '/workspace/paket-member')).toBe(false);
  });
});
