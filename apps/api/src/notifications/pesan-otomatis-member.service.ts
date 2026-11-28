import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { bacaOpsional } from '../foundation/tabel-opsional';
import { WhatsAppGatewayService } from './whatsapp-gateway.service';

/**
 * Pesan WhatsApp otomatis ke member (keputusan pemilik 28 November 2026):
 * 1. akun baru terdaftar: Syarat & Ketentuan dan cara menyetujuinya;
 * 2. pembelian paket lunas: terima kasih + persetujuan Syarat & Ketentuan;
 * 3. pengingat jadwal latihan H-24 jam.
 * Dikirim dari WhatsApp Admin cabang yang ditautkan lewat QR (atau penyedia resmi bila terkonfigurasi).
 * Tanpa jalur kirim sungguhan tidak ada yang dikirim atau dicatat, jadi pesan tidak "hilang" ke MOCK.
 * Masing-masing hanya sekali per akun/pembelian/booking (dedup `reminder_log`). Matikan dengan
 * WA_OTOMATIS_MEMBER=false.
 */

export const TAUTAN_SYARAT = 'https://dailydosepilates.com/terms';
/** Hanya kejadian baru yang dikirimi pesan: saat fitur menyala, akun dan pembelian lama tidak diborong. */
const JENDELA_BARU_MS = 6 * 3_600_000;
const SEKALI_SAJA_MS = 3650 * 24 * 3_600_000;
const MAKS_PER_PUTARAN = 40;

export const JENIS_AKUN_TERDAFTAR = 'AKUN_TERDAFTAR';
export const JENIS_TERIMA_KASIH_BELI = 'PEMBELIAN_TERIMA_KASIH';
export const JENIS_PENGINGAT_KELAS = 'PENGINGAT_KELAS_H24';

export function pesanAkunTerdaftar(nama: string): string {
  return [
    `Halo Kak ${nama}`,
    '',
    'Akun Daily Dose Pilates Kakak sudah terdaftar.',
    '',
    'Mohon dibaca Syarat & Ketentuan paket di sini:',
    TAUTAN_SYARAT,
    '',
    'Dengan membalas "Saya setuju", membeli paket, atau mengikuti sesi setelah WhatsApp ini, Kakak dianggap telah menyetujui Syarat & Ketentuan tersebut 🙏',
    '',
    'Terima kasih!',
  ].join('\n');
}

export function pesanTerimaKasihBeli(p: { nama: string; paket: string; cabang: string }): string {
  return [
    `Halo Kak ${p.nama}`,
    '',
    `Terima kasih sudah membeli paket ${p.paket} di Daily Dose Pilates ${p.cabang}.`,
    '',
    'Dengan membeli paket ini dan mengikuti sesi di Daily Dose Pilates, Kakak telah menyetujui Syarat & Ketentuan berikut:',
    TAUTAN_SYARAT,
    '',
    'Terima kasih!',
  ].join('\n');
}

export function sapaanInstruktur(nama: string | null | undefined, gender: string | null | undefined): string {
  if (!nama) return '';
  const pria = gender === 'MALE' || gender === 'M';
  return `${pria ? 'Mr' : 'Miss'} ${nama.trim().split(/\s+/)[0]}`;
}

export function pesanPengingatKelas(p: {
  nama: string;
  kelas: string;
  instruktur: string;
  mulai: Date;
  zona: string;
  cabang: string;
}): string {
  const tanggal = new Intl.DateTimeFormat('id-ID', { weekday: 'long', day: 'numeric', month: 'long', timeZone: p.zona }).format(p.mulai);
  const jam = new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: p.zona })
    .format(p.mulai)
    .replace(':', '.');
  return [
    `Halo Kak ${p.nama}`,
    '',
    'Kami mengingatkan jadwal latihan Kakak besok:',
    `${p.kelas}${p.instruktur ? ` bersama ${p.instruktur}` : ''}`,
    `${tanggal}, pukul ${jam}`,
    `Daily Dose Pilates ${p.cabang}`,
    '',
    'Pembatalan atau perubahan jadwal paling lambat 12 jam sebelum kelas. Sampai jumpa di studio!',
  ].join('\n');
}

const depan = (nama: string) => nama.trim().split(/\s+/)[0] || nama;

@Injectable()
export class PesanOtomatisMemberService {
  private readonly logger = new Logger('PesanOtomatisMember');

  constructor(
    private readonly db: PrismaService,
    private readonly wa: WhatsAppGatewayService,
  ) {}

  aktif() {
    return process.env.WA_OTOMATIS_MEMBER !== 'false';
  }

  async jalankan(now = new Date()) {
    if (!this.aktif()) return { dilewati: true, akun: 0, pembelian: 0, pengingat: 0 };
    const akun = await this.akunTerdaftar(now);
    const pembelian = await this.terimaKasihBeli(now);
    const pengingat = await this.pengingatKelas(now);
    return { dilewati: false, akun, pembelian, pengingat };
  }

  /** Cek jalur kirim sekali per cabang per putaran. */
  private jalur() {
    const cache = new Map<string, Promise<boolean>>();
    return (branchId: string | null) => {
      const k = branchId ?? '';
      if (!cache.has(k)) cache.set(k, this.wa.bisaKirimNyata(branchId).catch(() => false));
      return cache.get(k)!;
    };
  }

  private async kirim(o: {
    to: string;
    text: string;
    reminderType: string;
    branchId: string | null;
    sentAt: Date;
    payload: Record<string, unknown>;
  }) {
    const hasil = await this.wa.sendMessage({
      to: o.to,
      text: o.text,
      recipientType: 'CUSTOMER',
      reminderType: o.reminderType,
      branchId: o.branchId,
      dedupWindowMs: SEKALI_SAJA_MS,
      sentAt: o.sentAt,
      payload: o.payload,
    });
    return hasil.status === 'SENT';
  }

