import * as tabelOpsional from '../foundation/tabel-opsional';
import {
  JENIS_AKUN_TERDAFTAR,
  JENIS_PENGINGAT_KELAS,
  JENIS_TERIMA_KASIH_BELI,
  PesanOtomatisMemberService,
  pesanAkunTerdaftar,
  pesanPengingatKelas,
  pesanTerimaKasihBeli,
  sapaanInstruktur,
} from './pesan-otomatis-member.service';

const NOW = new Date('2026-12-01T03:00:00Z'); // 10.00 WIB

describe('teks pesan otomatis', () => {
  it('akun terdaftar: S&K dan cara menyetujui (balas, membeli paket, atau mengikuti sesi)', () => {
    const t = pesanAkunTerdaftar('Sinta');
    expect(t).toContain('Halo Kak Sinta');
    expect(t).toContain('Akun Daily Dose Pilates Kakak sudah terdaftar.');
    expect(t).toContain('https://dailydosepilates.com/terms');
    expect(t).toContain('Dengan membalas "Saya setuju", membeli paket, atau mengikuti sesi');
  });
  it('terima kasih pembelian menyebut paket dan cabang', () => {
    const t = pesanTerimaKasihBeli({ nama: 'Sinta', paket: 'Group 10x', cabang: 'Green Garden' });
    expect(t).toContain('Terima kasih sudah membeli paket Group 10x di Daily Dose Pilates Green Garden.');
    expect(t).toContain('Dengan membeli paket ini dan mengikuti sesi di Daily Dose Pilates, Kakak telah menyetujui Syarat & Ketentuan');
  });
  it('pengingat kelas: kelas, instruktur, hari, jam lokal cabang', () => {
    const t = pesanPengingatKelas({
      nama: 'Sinta',
      kelas: 'Reformer Group',
      instruktur: sapaanInstruktur('Anita Putri', 'FEMALE'),
      mulai: new Date('2026-12-02T01:00:00Z'),
      zona: 'Asia/Jakarta',
      cabang: 'Green Garden',
    });
    expect(t).toContain('Reformer Group bersama Miss Anita');
    expect(t).toContain('Rabu, 2 Desember, pukul 08.00');
    expect(t).toContain('Daily Dose Pilates Green Garden');
    expect(sapaanInstruktur('Budi', 'MALE')).toBe('Mr Budi');
  });
});

function setup(o: { bisa?: boolean } = {}) {
  const wa = {
    bisaKirimNyata: jest.fn(async () => o.bisa ?? true),
    sendMessage: jest.fn(async (_o: any) => ({ status: 'SENT' })),
  };
  const db: any = {
    user: { findMany: jest.fn(async () => [{ id: 'u1', displayName: 'Sinta Dewi', phone: '0812', preferredBranchId: 'gg' }]) },
    pembelian: {
      findMany: jest.fn(async () => [
        { id: 'p1', branchId: 'gg', user: { displayName: 'Sinta Dewi', phone: '0812' }, package: { name: 'Group 10x' }, branch: { name: 'Green Garden' } },
      ]),
    },
    pemesananKelas: {
      findMany: jest.fn(async () => [
        {
          id: 'b1',
          user: { displayName: 'Sinta Dewi', phone: '0812' },
          classSlot: {
            startAt: new Date(NOW.getTime() + 23.5 * 3_600_000),
            status: 'PUBLISHED',
            branchId: 'gg',
            branch: { name: 'Green Garden', timezone: 'Asia/Jakarta' },
            classType: { name: 'Reformer Group' },
            instructor: { displayName: 'Anita', profile: null },
          },
        },
      ]),
    },
    syaratTerkirimWa: { upsert: jest.fn(async () => ({})) },
  };
  return { service: new PesanOtomatisMemberService(db, wa as never), db, wa };
}

describe('PesanOtomatisMemberService', () => {
  afterEach(() => delete process.env.WA_OTOMATIS_MEMBER);

  it('mengirim tiga jenis pesan sekali per akun/pembelian/booking lewat cabangnya, dan menandai kartu Pembelian baru', async () => {
    const { service, db, wa } = setup();
    const spy = jest.spyOn(tabelOpsional, 'tabelOpsionalAda').mockResolvedValue(true);
    expect(await service.jalankan(NOW)).toEqual({ dilewati: false, akun: 1, pembelian: 1, pengingat: 1 });
    const jenis = wa.sendMessage.mock.calls.map((c: any[]) => [c[0].reminderType, c[0].branchId, c[0].dedupWindowMs > 3e11]);
    expect(jenis).toEqual([
      [JENIS_AKUN_TERDAFTAR, 'gg', true],
      [`${JENIS_TERIMA_KASIH_BELI}:p1`, 'gg', true],
      [`${JENIS_PENGINGAT_KELAS}:b1`, 'gg', true],
    ]);
    expect(wa.sendMessage.mock.calls[0]![0].text).toContain('Halo Kak Sinta');
    expect(db.syaratTerkirimWa.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { purchaseId: 'p1' } }));
    // Hanya kejadian baru: akun dan pembelian 6 jam terakhir, kelas 23-24 jam lagi.
    expect(db.user.findMany.mock.calls[0][0].where.createdAt.gte).toEqual(new Date(NOW.getTime() - 6 * 3_600_000));
    expect(db.pemesananKelas.findMany.mock.calls[0][0].where.classSlot.startAt).toEqual({
      gt: new Date(NOW.getTime() + 23 * 3_600_000),
      lte: new Date(NOW.getTime() + 24 * 3_600_000),
    });
    spy.mockRestore();
  });

  it('tanpa WhatsApp admin tersambung atau penyedia resmi: tidak ada yang dikirim atau dicatat', async () => {
    const { service, wa } = setup({ bisa: false });
    expect(await service.jalankan(NOW)).toEqual({ dilewati: false, akun: 0, pembelian: 0, pengingat: 0 });
    expect(wa.sendMessage).not.toHaveBeenCalled();
  });

  it('WA_OTOMATIS_MEMBER=false mematikan semuanya', async () => {
    process.env.WA_OTOMATIS_MEMBER = 'false';
    const { service, wa } = setup();
    expect((await service.jalankan(NOW)).dilewati).toBe(true);
    expect(wa.sendMessage).not.toHaveBeenCalled();
  });
});
