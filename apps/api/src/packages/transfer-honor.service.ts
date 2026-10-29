import { HttpStatus, Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import type { SessionPrincipal } from '../identity/identity.service';
import { PolicyService } from '../identity/policy.service';
import { ApiProblem } from '../identity/security';
import { financeRange, type FinanceRange } from './finance-range';
import { calculateSlotFee, sortFeesNewestFirst } from './instructor-fee-calculator';
import { AKSI_KOREKSI_JAM, detailKoreksi } from './koreksi-jam.service';
import { buatXlsx, type Sel } from './xlsx-sederhana';

/**
 * Transfer honor instruktur lewat KlikBCA Bisnis (Multi Payroll).
 *
 * Honor yang dibayar sama dengan halaman Payroll instruktur: kelas selesai yang presensinya
 * terverifikasi ditambah koreksi jam. Kelas selesai tanpa presensi tidak ikut dibayar dan
 * ditampilkan supaya diverifikasi dulu.
 *
 * Berkasnya mengikuti "Template MAT Multi Payroll" dari BCA; berkas itu lalu diolah dengan
 * Converter Multi Transaksi dan Aplikasi Checksum sebelum diunggah.
 */
export const CAP_TRANSFER_HONOR = 'finance:export';
export const SWIFT_BCA = 'CENAIDJA';
const AKSI_EKSPOR = 'finance.instructor_transfer_exported';
const AKSI_REKENING = 'finance.instructor_account_updated';
const ZONA = 'Asia/Jakarta';
const BULAN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

/** Kolom persis seperti "Template MAT Multi Payroll .xlsx" (lembar Data). */
export const KOLOM_MULTI_PAYROLL = [
  'No',
  'Transaction ID',
  'Transfer Type ',
  'Beneficiary ID',
  'Credited Account',
  'Receiver Name',
  'Amount',
  'NIP',
  'Remark',
  'Beneficiary email address',
  'Receiver Swift Code',
  'Receiver Cust Type',
  'Receiver Cust Residence',
];

export interface RekeningInstruktur {
  bankName: string;
  swiftCode: string;
  accountNumber: string;
  accountName: string;
  email: string | null;
}

export interface BarisTransfer {
  instructorId: string;
  nama: string;
  /** Yang ditransfer: honor kelas terverifikasi + koreksi jam. */
  totalRp: number;
  terverifikasiRp: number;
  koreksiRp: number;
  kelasTerverifikasi: number;
  /** Kelas selesai tanpa presensi instruktur; tidak ikut ditransfer. */
  belumTerverifikasiRp: number;
  kelasBelumTerverifikasi: number;
  rekening: RekeningInstruktur | null;
}

export interface RingkasanTransfer {
  from: string;
  until: string;
  baris: BarisTransfer[];
  /** Jumlah yang masuk berkas: honor > 0 dan rekening sudah diisi. */
  siapRp: number;
  jumlahSiap: number;
  /** Instruktur berhonor yang belum punya rekening; tidak masuk berkas. */
  tanpaRekening: number;
  kelasBelumTerverifikasi: number;
}

const hariJakarta = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: ZONA }).format(d);

/**
 * Periode bawaan: tanggal 1 bulan ini sampai hari ini. Pada tanggal 1, bulan lalu penuh,
 * karena hari itu yang dibayar adalah honor bulan sebelumnya.
 */
export function periodeTransfer(now: Date): { from: string; until: string } {
  const hari = hariJakarta(now);
  const [y, m, d] = hari.split('-').map(Number) as [number, number, number];
  if (d !== 1) return { from: `${hari.slice(0, 7)}-01`, until: hari };
  const akhirLalu = new Date(Date.UTC(y, m - 1, 0));
  const iso = akhirLalu.toISOString().slice(0, 10);
  return { from: `${iso.slice(0, 7)}-01`, until: iso };
}

