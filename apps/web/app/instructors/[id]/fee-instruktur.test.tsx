import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { MasterSetting } from '@/api-clients/master-client';
import { FeeInstruktur } from './fee-instruktur';

const fee = (
  id: string,
  branchId: string,
  feeRp: number,
  mulai: string,
  instructorId = 'anna',
): MasterSetting => ({
  id,
  kind: 'INSTRUCTOR_FEE',
  businessKey: id,
  branchId,
  classTypeId: 'grp',
  value: { feeRp },
  effectiveFrom: new Date(`${mulai}T00:00:00Z`),
  effectiveUntil: null,
  version: 1,
  instructorId,
});

const client = () => ({
  listSettings: vi
    .fn()
    .mockResolvedValue([
      fee('f1', 'pik', 70_000, '2026-01-01'),
      fee('f2', 'pik', 80_000, '2026-06-01'),
      fee('f3', 'untar', 50_000, '2026-01-01'),
      fee('lain', 'pik', 99_000, '2026-01-01', 'budi'),
    ]),
  listClassTypes: vi
    .fn()
    .mockResolvedValue([
      { id: 'grp', code: 'GRP', name: 'Group Class', active: true, version: 1, branchScopes: [] },
    ]),
  createSetting: vi.fn().mockResolvedValue(undefined),
});
const branches = [
  { id: 'pik', name: 'Orange Groves PIK 2' },
  { id: 'untar', name: 'Untar Kampus 2' },
];

describe('FeeInstruktur', () => {
  it('menampilkan fee yang berlaku per cabang hanya untuk instruktur ini', async () => {
    render(<FeeInstruktur instructorId="anna" branches={branches} canEdit client={client()} />);
    const tabel = await screen.findByRole('table', { name: 'Fee per sesi instruktur' });
    const baris = within(tabel).getAllByRole('row').slice(1);
    expect(baris).toHaveLength(2);
    expect(within(tabel).getByText(/80\.000/)).toBeVisible();
    expect(within(tabel).getByText(/50\.000/)).toBeVisible();
    expect(within(tabel).queryByText(/70\.000|99\.000/)).toBeNull();
  });

  it('menyimpan fee per sesi untuk cabang dan tipe kelas', async () => {
    const user = userEvent.setup();
    const c = client();
    render(<FeeInstruktur instructorId="anna" branches={branches} canEdit client={c} />);
    await user.click(await screen.findByRole('button', { name: 'Atur fee' }));
    const dialog = await screen.findByRole('dialog', { name: 'Atur fee per sesi' });
    await user.selectOptions(within(dialog).getByLabelText('Cabang'), 'untar');
    await user.type(within(dialog).getByLabelText(/Fee per sesi/), '50.000');
    await user.click(within(dialog).getByRole('button', { name: 'Simpan fee' }));
    expect(c.createSetting).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'INSTRUCTOR_FEE',
        branchId: 'untar',
        classTypeId: 'grp',
        instructorUserId: 'anna',
        value: 50_000,
      }),
    );
  });

  it('tanpa izin ubah, tombol Atur fee tidak ada', async () => {
    render(
      <FeeInstruktur instructorId="anna" branches={branches} canEdit={false} client={client()} />,
    );
    await screen.findByRole('table');
    expect(screen.queryByRole('button', { name: 'Atur fee' })).toBeNull();
  });
});
