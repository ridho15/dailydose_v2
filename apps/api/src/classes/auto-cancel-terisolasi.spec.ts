import { AutoCancelService } from './auto-cancel.service';

describe('evaluasi kuota otomatis', () => {
  const env = process.env.ENABLE_AUTO_CANCEL;
  beforeAll(() => (process.env.ENABLE_AUTO_CANCEL = 'true'));
  afterAll(() => (process.env.ENABLE_AUTO_CANCEL = env));

  it('satu kelas yang gagal tidak menghentikan konfirmasi kelas lain (mis. cabang MK)', async () => {
    const now = new Date('2026-11-10T00:00:00Z');
    const slot = (id: string, branchId: string) => ({
      id,
      branchId,
      classTypeId: 'ct',
      status: 'PUBLISHED',
      startAt: new Date(now.getTime() + 3 * 3_600_000),
      branch: { name: branchId, timezone: 'Asia/Jakarta' },
      classType: { name: 'Group' },
      instructor: null,
      bookings: [{ id: `b-${id}`, user: null, customerPackageId: null }],
    });
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const db = {
      slotKelas: { findMany: jest.fn().mockResolvedValue([slot('rusak', 'GG'), slot('mk-1', 'MK')]), updateMany },
      minQuotaSetting: {
        findUnique: jest.fn(async ({ where }: any) => {
          if (where.branchId_classTypeId.branchId === 'GG') throw new Error('koneksi putus');
          return null;
        }),
      },
    };
    const hasil = await new AutoCancelService(db as never, { sendMessage: jest.fn() } as never).evaluateClasses(now);
    expect(hasil).toMatchObject({ confirmedSlotsCount: 1, failedSlotsCount: 1 });
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'mk-1', status: 'PUBLISHED' } }));
  });
});
