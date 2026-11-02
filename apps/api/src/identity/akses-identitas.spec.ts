import { bolehAksesIdentitas } from './customer-visibility';

const staf = (branchIds: string[], all = false) =>
  ({ userId: 's', roles: [], branchIds, capabilities: all ? ['branch:all'] : [] }) as never;

function db(user: { role: string; preferredBranchId: string | null }, opts: { booking?: boolean; tugas?: boolean } = {}) {
  return {
    user: {
      findUnique: async () => ({ id: 'u', ...user }),
      findMany: async () => [{ id: 'u', preferredBranchId: user.preferredBranchId, _count: { bookings: 1, purchases: 0 } }],
    },
    pemesananKelas: { findMany: async () => (opts.booking ? [{ userId: 'u' }] : []) },
    pembelian: { findMany: async () => [] },
    penugasanInstruktur: { findFirst: async () => (opts.tugas ? { id: 't' } : null) },
  } as never;
}

describe('akses dokumen identitas per cabang', () => {
  it('staf lintas cabang boleh semua', async () => {
    await expect(bolehAksesIdentitas(db({ role: 'CUSTOMER', preferredBranchId: 'B' }), staf([], true), 'u')).resolves.toBe(true);
  });
  it('pelanggan cabang lain tanpa riwayat di cabang staf ditolak', async () => {
    await expect(bolehAksesIdentitas(db({ role: 'CUSTOMER', preferredBranchId: 'B' }), staf(['A']), 'u')).resolves.toBe(false);
  });
  it('pelanggan cabang lain yang booking di cabang staf diizinkan (meja check-in)', async () => {
    await expect(
      bolehAksesIdentitas(db({ role: 'CUSTOMER', preferredBranchId: 'B' }, { booking: true }), staf(['A']), 'u'),
    ).resolves.toBe(true);
  });
  it('instruktur hanya bila ditugaskan di cabang staf', async () => {
    await expect(bolehAksesIdentitas(db({ role: 'INSTRUCTOR', preferredBranchId: 'B' }), staf(['A']), 'u')).resolves.toBe(false);
    await expect(
      bolehAksesIdentitas(db({ role: 'INSTRUCTOR', preferredBranchId: 'B' }, { tugas: true }), staf(['A']), 'u'),
    ).resolves.toBe(true);
  });
});
