import type { ClassSlot } from '../api-clients/class-slot-client';
import type { CustomerBookingRecord } from '../api-clients/booking-client';

/** Alasan cepat untuk mencatat kehadiran manual; petugas memilih satu, atau menulis sendiri. */
export const ATTENDANCE_REASON_PRESETS = [
  'Hadir langsung di studio (tanpa HP)',
  'Ponsel pelanggan bermasalah saat konfirmasi',
  'Pelanggan hadir tetapi belum mengonfirmasi lewat tautan',
  'Petugas melihat langsung pelanggan mengikuti kelas',
] as const;

/** Presensi susulan oleh admin hanya sampai 2 jam setelah kelas selesai (Rule #9). */
export const BACKFILL_WINDOW_MS = 2 * 3600_000;

const LIVE_STATUSES: readonly string[] = ['PUBLISHED', 'CONFIRMED', 'COMPLETED'];

/** Kelas hari ini yang tidak dibatalkan, urut jam mulai. */
export function liveSlots(slots: readonly ClassSlot[]): ClassSlot[] {
  return slots
    .filter((slot) => LIVE_STATUSES.includes(slot.status))
    .sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
}

/** Kelas yang sedang berjalan dan kelas berikutnya pada waktu `now`. */
export function pickRunningAndNext(slots: readonly ClassSlot[], now: Date) {
  const sorted = liveSlots(slots);
  const running = sorted.find((slot) => slot.startAt <= now && now < slot.endAt) ?? null;
  const next = sorted.find((slot) => slot.startAt > now) ?? null;
  return { running, next };
}

/** Kelas terakhir yang sudah selesai sampai `now`; dipilih bila tidak ada kelas berjalan atau berikutnya. */
export function pickLastEnded(slots: readonly ClassSlot[], now: Date): ClassSlot | null {
  const ended = liveSlots(slots).filter((slot) => slot.endAt <= now);
  return ended[ended.length - 1] ?? null;
}

export type SlotPhase = 'Selesai' | 'Berjalan' | 'Belum mulai';

export function slotPhase(slot: ClassSlot, now: Date): SlotPhase {
  if (slot.endAt <= now) return 'Selesai';
  if (slot.startAt <= now) return 'Berjalan';
  return 'Belum mulai';
}

/**
 * Apakah admin boleh mencatat kehadiran pelanggan kelas ini sekarang. API menolak bila kelas belum
 * dikonfirmasi (kuota minimum belum terpenuhi) atau sudah lewat 2 jam setelah selesai.
 */
export function attendanceWindow(slot: ClassSlot, now: Date): { open: boolean; reason?: string } {
  if (slot.status !== 'CONFIRMED' && slot.status !== 'COMPLETED')
    return { open: false, reason: 'Kehadiran bisa dicatat setelah kelas dikonfirmasi.' };
  if (now.getTime() > slot.endAt.getTime() + BACKFILL_WINDOW_MS)
    return {
      open: false,
      reason: 'Lewat 2 jam setelah kelas selesai. Batas presensi manual telah lewat; hubungi Manager jika perlu susulan.',
    };
  return { open: true };
}

/**
 * Label untuk kartu kelas berikutnya: "Mulai X menit lagi" bila dimulai dalam 60 menit,
 * atau "Berikutnya".
 */
export function nextClassLabel(slot: ClassSlot | null, now: Date): string {
  if (!slot) return 'Berikutnya';
  const diffMinutes = Math.round((slot.startAt.getTime() - now.getTime()) / 60_000);
  if (diffMinutes > 0 && diffMinutes <= 60) {
    return `Mulai ${diffMinutes} menit lagi`;
  }
  return 'Berikutnya';
}

/** Format waktu kehadiran, contoh "07.54". */
export function formatAttendanceTime(date: Date | string, timezone = 'Asia/Jakarta'): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('id-ID', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: timezone,
  })
    .format(d)
    .replace(':', '.');
}

/** Sisa sesi yang dianggap "hampir habis" untuk ditawari perpanjangan di meja depan. */
export const SISA_SESI_HAMPIR_HABIS = 1;

/**
 * Member yang datang hari ini dan sesinya tinggal sedikit, satu baris per orang (kelas paling
 * awal), urut dari sisa sesi paling sedikit. Booking yang dibatalkan tidak dihitung.
 */
export function pickExpiringToday(
  bookings: readonly CustomerBookingRecord[],
): CustomerBookingRecord[] {
  const perOrang = new Map<string, CustomerBookingRecord>();
  for (const booking of bookings) {
    if (booking.status === 'CANCELLED' || !booking.sessionBalance) continue;
    if (booking.sessionBalance.available > SISA_SESI_HAMPIR_HABIS) continue;
    const key = booking.customer?.id ?? booking.id;
    const ada = perOrang.get(key);
    const mulai = (b: CustomerBookingRecord) => new Date(b.classSlot?.startAt ?? 0).getTime();
    if (!ada || mulai(booking) < mulai(ada)) perOrang.set(key, booking);
  }
  return [...perOrang.values()].sort(
    (a, b) => a.sessionBalance!.available - b.sessionBalance!.available,
  );
}