  async akunTerdaftar(now: Date): Promise<number> {
    const bisa = this.jalur();
    const akun: Array<{ id: string; displayName: string; phone: string | null; preferredBranchId: string | null }> =
      await this.db.user.findMany({
        where: {
          role: 'CUSTOMER',
          status: 'ACTIVE',
          phone: { not: null },
          createdAt: { gte: new Date(now.getTime() - JENDELA_BARU_MS), lte: now },
        },
        select: { id: true, displayName: true, phone: true, preferredBranchId: true },
        orderBy: { createdAt: 'asc' },
        take: MAKS_PER_PUTARAN,
      });
    let terkirim = 0;
    for (const a of akun) {
      if (!(await bisa(a.preferredBranchId))) continue;
      if (
        await this.kirim({
          to: a.phone!,
          text: pesanAkunTerdaftar(depan(a.displayName)),
          reminderType: JENIS_AKUN_TERDAFTAR,
          branchId: a.preferredBranchId,
          sentAt: now,
          payload: { userId: a.id },
        })
      )
        terkirim++;
    }
    return terkirim;
  }

  async terimaKasihBeli(now: Date): Promise<number> {
    const bisa = this.jalur();
    const beli: Array<{
      id: string;
      branchId: string;
      user: { displayName: string; phone: string | null } | null;
      package: { name: string } | null;
      branch: { name: string } | null;
    }> = await this.db.pembelian.findMany({
      where: { status: 'PAID', paidAt: { gte: new Date(now.getTime() - JENDELA_BARU_MS), lte: now } },
      select: {
        id: true,
        branchId: true,
        user: { select: { displayName: true, phone: true } },
        package: { select: { name: true } },
        branch: { select: { name: true } },
      },
      orderBy: { paidAt: 'asc' },
      take: MAKS_PER_PUTARAN,
    });
    let terkirim = 0;
    for (const p of beli) {
      if (!p.user?.phone || !(await bisa(p.branchId))) continue;
      const ok = await this.kirim({
        to: p.user.phone,
        text: pesanTerimaKasihBeli({
          nama: depan(p.user.displayName),
          paket: p.package?.name ?? 'Daily Dose',
          cabang: p.branch?.name ?? '',
        }),
        // Per pembelian: member yang membeli dua paket menerima dua ucapan.
        reminderType: `${JENIS_TERIMA_KASIH_BELI}:${p.id}`,
        branchId: p.branchId,
        sentAt: now,
        payload: { purchaseId: p.id },
      });
      if (!ok) continue;
      terkirim++;
      // Kartu "Pembelian baru" di halaman Hari ini ikut tertandai terkirim.
      await bacaOpsional(
        'syarat_terkirim_wa',
        () =>
          this.db.syaratTerkirimWa.upsert({
            where: { purchaseId: p.id },
            create: { purchaseId: p.id, branchId: p.branchId, dikirimOleh: null },
            update: {},
          }),
        null,
      );
    }
    return terkirim;
  }

  /** Booking aktif yang kelasnya mulai 23-24 jam lagi (penjadwal berjalan tiap 15 menit). */
  async pengingatKelas(now: Date): Promise<number> {
    const bisa = this.jalur();
    const booking: Array<{
      id: string;
      user: { displayName: string; phone: string | null } | null;
      classSlot: {
        startAt: Date;
        status: string;
        branchId: string;
        branch: { name: string; timezone: string } | null;
        classType: { name: string } | null;
        instructor: { displayName: string; profile: { gender: string | null } | null } | null;
      };
    }> = await this.db.pemesananKelas.findMany({
      where: {
        status: 'BOOKED',
        classSlot: {
          status: { in: ['PUBLISHED', 'CONFIRMED'] },
          startAt: { gt: new Date(now.getTime() + 23 * 3_600_000), lte: new Date(now.getTime() + 24 * 3_600_000) },
        },
      },
      select: {
        id: true,
        user: { select: { displayName: true, phone: true } },
        classSlot: {
          select: {
            startAt: true,
            status: true,
            branchId: true,
            branch: { select: { name: true, timezone: true } },
            classType: { select: { name: true } },
            instructor: { select: { displayName: true, profile: { select: { gender: true } } } },
          },
        },
      },
      orderBy: { classSlot: { startAt: 'asc' } },
      take: MAKS_PER_PUTARAN * 5,
    });
    let terkirim = 0;
    for (const b of booking) {
      const slot = b.classSlot;
      if (!b.user?.phone || !(await bisa(slot.branchId))) continue;
      if (
        await this.kirim({
          to: b.user.phone,
          text: pesanPengingatKelas({
            nama: depan(b.user.displayName),
            kelas: slot.classType?.name ?? 'Kelas',
            instruktur: sapaanInstruktur(slot.instructor?.displayName, slot.instructor?.profile?.gender),
            mulai: slot.startAt,
            zona: slot.branch?.timezone ?? 'Asia/Jakarta',
            cabang: slot.branch?.name ?? '',
          }),
          reminderType: `${JENIS_PENGINGAT_KELAS}:${b.id}`,
          branchId: slot.branchId,
          sentAt: now,
          payload: { bookingId: b.id },
        })
      )
        terkirim++;
    }
    if (terkirim) this.logger.log(`Pengingat kelas H-24 terkirim: ${terkirim}`);
    return terkirim;
  }
}
