'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, Info, Users } from 'lucide-react';
import {
  browserClassSlotClient,
  type ClassSlot,
  type ClassSlotClient,
  type ClassWorkspace,
} from '../api-clients/class-slot-client';
import {
  browserBookingClient,
  type BookingClient,
  type CustomerBookingRecord,
} from '../api-clients/booking-client';
import {
  browserAvailabilityClient,
  type AvailabilityClient,
  type AvailabilityWindow,
} from '../api-clients/availability-client';
import { useSessionContext } from '../session-context';
import { QrKehadiran } from '../components/qr-kehadiran';
import { AmbilSelfie } from '../components/ambil-selfie';
import { verificationClient } from '../api-clients/identity-verification-client';
import { ButtonLink } from '../components/actions';
import { Feedback, Skeleton, StatusBadge } from '../ui';
import { Modal } from '../components/app-feedback';
import { formatBranchTime, localDateKey, zonedLocalDateTime } from '../lib/class-time';

export interface InstructorTodayViewProps {
  client?: ClassSlotClient;
  bookingClient?: BookingClient;
  availabilityClient?: AvailabilityClient;
  initialDate?: Date;
  /** Hanya untuk tes: pemuat QR tetap. */
  muatQr?: () => Promise<string>;
  /** Hanya untuk tes: status dan pengiriman foto selfie. */
  selfieClient?: Pick<typeof verificationClient, 'mine' | 'submit'>;
  /** `minggu`: halaman Jadwal Saya, kelas milik instruktur seminggu penuh dengan kartu yang sama. */
  mode?: 'hari' | 'minggu';
  /** Hanya untuk tes: jam sekarang untuk jendela presensi. */
  now?: () => number;
}

/** Jendela scan QR instruktur (PRD 5.15): 45 menit sebelum mulai sampai 10 menit setelah mulai. */
export const PRESENSI_BUKA_MENIT = 45;
export const PRESENSI_TUTUP_MENIT = 10;
/** Selang muat ulang ringan selama jendela presensi terbuka, supaya status HADIR muncul sendiri. */
export const SELANG_CEK_PRESENSI_MS = 30_000;

export function dalamJendelaPresensi(startAt: Date, now: number) {
  const mulai = startAt.getTime();
  return now >= mulai - PRESENSI_BUKA_MENIT * 60_000 && now <= mulai + PRESENSI_TUTUP_MENIT * 60_000;
}

const HARI_MS = 86_400_000;

/** "Senin, 23 Nov" dari kunci tanggal lokal; `denganHari` selalu memakai nama hari. */
function labelTanggal(dateKey: string, timeZone: string, denganHari = false) {
  const tanggal = zonedLocalDateTime(dateKey, '12:00', timeZone);
  return new Intl.DateTimeFormat('id-ID', {
    weekday: denganHari ? 'long' : 'short',
    day: 'numeric',
    month: 'short',
    timeZone,
  }).format(tanggal);
}

/** Senin pukul 00.00 pada minggu tanggal itu, sebagai kunci tanggal lokal (YYYY-MM-DD). */
function seninDari(dateKey: string) {
  const [y, m, d] = dateKey.split('-').map(Number) as [number, number, number];
  const tanggal = new Date(Date.UTC(y, m - 1, d));
  const geser = (tanggal.getUTCDay() + 6) % 7;
  return new Date(tanggal.getTime() - geser * HARI_MS).toISOString().slice(0, 10);
}

function tambahHari(dateKey: string, hari: number) {
  const [y, m, d] = dateKey.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d) + hari * HARI_MS).toISOString().slice(0, 10);
}