/** Keterangan di mutasi penerima, paling banyak 18 karakter: "Honor 1-29 Okt 26". */
export function remarkTransfer(from: string, until: string): string {
  const [y1, m1, d1] = from.split('-').map(Number) as [number, number, number];
  const [y2, m2, d2] = until.split('-').map(Number) as [number, number, number];
  if (y1 === y2 && m1 === m2) return `Honor ${d1}-${d2} ${BULAN[m1 - 1]} ${String(y1).slice(2)}`;
  const dm = (d: number, m: number) => `${String(d).padStart(2, '0')}${String(m).padStart(2, '0')}`;
  return `Honor ${dm(d1, m1)}-${dm(d2, m2)}${String(y2).slice(2)}`;
}

function tidakValid(field: string, issue: string) {
  return new ApiProblem('VALIDATION_ERROR', HttpStatus.UNPROCESSABLE_ENTITY, false, [
    { field, issue },
  ]);
}

const samarkan = (no: string) => `****${no.slice(-4)}`;

@Injectable()
export class TransferHonorService {
  constructor(
    private readonly db: PrismaService,
    private readonly policy: PolicyService,
  ) {}

  private rentang(input: { from?: string; until?: string }, now: Date): FinanceRange {
    if (input.from || input.until) return financeRange({ from: input.from, until: input.until });
    return financeRange(periodeTransfer(now));
  }

  async ringkasan(
    principal: SessionPrincipal,
    input: { from?: string; until?: string } = {},
    now = new Date(),
  ): Promise<RingkasanTransfer> {
    this.policy.requireCapability(principal.capabilities, CAP_TRANSFER_HONOR);
    const range = this.rentang(input, now);

    const [slots, fees, koreksiAudit, instruktur, rekening] = await Promise.all([
      this.db.slotKelas.findMany({
        where: {
          status: 'COMPLETED',
          instructorId: { not: null },
          startAt: { gte: range.fromDate, lt: range.untilExclusive },
        },
        select: {
          instructorId: true,
          branchId: true,
          classTypeId: true,
          startAt: true,
          endAt: true,
          instructorFeeRp: true,
          isManualFee: true,
          instructorAttendance: { select: { id: true } },
        },
      }),
      this.db.instructorFee.findMany(),
      // Koreksi dibuat setelah kelasnya berlangsung, jadi tidak mungkin lebih awal dari rentang.
      this.db.auditLog.findMany({
        where: { action: AKSI_KOREKSI_JAM, createdAt: { gte: range.fromDate } },
        select: { detail: true, targetUserId: true },
      }),
      this.db.user.findMany({
        where: { role: 'INSTRUCTOR', status: 'ACTIVE' },
        select: { id: true, displayName: true },
      }),
      this.db.rekeningInstruktur.findMany(),
    ]);

    const tarif = sortFeesNewestFirst(fees);
    const per = new Map<string, Omit<BarisTransfer, 'nama' | 'rekening' | 'totalRp'>>();
    const ambil = (instructorId: string) => {
      let b = per.get(instructorId);
      if (!b) {
        b = {
          instructorId,
          terverifikasiRp: 0,
          koreksiRp: 0,
          kelasTerverifikasi: 0,
          belumTerverifikasiRp: 0,
          kelasBelumTerverifikasi: 0,
        };
        per.set(instructorId, b);
      }
      return b;
    };

    for (const s of slots) {
      if (!s.instructorId) continue;
      const { feeRp } = calculateSlotFee(tarif, { ...s, instructorId: s.instructorId });
      const b = ambil(s.instructorId);
      if (s.instructorAttendance) {
        b.terverifikasiRp += feeRp;
        b.kelasTerverifikasi += 1;
      } else {
        b.belumTerverifikasiRp += feeRp;
        b.kelasBelumTerverifikasi += 1;
      }
    }
    for (const k of koreksiAudit) {
      const d = detailKoreksi(k.detail);
      const instructorId = d?.instructorId ?? k.targetUserId;
      if (!d || !instructorId) continue;
      const mulai = new Date(d.classStartAt);
      if (mulai < range.fromDate || mulai >= range.untilExclusive) continue;
      ambil(instructorId).koreksiRp += d.amountRp;
    }

    // Instruktur aktif tetap tampil walau belum berhonor, supaya rekeningnya bisa diisi lebih dulu.
    for (const i of instruktur) ambil(i.id);
    const nama = new Map(instruktur.map((i) => [i.id, i.displayName]));
    const kurang = [...per.keys()].filter((id) => !nama.has(id));
    if (kurang.length) {
      const lain = await this.db.user.findMany({
        where: { id: { in: kurang } },
        select: { id: true, displayName: true },
      });
      for (const u of lain) nama.set(u.id, u.displayName);
    }
    const rek = new Map(rekening.map((r) => [r.instructorId, r]));

    const baris: BarisTransfer[] = [...per.values()]
      .map((b) => {
        const r = rek.get(b.instructorId);
        return {
          ...b,
          nama: nama.get(b.instructorId) ?? 'Instruktur',
          totalRp: b.terverifikasiRp + b.koreksiRp,
          rekening: r
            ? {
                bankName: r.bankName,
                swiftCode: r.swiftCode,
                accountNumber: r.accountNumber,
                accountName: r.accountName,
                email: r.email,
              }
            : null,
        };
      })
      .sort((a, b) => b.totalRp - a.totalRp || a.nama.localeCompare(b.nama, 'id'));

    const siap = baris.filter((b) => b.totalRp > 0 && b.rekening);
    return {
      from: range.from,
      until: range.until,
      baris,
      siapRp: siap.reduce((s, b) => s + b.totalRp, 0),
      jumlahSiap: siap.length,
      tanpaRekening: baris.filter((b) => b.totalRp > 0 && !b.rekening).length,
      kelasBelumTerverifikasi: baris.reduce((s, b) => s + b.kelasBelumTerverifikasi, 0),
    };
  }

