import { alasanPaketDitolak } from './kelayakan-paket';

const MK = 'mk';
const slot = { startAt: new Date('2026-12-10T03:00:00Z'), branchId: MK, classTypeId: 'reformer' };
const paket = (override: Record<string, unknown> = {}) => ({
  status: 'ACTIVE',
  validUntil: new Date('2026-12-31T00:00:00Z'),
  purchaseId: 'p1',
  purchase: { status: 'PAID' },
  package: { classTypeId: null, branchId: MK, isMultiBranch: false },
  ...override,
});

describe('alasanPaketDitolak', () => {
  it.each([
    ['paket sehat', paket(), null],
    ['pembelian masih PENDING', paket({ purchase: { status: 'PENDING' } }), 'PURCHASE_NOT_PAID'],
    ['pembelian menunggu verifikasi', paket({ purchase: { status: 'WAITING_VERIFICATION' } }), 'PURCHASE_NOT_PAID'],
    ['pembelian ditolak', paket({ purchase: { status: 'REJECTED' } }), 'PURCHASE_NOT_PAID'],
    ['paket beku', paket({ status: 'FROZEN' }), 'PACKAGE_NOT_ACTIVE'],
    ['paket habis sebelum kelas mulai', paket({ validUntil: new Date('2026-12-09T00:00:00Z') }), 'PACKAGE_EXPIRED_FOR_SLOT'],
    ['paket habis tepat saat kelas mulai', paket({ validUntil: slot.startAt }), 'PACKAGE_EXPIRED_FOR_SLOT'],
    ['cabang lain', paket({ package: { branchId: 'sby' }, purchase: { status: 'PAID', branchId: 'sby' } }), 'PACKAGE_BRANCH_MISMATCH'],
    ['paket multi-cabang', paket({ package: { branchId: 'sby', isMultiBranch: true } }), null],
    ['tipe kelas lain', paket({ package: { classTypeId: 'mat', branchId: MK } }), 'PACKAGE_CLASS_TYPE_MISMATCH'],
    ['paket V1 tanpa pembelian', paket({ purchaseId: null, purchase: null }), null],
  ])('%s', (_nama, cp, hasil) => {
    expect(alasanPaketDitolak(cp as any, slot)).toBe(hasil);
  });
});