export function InstructorTodayView({
  client = browserClassSlotClient,
  bookingClient = browserBookingClient,
  availabilityClient = browserAvailabilityClient,
  initialDate,
  muatQr,
  selfieClient = verificationClient,
  mode = 'hari',
  now = Date.now,
}: InstructorTodayViewProps) {
  const mingguan = mode === 'minggu';
  const sessionContext = useSessionContext();
  const session = sessionContext?.session;
  // Instruktur bisa mengajar di beberapa cabang (mis. GG dan MK); semua cabangnya dimuat, dan nama
  // cabang diambil dari tiap kelas, bukan dari cabang aktif.
  const cabangSaya = session?.branches ?? [];
  const namaCabang = (id: string) => cabangSaya.find((b) => b.id === id)?.name ?? null;
  const timezone =
    sessionContext?.activeBranch?.timezone ?? cabangSaya[0]?.timezone ?? 'Asia/Jakarta';

  const [workspace, setWorkspace] = useState<ClassWorkspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Selected slot for attendee panel
  const [selectedSlot, setSelectedSlot] = useState<ClassSlot | null>(null);
  // Instruktur juga wajib punya foto selfie, supaya staf mengenalinya di meja check-in.
  const [perluSelfie, setPerluSelfie] = useState(false);
  useEffect(() => {
    let batal = false;
    Promise.resolve()
      .then(() => selfieClient.mine())
      .then((r) => !batal && setPerluSelfie(r?.status !== 'APPROVED'))
      .catch(() => undefined);
    return () => {
      batal = true;
    };
  }, [selfieClient]);
  const [attendees, setAttendees] = useState<CustomerBookingRecord[]>([]);
  const [attendeesLoading, setAttendeesLoading] = useState(false);
  const [attendeesError, setAttendeesError] = useState<string | null>(null);

  // Availability summary
  const [availabilities, setAvailabilities] = useState<AvailabilityWindow[]>([]);
  const [availabilityLoading, setAvailabilityLoading] = useState(false);

  const referenceDate = initialDate ?? new Date();
  const todayKey = localDateKey(referenceDate, timezone);
  const [geserMinggu, setGeserMinggu] = useState(0);
  const awalMinggu = tambahHari(seninDari(todayKey), geserMinggu * 7);
  const awalRentang = mingguan ? awalMinggu : todayKey;
  const akhirRentang = mingguan ? tambahHari(awalMinggu, 6) : todayKey;

  // Kelas hari ini (atau seminggu di Jadwal Saya). `tenang`: muat ulang tanpa skeleton saat memeriksa presensi.
  const loadClasses = useCallback(async (tenang = false) => {
    if (!tenang) setLoading(true);
    setError(null);
    try {
      const from = zonedLocalDateTime(awalRentang, '00:00', timezone);
      const until = zonedLocalDateTime(akhirRentang, '23:59', timezone);
      const result = await client.discover({
        branches: session?.branches?.map((b) => ({ id: b.id, timezone: b.timezone })),
        timezone,
        from,
        until,
        slotsOnly: true,
      });
      setWorkspace(result);
    } catch (err) {
      if (!tenang) {
        setError(err instanceof Error ? err.message : 'Gagal memuat jadwal.');
        setWorkspace(null);
      }
    } finally {
      if (!tenang) setLoading(false);
    }
  }, [client, session?.branches, timezone, awalRentang, akhirRentang]);

  // Load availability
  const idCabang = cabangSaya.map((b) => b.id).join(',');
  const loadAvailability = useCallback(async () => {
    const ids = idCabang ? idCabang.split(',') : [];
    if (!ids.length) return;
    setAvailabilityLoading(true);
    try {
      const now = new Date();
      const halaman = await Promise.all(
        ids.map((branchId) =>
          availabilityClient
            .list({
              branchId,
              from: now.toISOString(),
              until: new Date(now.getTime() + 14 * 86_400_000).toISOString(),
            })
            .catch(() => ({ items: [] as AvailabilityWindow[] })),
        ),
      );
      setAvailabilities(
        halaman.flatMap((page) => page.items).filter((item) => item.status === 'ACTIVE'),
      );
    } catch {
      setAvailabilities([]);
    } finally {
      setAvailabilityLoading(false);
    }
  }, [availabilityClient, idCabang]);

  useEffect(() => {
    void loadClasses();
    if (!mingguan) void loadAvailability();
  }, [loadClasses, loadAvailability, mingguan]);

  // Load attendees when selectedSlot changes
  useEffect(() => {
    if (!selectedSlot) {
      setAttendees([]);
      setAttendeesError(null);
      return;
    }
    let cancelled = false;
    setAttendeesLoading(true);
    setAttendeesError(null);

    void (async () => {
      try {
        const page = await bookingClient.list({
          classSlotId: selectedSlot.id,
          limit: 50,
        });
        if (!cancelled) {
          setAttendees(page.items);
        }
      } catch (err) {
        if (!cancelled) {
          setAttendeesError(err instanceof Error ? err.message : 'Gagal memuat daftar peserta.');
          setAttendees([]);
        }
      } finally {
        if (!cancelled) {
          setAttendeesLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [bookingClient, selectedSlot]);

  // Filter slots for current instructor and sort by startAt
  const todaySlots = useMemo(() => {
    if (!workspace?.slots) return [];
    return workspace.slots
      .filter((slot) => {
        // If instructor user ID matches session, or if slot has no instructor or belongs to user
        if (slot.instructorUserId && session?.id) {
          return slot.instructorUserId === session.id;
        }
        return true;
      })
      .sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
  }, [session?.id, workspace?.slots]);

  // Selama ada kelas hari ini yang jendela presensinya terbuka dan belum tercatat, muat ulang tiap
  // 30 detik supaya HADIR dan banner "Presensi tercatat" muncul sendiri setelah staf memindai QR.
  const menungguPresensi =
    !mingguan &&
    todaySlots.some((slot) => !slot.instructorAttendance?.checkedInAt && dalamJendelaPresensi(slot.startAt, now()));
  useEffect(() => {
    if (!menungguPresensi) return;
    const timer = window.setInterval(() => void loadClasses(true), SELANG_CEK_PRESENSI_MS);
    return () => window.clearInterval(timer);
  }, [menungguPresensi, loadClasses]);

  // Presensi terakhir hari ini; banner tetap tampil (tidak hilang sendiri) selama kelasnya belum selesai.
  const presensiTerakhir = mingguan
    ? null
    : [...todaySlots]
        .filter((slot) => slot.instructorAttendance?.checkedInAt && slot.endAt.getTime() > now())
        .sort(
          (a, b) =>
            new Date(b.instructorAttendance!.checkedInAt!).getTime() -
            new Date(a.instructorAttendance!.checkedInAt!).getTime(),
        )[0] ?? null;

  // Name resolution helpers
  const getClassName = useCallback(
    (classTypeId: string, slot?: ClassSlot) => {
      return (
        (slot as { classType?: { name?: string } } | undefined)?.classType?.name ??
        workspace?.classTypes?.find((c) => c.id === classTypeId)?.name ??
        'Kelas Pilates'
      );
    },
    [workspace?.classTypes],
  );

  const getStudioName = useCallback(
    (studioId: string, slot?: ClassSlot) => {
      const studio =
        (slot as { studio?: { name?: string } } | undefined)?.studio?.name ??
        workspace?.studios?.find((s) => s.id === studioId)?.name;
      const cabang = slot ? namaCabang(slot.branchId) : null;
      return [studio, cabang].filter(Boolean).join(' · ') || 'Studio Daily Dose';
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [workspace?.studios, cabangSaya],
  );

  // Formatted date string for header: "Senin, 26 Oktober 2026"
  const formattedToday = useMemo(() => {
    try {
      return new Intl.DateTimeFormat('id-ID', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        timeZone: timezone,
      }).format(referenceDate);
    } catch {
      return 'Hari Ini';
    }
  }, [referenceDate, timezone]);

  const firstName = session?.displayName?.trim()?.split(/\s+/)[0] ?? 'Instruktur';
  // Cabang tempat mengajar hari ini, dari kelasnya; tanpa kelas, header hanya menampilkan tanggal.
  const cabangHariIni = [
    ...new Set(todaySlots.map((slot) => namaCabang(slot.branchId)).filter(Boolean)),
  ] as string[];

  // Availability summary text
  const availabilitySummaryText = useMemo(() => {
    if (availabilityLoading) return 'Memuat status ketersediaan…';
    if (availabilities.length === 0) {
      return 'Belum ada jadwal ketersediaan yang diajukan untuk 2 minggu ke depan.';
    }
    return `${availabilities.length} slot ketersediaan mengajar aktif diajukan.`;
  }, [availabilities.length, availabilityLoading]);

  return (
    <div
      className="space-y-6 max-w-2xl mx-auto pb-8 font-sans text-dd-ink"
      aria-label="Beranda Instruktur"
    >
      {/* 1. Header: Halo [nama depan] + Tanggal dengan tahun & nama studio */}
      {mingguan ? (
        <header className="space-y-3">
          <h1 className="text-2xl sm:text-3xl font-extrabold text-dd-ink tracking-tight">Jadwal Saya</h1>
          <div className="flex items-center gap-2" aria-label="Navigasi minggu">
            <button
              type="button"
              aria-label="Minggu sebelumnya"
              onClick={() => setGeserMinggu((n) => n - 1)}
              className="grid size-12 shrink-0 place-items-center rounded-dd-md border border-dd-border-interactive bg-white text-dd-ink hover:border-dd-forest"
            >
              <ChevronLeft className="size-5" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => setGeserMinggu(0)}
              className="min-h-12 shrink-0 rounded-dd-md border border-dd-border-interactive bg-white px-4 text-base font-semibold text-dd-ink hover:border-dd-forest"
            >
              Minggu ini
            </button>
            <button
              type="button"
              aria-label="Minggu berikutnya"
              onClick={() => setGeserMinggu((n) => n + 1)}
              className="grid size-12 shrink-0 place-items-center rounded-dd-md border border-dd-border-interactive bg-white text-dd-ink hover:border-dd-forest"
            >
              <ChevronRight className="size-5" aria-hidden="true" />
            </button>
          </div>
          <p className="m-0 text-base font-medium text-dd-muted" aria-live="polite">
            {labelTanggal(awalMinggu, timezone)} sampai {labelTanggal(akhirRentang, timezone)}
          </p>
        </header>
      ) : (
        <header className="space-y-1">
          <h1 className="text-2xl sm:text-3xl font-extrabold text-dd-ink tracking-tight">
            Halo, {firstName}
          </h1>
          <p className="text-base font-medium text-dd-muted">
            {formattedToday}
            {cabangHariIni.length ? ` · ${cabangHariIni.join(', ')}` : ''}
          </p>
        </header>
      )}

      {presensiTerakhir && (
        <section
          role="status"
          aria-label="Presensi tercatat"
          className="flex items-start gap-3 rounded-dd-xl border border-dd-forest/40 bg-dd-success-soft p-4"
        >
          <CheckCircle2 className="mt-0.5 size-6 shrink-0 text-dd-forest" aria-hidden="true" />
          <p className="m-0 text-base text-dd-ink">
            <strong className="block text-lg text-dd-forest">
              Presensi tercatat pukul {formatBranchTime(new Date(presensiTerakhir.instructorAttendance!.checkedInAt!), timezone)}
            </strong>
            {getClassName(presensiTerakhir.classTypeId, presensiTerakhir)}, mulai{' '}
            {formatBranchTime(presensiTerakhir.startAt, timezone)}. Honor kelas ini ikut dihitung.
          </p>
        </section>
      )}

      {!mingguan && perluSelfie && (
        <section
          aria-labelledby="selfie-instruktur"
          className="space-y-3 rounded-dd-xl border border-dd-warning-line/60 bg-dd-warning-soft p-5"
        >
          <h2 id="selfie-instruktur" className="m-0 text-lg font-semibold text-dd-ink">
            Ambil foto selfie dulu
          </h2>
          <p className="m-0 text-[15px] text-dd-ink">
            Staf memakai foto ini untuk mengenali Anda saat memindai QR presensi. Cukup sekali.
          </p>
          <AmbilSelfie
            kirim={(file) => selfieClient.submit({ selfie: file })}
            onTersimpan={() => setPerluSelfie(false)}
          />
        </section>
      )}

      {/* 2. QR presensi milik instruktur, langsung di beranda: staf di meja check-in yang memindainya. */}
      {!mingguan && (
        <QrKehadiran nama={session?.displayName ?? 'Instruktur'} peran="instruktur" muat={muatQr} />
      )}

      {/* 3. Kelas saya hari ini */}
      <section className="space-y-4" aria-labelledby="today-classes-heading">
        <div className="flex items-center justify-between">
          <h2 id="today-classes-heading" className="text-lg font-bold text-dd-ink">
            {mingguan ? 'Kelas yang saya ajar' : 'Kelas saya hari ini'}
          </h2>
          {!loading && todaySlots.length > 0 && (
            <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-dd-forest/10 text-dd-forest">
              {todaySlots.length} sesi
            </span>
          )}
        </div>

        {error && (
          <Feedback kind="error">
            {error}{' '}
            <button
              type="button"
              onClick={() => void loadClasses()}
              className="font-semibold underline ml-1"
            >
              Coba lagi
            </button>
          </Feedback>
        )}

        {loading ? (
          <Skeleton label="Memuat jadwal kelas hari ini" />
        ) : todaySlots.length === 0 ? (
          <div className="rounded-2xl border border-dd-line/80 bg-white p-8 text-center space-y-4">
            <p className="text-base text-dd-ink font-medium">
              {mingguan ? 'Tidak ada kelas yang kamu ajar minggu ini.' : 'Tidak ada kelas terjadwal untuk kamu hari ini.'}
            </p>
            {!mingguan && <div>
              <ButtonLink
                href="/workspace/classes"
                variant="secondary"
                className="inline-flex items-center gap-1.5"
              >
                <CalendarDays className="size-4" aria-hidden="true" />
                <span>Buka jadwal mingguan</span>
              </ButtonLink>
            </div>}
          </div>
        ) : (
          <div className="space-y-3" role="list" aria-label="Daftar kelas hari ini">
            {todaySlots.map((slot) => {
              const startStr = formatBranchTime(slot.startAt, timezone);
              const endStr = formatBranchTime(slot.endAt, timezone);
              const timeDisplay = `${startStr} – ${endStr}`;
              const durationMinutes = Math.max(
                15,
                Math.round((slot.endAt.getTime() - slot.startAt.getTime()) / 60000),
              );
              const isCheckedIn = Boolean(slot.instructorAttendance?.checkedInAt);
              const className = getClassName(slot.classTypeId, slot);
              const studioName = getStudioName(slot.studioId, slot);

              return (
                <div
                  key={slot.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => setSelectedSlot(slot)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      setSelectedSlot(slot);
                    }
                  }}
                  className="group w-full text-left rounded-2xl border border-dd-line/80 bg-white p-5 hover:border-dd-forest/40 hover: transition cursor-pointer space-y-3 focus:outline-none focus:ring-2 focus:ring-dd-forest"
                  aria-label={`Sesi ${className}, ${timeDisplay}, ${slot.bookedCount} dari ${slot.capacity} peserta`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      {mingguan && (
                        <span className="block text-base font-semibold text-dd-forest">
                          {labelTanggal(localDateKey(slot.startAt, timezone), timezone, true)}
                        </span>
                      )}
                      {/* Jam 22 px sesuai spesifikasi 5.4 */}
                      <span className="text-[22px] font-bold text-dd-ink leading-tight tracking-tight block">
                        {timeDisplay}
                      </span>
                      <span className="text-xs text-dd-muted font-medium mt-0.5 block">
                        {durationMinutes} menit
                      </span>
                    </div>
                    <StatusBadge tone={isCheckedIn ? 'success' : 'neutral'}>
                      {isCheckedIn ? 'HADIR' : 'NANTI'}
                    </StatusBadge>
                  </div>

                  <div>
                    <h3 className="text-base font-bold text-dd-ink group-hover:text-dd-forest transition-colors">
                      {className}
                    </h3>
                    <p className="text-xs text-dd-muted mt-0.5">{studioName}</p>
                  </div>

                  <div className="flex items-center justify-between pt-2.5 border-t border-dd-line/60 text-xs">
                    <span className="font-semibold text-dd-forest">
                      {slot.bookedCount}/{slot.capacity} peserta
                    </span>
                    <span className="text-dd-muted font-medium inline-flex items-center gap-1 group-hover:text-dd-forest transition-colors">
                      <span>Lihat peserta</span>
                      <ChevronRight className="size-3.5" aria-hidden="true" />
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* 4. Panel peserta sesi terpilih (Modal) */}
      <Modal
        open={Boolean(selectedSlot)}
        title="Peserta Sesi"
        description={
          selectedSlot
            ? `${getClassName(selectedSlot.classTypeId, selectedSlot)} · ${formatBranchTime(
                selectedSlot.startAt,
                timezone,
              )}–${formatBranchTime(selectedSlot.endAt, timezone)} · ${getStudioName(
                selectedSlot.studioId,
                selectedSlot,
              )}`
            : undefined
        }
        onClose={() => setSelectedSlot(null)}
      >
        <div className="space-y-4" aria-label="Daftar peserta kelas terpilih">
          {attendeesError && <Feedback kind="error">{attendeesError}</Feedback>}

          {attendeesLoading ? (
            <Skeleton label="Memuat peserta kelas" />
          ) : attendees.length === 0 ? (
            <div className="py-6 text-center text-sm text-dd-muted">
              Belum ada peserta terdaftar pada sesi ini.
            </div>
          ) : (
            <ul className="divide-y divide-dd-line/60" role="list">
              {attendees.map((attendee) => {
                const attended = attendee.status === 'ATTENDED';
                return (
                  <li
                    key={attendee.id}
                    className="py-3 flex items-center justify-between gap-3 text-sm"
                  >
                    <div className="min-w-0 flex items-center gap-2.5">
                      <div className="size-8 rounded-full bg-dd-surface-muted flex items-center justify-center text-dd-muted shrink-0">
                        <Users className="size-4" aria-hidden="true" />
                      </div>
                      <div className="min-w-0">
                        <strong className="block text-dd-ink truncate font-semibold">
                          {attendee.kursiTeman
                            ? attendee.namaTeman || 'Teman'
                            : (attendee.customer?.displayName ?? 'Peserta')}
                        </strong>
                        {attendee.kursiTeman && (
                          <span className="block text-sm font-semibold text-dd-forest">
                            Teman dari {attendee.customer?.displayName ?? 'member'}
                          </span>
                        )}
                        <span className="text-xs text-dd-muted block">
                          {attended ? 'Sudah check-in' : 'Menunggu kedatangan'}
                        </span>
                      </div>
                    </div>
                    <StatusBadge tone={attended ? 'success' : 'neutral'}>
                      {attended ? 'HADIR' : 'NANTI'}
                    </StatusBadge>
                  </li>
                );
              })}
            </ul>
          )}

          {/* Baris penutup wajib spesifikasi 5.4: "Instruktur tidak melihat data pembayaran peserta." */}
          <div className="pt-3 border-t border-dd-line/60 flex items-center gap-2 text-xs text-dd-muted">
            <Info className="size-4 shrink-0 text-dd-muted" aria-hidden="true" />
            <span>Instruktur tidak melihat data pembayaran peserta.</span>
          </div>
        </div>
      </Modal>

      {/* 5. Kartu ketersediaan mengajar dengan ringkasan pengajuan dan tautan Atur */}
      {!mingguan && <section
        className="rounded-2xl border border-dd-line/80 bg-white p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
        aria-labelledby="availability-card-heading"
      >
        <div className="space-y-1">
          <h2 id="availability-card-heading" className="text-[13px] font-bold text-dd-muted">
            Ketersediaan Mengajar
          </h2>
          <p className="text-sm font-medium text-dd-ink">{availabilitySummaryText}</p>
        </div>
        <div>
          <ButtonLink
            href="/workspace/availability"
            variant="secondary"
            size="sm"
            className="w-full sm:w-auto inline-flex items-center justify-center"
          >
            Atur
          </ButtonLink>
        </div>
      </section>}
    </div>
  );
}