  async simpanRekening(
    principal: SessionPrincipal,
    instructorId: string,
    input: Partial<Record<keyof RekeningInstruktur, unknown>>,
  ): Promise<RekeningInstruktur> {
    this.policy.requireCapability(principal.capabilities, CAP_TRANSFER_HONOR);
    const teks = (v: unknown) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : '');
    const bankName = teks(input.bankName);
    const swiftCode = teks(input.swiftCode).toUpperCase();
    const accountNumber = teks(input.accountNumber).replace(/[\s.-]/g, '');
    const accountName = teks(input.accountName);
    const email = teks(input.email).replace(/\s/g, '') || null;

    if (!bankName || bankName.length > 64) throw tidakValid('bankName', 'REQUIRED');
    if (!/^[A-Z0-9]{8}([A-Z0-9]{3})?$/.test(swiftCode)) throw tidakValid('swiftCode', 'INVALID');
    if (!/^\d{5,34}$/.test(accountNumber)) throw tidakValid('accountNumber', 'INVALID');
    if (swiftCode === SWIFT_BCA && accountNumber.length !== 10)
      throw tidakValid('accountNumber', 'BCA_10_DIGIT');
    if (accountName.length < 2 || accountName.length > 70)
      throw tidakValid('accountName', 'INVALID');
    if (
      email &&
      (email.length > 191 || !email.split(',').every((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)))
    )
      throw tidakValid('email', 'INVALID');

    const user = await this.db.user.findUnique({
      where: { id: instructorId },
      select: { id: true },
    });
    if (!user) throw new ApiProblem('NOT_FOUND', HttpStatus.NOT_FOUND);

