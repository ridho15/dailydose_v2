import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ModalSesiSection } from './modal-sesi';

vi.mock('../components/app-feedback', async (asli) => ({
  ...(await asli<typeof import('../components/app-feedback')>()),
  useAppFeedback: () => ({ confirm: vi.fn().mockResolvedValue(true), showAlert: vi.fn() }),
}));

const branches = [
  { id: 'pik', name: 'Orange Groves PIK 2' },
  { id: 'untar', name: 'Untar Kampus 2' },
];
const classTypes = [
  { id: 'grp', name: 'Group' },
  { id: 'pvt', name: 'Private' },
];
const client = () => ({
  daftarModalSesi: vi.fn().mockResolvedValue([
    {
      id: 'a',
      branchId: 'untar',
      classTypeId: 'grp',
      modalPerSesiRp: 50_000,
      effectiveDate: '2026-10-01',
      createdAt: '',
    },
    {
      id: 'b',
      branchId: 'untar',
      classTypeId: 'grp',
      modalPerSesiRp: 45_000,
      effectiveDate: '2026-01-01',
      createdAt: '',
    },
    {
      id: 'c',
      branchId: 'pik',
      classTypeId: 'grp',
      modalPerSesiRp: 80_000,
      effectiveDate: '2026-01-01',
      createdAt: '',
    },
  ]),
  simpanModalSesi: vi.fn().mockResolvedValue({}),
  hapusModalSesi: vi.fn().mockResolvedValue({}),
});

describe('ModalSesiSection', () => {
  it('menampilkan modal yang berlaku per cabang dan tipe kelas', async () => {
    render(
      <ModalSesiSection branches={branches} classTypes={classTypes} canEdit client={client()} />,
    );
    const tabel = await screen.findByRole('table', {
      name: 'Modal per sesi per cabang dan tipe kelas',
    });
    expect(within(tabel).getAllByRole('row')).toHaveLength(3);
    expect(within(tabel).getByText(/50\.000/)).toBeVisible();
    expect(within(tabel).getByText(/80\.000/)).toBeVisible();
    expect(within(tabel).queryByText(/45\.000/)).toBeNull();
  });

  it('menyimpan modal per sesi untuk cabang dan tipe kelas', async () => {
    const user = userEvent.setup();
    const c = client();
    render(<ModalSesiSection branches={branches} classTypes={classTypes} canEdit client={c} />);
    await user.click(await screen.findByRole('button', { name: 'Atur modal' }));
    const dialog = await screen.findByRole('dialog', { name: 'Atur modal per sesi' });
    await user.selectOptions(within(dialog).getByLabelText('Cabang'), 'untar');
    await user.type(within(dialog).getByLabelText(/Modal per sesi/), '50.000');
    await user.click(within(dialog).getByRole('button', { name: 'Simpan modal' }));
    expect(c.simpanModalSesi).toHaveBeenCalledWith(
      expect.objectContaining({ branchId: 'untar', classTypeId: 'grp', modalPerSesiRp: 50_000 }),
    );
  });

  it('tanpa izin ubah hanya membaca', async () => {
    render(
      <ModalSesiSection
        branches={branches}
        classTypes={classTypes}
        canEdit={false}
        client={client()}
      />,
    );
    await screen.findByRole('table');
    expect(screen.queryByRole('button', { name: 'Atur modal' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Hapus' })).toBeNull();
  });
});
