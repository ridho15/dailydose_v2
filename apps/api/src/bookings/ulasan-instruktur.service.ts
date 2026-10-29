import { HttpStatus, Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import type { SessionPrincipal } from '../identity/identity.service';
import { PolicyService } from '../identity/policy.service';
import { ApiProblem } from '../identity/security';

/**
 * Ulasan member untuk instruktur kelas yang ia hadiri.
 *
 * Member ditanya setelah kelas selesai (beranda member) dan sebelum booking kelas berikutnya. Satu
 * ulasan per booking yang berstatus hadir; member boleh melewatinya, dan kelas yang dilewati tidak
 * ditanyakan lagi. Hasilnya internal: dibaca Owner, Manager, dan Super Owner per instruktur, tidak
 * pernah tampil di situs publik.
 */

export const CAP_BACA_ULASAN = 'instructor-review:read';
/** Kelas yang lebih lama dari ini tidak ditanyakan lagi; ingatan member sudah kabur. */
const JENDELA_HARI = 14;
const MAKS_KOMENTAR = 1000;

export interface UlasanTertunda {
  bookingId: string;
  classSlotId: string;
  namaKelas: string;
  namaInstruktur: string;
  namaCabang: string;
  mulai: string;
  timezone: string;
}

export interface KirimUlasan {
  bookingId?: unknown;
  rating?: unknown;
  comment?: unknown;
  /** true: member melewati ulasan kelas ini. */
  skip?: unknown;
}

export interface RingkasanInstruktur {
  instructorId: string;
  namaInstruktur: string;
  jumlahUlasan: number;
  rataRata: number;
  /** Jumlah ulasan per bintang, indeks 0 = bintang 1. */
  sebaran: [number, number, number, number, number];
}

export interface BarisUlasan {
  id: string;
  rating: number;
  comment: string | null;
  createdAt: string;
  namaMember: string;
  instructorId: string;
  namaInstruktur: string;
  namaKelas: string;
  namaCabang: string;
  kelasMulai: string;
}

export interface LaporanUlasan {
  from: string;
  until: string;
  instruktur: RingkasanInstruktur[];
  ulasan: BarisUlasan[];
}

const invalid = (field: string, issue: string) =>
  new ApiProblem('VALIDATION_FAILED', HttpStatus.UNPROCESSABLE_ENTITY, false, [{ field, issue }]);

@Injectable()
export class UlasanInstrukturService {
  constructor(
    private readonly db: PrismaService,
    private readonly policy: PolicyService,
  ) {}

  /** Kelas yang sudah dihadiri member dalam 14 hari terakhir dan belum diulas atau dilewati. */
  async tertunda(principal: SessionPrincipal, now = new Date()): Promise<UlasanTertunda[]> {
    this.policy.requireCapability(principal.capabilities, 'customer:self');
    const sejak = new Date(now.getTime() - JENDELA_HARI * 86_400_000);
    const bookings = await this.db.pemesananKelas.findMany({
      where: {
        userId: principal.userId,
        status: 'ATTENDED',
        classSlot: { endAt: { gte: sejak, lte: now }, instructorId: { not: null } },
      },
      select: {
        id: true,
        classSlot: {
          select: {
            id: true,
            startAt: true,
            classType: { select: { name: true } },
            instructor: { select: { displayName: true } },
            branch: { select: { name: true, timezone: true } },
          },
        },
      },
      orderBy: { classSlot: { startAt: 'desc' } },
      take: 20,
    });
    if (bookings.length === 0) return [];
    const sudah = await this.db.ulasanInstruktur.findMany({
      where: { bookingId: { in: bookings.map((b) => b.id) } },
      select: { bookingId: true },
    });
    const selesai = new Set(sudah.map((u) => u.bookingId));
    return bookings
      .filter((b) => !selesai.has(b.id))
      .map((b) => ({
        bookingId: b.id,
        classSlotId: b.classSlot.id,
        namaKelas: b.classSlot.classType?.name ?? 'Kelas',
        namaInstruktur: b.classSlot.instructor?.displayName ?? 'Instruktur',
        namaCabang: b.classSlot.branch?.name ?? '',
        mulai: b.classSlot.startAt.toISOString(),
        timezone: b.classSlot.branch?.timezone ?? 'Asia/Jakarta',
      }));
  }

  async kirim(principal: SessionPrincipal, input: KirimUlasan, now = new Date()) {
    this.policy.requireCapability(principal.capabilities, 'customer:self');
    if (typeof input.bookingId !== 'string' || !input.bookingId)
      throw invalid('bookingId', 'REQUIRED');
    const lewati = input.skip === true;
    let rating: number | null = null;
    let comment: string | null = null;
    if (!lewati) {
      if (typeof input.rating !== 'number' || !Number.isInteger(input.rating))
        throw invalid('rating', 'REQUIRED');
      if (input.rating < 1 || input.rating > 5) throw invalid('rating', 'OUT_OF_RANGE');
      rating = input.rating;
      if (input.comment !== undefined && input.comment !== null) {
        if (typeof input.comment !== 'string') throw invalid('comment', 'INVALID');
        const bersih = input.comment.trim();
        if (bersih.length > MAKS_KOMENTAR) throw invalid('comment', 'TOO_LONG');
        comment = bersih || null;
      }
    }

    const booking = await this.db.pemesananKelas.findFirst({
      where: { id: input.bookingId, userId: principal.userId },
      select: {
        id: true,
        status: true,
        classSlot: { select: { id: true, endAt: true, instructorId: true, branchId: true } },
      },
    });
    // Booking milik orang lain diperlakukan sama dengan yang tidak ada.
    if (!booking) throw new ApiProblem('BOOKING_NOT_FOUND', HttpStatus.NOT_FOUND);
    if (
      booking.status !== 'ATTENDED' ||
      !booking.classSlot.instructorId ||
      booking.classSlot.endAt.getTime() > now.getTime()
    )
      throw new ApiProblem('REVIEW_NOT_AVAILABLE', HttpStatus.CONFLICT);

    const sudah = await this.db.ulasanInstruktur.findUnique({
      where: { bookingId: booking.id },
      select: { id: true },
    });
    if (sudah) throw new ApiProblem('REVIEW_ALREADY_SUBMITTED', HttpStatus.CONFLICT);

    const dibuat = await this.db.ulasanInstruktur.create({
      data: {
        bookingId: booking.id,
        userId: principal.userId,
        classSlotId: booking.classSlot.id,
        instructorId: booking.classSlot.instructorId,
        branchId: booking.classSlot.branchId,
        rating,
        comment,
      },
      select: { id: true, rating: true },
    });
    return { id: dibuat.id, skipped: dibuat.rating === null };
  }

  /** Ringkasan per instruktur dan daftar ulasan terbaru, dibatasi cabang yang boleh dibaca. */
  async laporan(
    principal: SessionPrincipal,
    input: { branchId?: string; from?: string; until?: string } = {},
    now = new Date(),
  ): Promise<LaporanUlasan> {
    this.policy.requireCapability(principal.capabilities, CAP_BACA_ULASAN);
    const scope = this.policy.capabilityBranchScope(principal, CAP_BACA_ULASAN);
    let cabang: { in?: string[]; notIn?: string[] } | string | undefined;
    if (input.branchId) {
      const boleh = scope.all
        ? !scope.excluded.includes(input.branchId)
        : scope.included.includes(input.branchId);
      if (!boleh) throw new ApiProblem('FORBIDDEN', HttpStatus.FORBIDDEN);
      cabang = input.branchId;
    } else if (!scope.all) {
      cabang = { in: scope.included };
    } else if (scope.excluded.length) {
      cabang = { notIn: scope.excluded };
    }

    const until = parseTanggal(input.until, 'until') ?? now;
    const from = parseTanggal(input.from, 'from') ?? new Date(until.getTime() - 90 * 86_400_000);
    if (from.getTime() > until.getTime()) throw invalid('from', 'AFTER_UNTIL');

    const rows = await this.db.ulasanInstruktur.findMany({
      where: {
        rating: { not: null },
        createdAt: { gte: from, lte: until },
        ...(cabang !== undefined ? { branchId: cabang } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 2000,
    });

    const ids = (pilih: (r: (typeof rows)[number]) => string) => [...new Set(rows.map(pilih))];
    const [users, slots, branches] = await Promise.all([
      rows.length
        ? this.db.user.findMany({
            where: { id: { in: [...ids((r) => r.userId), ...ids((r) => r.instructorId)] } },
            select: { id: true, displayName: true },
          })
        : [],
      rows.length
        ? this.db.slotKelas.findMany({
            where: { id: { in: ids((r) => r.classSlotId) } },
            select: { id: true, startAt: true, classType: { select: { name: true } } },
          })
        : [],
      rows.length
        ? this.db.cabang.findMany({
            where: { id: { in: ids((r) => r.branchId) } },
            select: { id: true, name: true },
          })
        : [],
    ]);
    const nama = new Map(users.map((u) => [u.id, u.displayName]));
    const slot = new Map(slots.map((s) => [s.id, s]));
    const namaCabang = new Map(branches.map((b) => [b.id, b.name]));

    const perInstruktur = new Map<string, RingkasanInstruktur & { total: number }>();
    for (const r of rows) {
      const rating = r.rating as number;
      const ada = perInstruktur.get(r.instructorId) ?? {
        instructorId: r.instructorId,
        namaInstruktur: nama.get(r.instructorId) ?? 'Instruktur',
        jumlahUlasan: 0,
        rataRata: 0,
        sebaran: [0, 0, 0, 0, 0] as RingkasanInstruktur['sebaran'],
        total: 0,
      };
      ada.jumlahUlasan += 1;
      ada.total += rating;
      ada.sebaran[rating - 1] = (ada.sebaran[rating - 1] ?? 0) + 1;
      perInstruktur.set(r.instructorId, ada);
    }
    const instruktur = [...perInstruktur.values()]
      .map(({ total, ...r }) => ({
        ...r,
        rataRata: Math.round((total / r.jumlahUlasan) * 10) / 10,
      }))
      .sort(
        (a, b) =>
          b.jumlahUlasan - a.jumlahUlasan || a.namaInstruktur.localeCompare(b.namaInstruktur),
      );

    const ulasan: BarisUlasan[] = rows.slice(0, 200).map((r) => {
      const s = slot.get(r.classSlotId);
      return {
        id: r.id,
        rating: r.rating as number,
        comment: r.comment,
        createdAt: r.createdAt.toISOString(),
        namaMember: nama.get(r.userId) ?? 'Member',
        instructorId: r.instructorId,
        namaInstruktur: nama.get(r.instructorId) ?? 'Instruktur',
        namaKelas: s?.classType?.name ?? 'Kelas',
        namaCabang: namaCabang.get(r.branchId) ?? '',
        kelasMulai: s?.startAt.toISOString() ?? '',
      };
    });

    return { from: from.toISOString(), until: until.toISOString(), instruktur, ulasan };
  }
}

function parseTanggal(nilai: string | undefined, field: string): Date | null {
  if (!nilai) return null;
  const t = new Date(nilai);
  if (Number.isNaN(t.getTime())) throw invalid(field, 'INVALID_DATE');
  return t;
}
