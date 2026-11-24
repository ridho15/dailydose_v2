import { BATAS_TUNGGU_PEMBATALAN_JAM, ReminderScheduleService } from './reminder-schedule.service';

const now = new Date('2026-11-24T03:00:00Z');
const hariLalu = (n: number) => new Date(now.getTime() - n * 86_400_000);
const pengajuan = (nama: string, cabang: string, dibuat: Date) => ({
  createdAt: dibuat,
  customerPackage: { user: { displayName: nama } },
  booking: { classSlot: { branchId: cabang, startAt: hariLalu(1) } },
});

function setup(menunggu: unknown[]) {
  const db: any = {
    sessionAdjustRequest: { findMany: jest.fn(async () => menunggu) },
    user: {
      findMany: jest.fn(async () => [
        { id: 'm-untar', role: 'MANAGER', phone: '0811', preferredBranchId: 'untar' },
        { id: 'm-gg', role: 'MANAGER', phone: '0812', preferredBranchId: 'gg' },
        { id: 'o-1', role: 'OWNER', phone: '0813', preferredBranchId: null },
      ]),
    },
  };
  const whatsapp = { sendMessage: jest.fn(async () => ({ status: 'SENT' })) };
  const service = new ReminderScheduleService(db, whatsapp as never, {} as never);
  return { service, db, whatsapp };
}

describe('Pengingat pengajuan batal < 12 jam', () => {
  it('hanya pengajuan yang menunggu lebih dari 24 jam; Manager cabangnya saja, Owner semua; sekali sehari', async () => {
    const { service, db, whatsapp } = setup([pengajuan('Sari', 'untar', hariLalu(23))]);
    expect(await service.runPengingatPembatalan(now)).toBe(2);
    const where = db.sessionAdjustRequest.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ status: 'PENDING', reasonCode: 'LATE_CANCELLATION' });
    expect(where.createdAt.lte).toEqual(new Date(now.getTime() - BATAS_TUNGGU_PEMBATALAN_JAM * 3_600_000));
    const penerima = whatsapp.sendMessage.mock.calls.map((c: any[]) => c[0].to);
    expect(penerima).toEqual(['0811', '0813']);
    const pesan = (whatsapp.sendMessage.mock.calls[0] as any[])[0];
    expect(pesan.text).toContain('Sari, menunggu 23 hari');
    expect(pesan.dedupWindowMs).toBeGreaterThanOrEqual(20 * 3_600_000);
  });

  it('tidak ada yang menunggu: tidak ada pesan', async () => {
    const { service, whatsapp } = setup([]);
    expect(await service.runPengingatPembatalan(now)).toBe(0);
    expect(whatsapp.sendMessage).not.toHaveBeenCalled();
  });
});