    const data = { bankName, swiftCode, accountNumber, accountName, email };
    const lama = await this.db.rekeningInstruktur.findUnique({ where: { instructorId } });
    await this.db.$transaction(async (tx) => {
      await tx.rekeningInstruktur.upsert({
        where: { instructorId },
        create: { instructorId, ...data, updatedById: principal.userId },
        update: { ...data, updatedById: principal.userId },
      });
      await tx.auditLog.create({
        data: {
          action: AKSI_REKENING,
          actorId: principal.userId,
          targetUserId: instructorId,
          objectType: 'RekeningInstruktur',
          objectId: instructorId,
          detail: {
            before: lama
              ? { bankName: lama.bankName, accountNumber: samarkan(lama.accountNumber) }
              : null,
            after: { bankName, accountNumber: samarkan(accountNumber) },
          },
        },
      });
    });
    return data;
  }

  /** Berkas .xlsx format Multi Payroll, berisi instruktur berhonor yang rekeningnya lengkap. */
  async unduh(
    principal: SessionPrincipal,
    input: { from?: string; until?: string } = {},
    now = new Date(),
  ): Promise<{ fileName: string; base64: string; jumlahBaris: number; totalRp: number }> {
    const r = await this.ringkasan(principal, input, now);
    const siap = r.baris.filter((b) => b.totalRp > 0 && b.rekening);
    if (!siap.length) throw new ApiProblem('NOTHING_TO_TRANSFER', HttpStatus.UNPROCESSABLE_ENTITY);

    // ID unik 3 bulan (maks 18): HN + waktu Jakarta (yyMMddHHmmss) + nomor urut.
    const cap = new Intl.DateTimeFormat('en-GB', {
      timeZone: ZONA,
      year: '2-digit',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(now)
      .reduce<Record<string, string>>((a, p) => ({ ...a, [p.type]: p.value }), {});
    const stempel = `${cap.year}${cap.month}${cap.day}${cap.hour}${cap.minute}${cap.second}`;
    const remark = remarkTransfer(r.from, r.until);

    const data: Sel[][] = [KOLOM_MULTI_PAYROLL];
    siap.forEach((b, i) => {
      const rek = b.rekening!;
      const bca = rek.swiftCode === SWIFT_BCA;
      data.push([
        i + 1,
        `HN${stempel}${String(i + 1).padStart(3, '0')}`,
        bca ? 'BCA' : 'LLG',
        null,
        rek.accountNumber,
        rek.accountName.slice(0, 70),
        { angka: b.totalRp, format: 'desimal2' },
        null,
        remark,
        rek.email,
        bca ? null : rek.swiftCode,
        // Perorangan, penduduk; hanya dibaca untuk LLG/RTGS.
        bca ? null : '1',
        bca ? null : '1',
      ]);
    });

    const rincian: Sel[][] = [
      [`Honor instruktur ${r.from} s/d ${r.until}`],
      [],
      [
        'Instruktur',
        'Bank',
        'Rekening',
        'Atas nama',
        'Honor kelas',
        'Koreksi jam',
        'Ditransfer',
        'Kelas belum terverifikasi (tidak dibayar)',
      ],
      ...siap.map((b): Sel[] => [
        b.nama,
        b.rekening!.bankName,
        b.rekening!.accountNumber,
        b.rekening!.accountName,
        b.terverifikasiRp,
        b.koreksiRp,
        b.totalRp,
        b.kelasBelumTerverifikasi || null,
      ]),
      ['Total', null, null, null, null, null, r.siapRp],
    ];
    const lewat = r.baris.filter((b) => b.totalRp > 0 && !b.rekening);
    if (lewat.length) {
      rincian.push([], ['Belum ada rekening, tidak masuk berkas:']);
      for (const b of lewat) rincian.push([b.nama, null, null, null, null, null, b.totalRp]);
    }

    const berkas = buatXlsx([
      { nama: 'Data', baris: data, lebar: [5, 20, 13, 14, 18, 30, 15, 8, 20, 28, 18, 17, 22] },
      { nama: 'Rincian', baris: rincian, lebar: [28, 18, 18, 28, 14, 13, 14, 20] },
    ]);

    await this.db.auditLog.create({
      data: {
        action: AKSI_EKSPOR,
        actorId: principal.userId,
        objectType: 'TransferHonor',
        objectId: `${r.from}..${r.until}`,
        detail: { jumlahBaris: siap.length, totalRp: r.siapRp, idAwal: `HN${stempel}001` },
      },
    });

    return {
      fileName: `honor-instruktur-${r.from}-sd-${r.until}.xlsx`,
      base64: berkas.toString('base64'),
      jumlahBaris: siap.length,
      totalRp: r.siapRp,
    };
  }
}
