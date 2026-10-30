'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, MessageSquare, ScanLine, UserPlus } from 'lucide-react';
import { WhatsAppReminderDialog } from './whatsapp-reminder-dialog';
import type { WhatsAppReminderContext, WhatsAppPreset } from './whatsapp-reminder-presets';
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
  browserDashboardClient,
  type DashboardClient,
  type DashboardQueueSummary,
} from '../api-clients/dashboard-client';
import { useSessionContext } from '../session-context';
import { EmptyWeeksNotice } from './empty-weeks-notice';
import { TargetCabang, ambilTargetCabang, type PaceCabang } from '../components/target-cabang';
import { Button, ButtonLink } from '../components/actions';
import { Modal, useAppFeedback } from '../components/app-feedback';
import { Textarea } from '../components/forms';
import { Feedback, Skeleton, StatusBadge } from '../ui';
import { formatBranchTime, localDateKey, zonedLocalDateTime } from '../lib/class-time';
import {
  ATTENDANCE_REASON_PRESETS,
  attendanceWindow,
  formatAttendanceTime,
  liveSlots,
  nextClassLabel,
  pickLastEnded,
  pickExpiringToday,
  pickRunningAndNext,
  slotPhase,
} from './front-desk-today';

export interface FrontDeskTodayViewProps {
  client?: ClassSlotClient;
  bookingClient?: BookingClient;
  dashboardClient?: DashboardClient;
  /**
   * Antrean cabang yang sudah dimuat induknya (null = masih memuat). Bila diisi, halaman ini tidak memanggil
   * ringkasan dashboard sendiri.
   */
  queues?: DashboardQueueSummary[] | null;
  /** Hanya untuk tes: jam acuan. */
  initialNow?: Date;
  /** Target cabang dari pusat; tes mengganti pemuatnya. */
  muatTarget?: (branchId: string) => Promise<PaceCabang>;
}

/**
 * Halaman "Hari Ini" petugas meja depan:
 * - Jam digital real-time di header
 * - Dua kartu utama di atas (Berjalan sekarang & Berikutnya / Mulai X menit lagi)
 * - Daftar hadir in-place dengan jam kehadiran dan modal alasan cepat
 * - Sisa kelas hari ini dengan deteksi kelebihan kapasitas (overcapacity)
 * - Tiga aksi besar (min-h-14)
 * - Masalah yang perlu dibereskan di cabang ini (hangat/krem, tanpa kartu statistik pasif)
 */
export function FrontDeskTodayView({
  client = browserClassSlotClient,
  bookingClient = browserBookingClient,
  dashboardClient = browserDashboardClient,
  queues: queuesFromParent,
  initialNow,
  muatTarget = ambilTargetCabang,
}: FrontDeskTodayViewProps) {
  const feedback = useAppFeedback();
  const sessionContext = useSessionContext();
  const session = sessionContext?.session;
  const branch =
    sessionContext?.activeBranch ?? (session?.branches?.length === 1 ? session.branches[0] : null);
  const timezone = branch?.timezone ?? 'Asia/Jakarta';
  const canMark = Boolean(sessionContext?.hasCapability('attendance:manage'));

  const [now, setNow] = useState(() => initialNow ?? new Date());
  const [workspace, setWorkspace] = useState<ClassWorkspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null);
  const [attendees, setAttendees] = useState<CustomerBookingRecord[]>([]);
  const [attendeesLoading, setAttendeesLoading] = useState(false);
  const [attendeesError, setAttendeesError] = useState<string | null>(null);
  const [fetchedQueues, setFetchedQueues] = useState<DashboardQueueSummary[] | null>(null);
  const queues = queuesFromParent !== undefined ? queuesFromParent : fetchedQueues;
  const [markTarget, setMarkTarget] = useState<CustomerBookingRecord | null>(null);
  const [reason, setReason] = useState('');
  const [marking, setMarking] = useState(false);
  const [markError, setMarkError] = useState('');
  const [whatsAppModal, setWhatsAppModal] = useState<{
    context: WhatsAppReminderContext;
    defaultPresetId?: WhatsAppPreset['id'];
  } | null>(null);

  useEffect(() => {
    if (initialNow) return;
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, [initialNow]);

  const todayKey = localDateKey(now, timezone);

  const loadClasses = useCallback(async () => {
    if (!branch?.id) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setWorkspace(
        await client.discover({
          branchId: branch.id,
          branches: [{ id: branch.id, timezone }],
          timezone,
          from: zonedLocalDateTime(todayKey, '00:00', timezone),
          until: zonedLocalDateTime(todayKey, '23:59', timezone),
        }),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Jadwal hari ini belum dapat dimuat.');
      setWorkspace(null);
    } finally {
      setLoading(false);
    }
  }, [branch?.id, client, timezone, todayKey]);

  useEffect(() => {
    void loadClasses();
  }, [loadClasses]);

  useEffect(() => {
    if (!branch?.id || queuesFromParent !== undefined) return;
    let cancelled = false;
    dashboardClient
      .overview({ branchId: branch.id })
      .then((overview) => {
        if (!cancelled) setFetchedQueues(overview.queues.filter((queue) => queue.count > 0));
      })
      .catch(() => {
        if (!cancelled) setFetchedQueues([]);
      });
    return () => {
      cancelled = true;
    };
  }, [branch?.id, dashboardClient, queuesFromParent]);

  const slots = useMemo(() => liveSlots(workspace?.slots ?? []), [workspace?.slots]);
  const { running, next } = useMemo(() => pickRunningAndNext(slots, now), [slots, now]);
  const selected =
    slots.find((slot) => slot.id === selectedSlotId) ??
    running ??
    next ??
    pickLastEnded(slots, now);

  const overcapacitySlots = useMemo(
    () => slots.filter((slot) => slot.bookedCount > slot.capacity),
    [slots],
  );

  const loadAttendees = useCallback(async () => {
    if (!selected) {
      setAttendees([]);
      return;
    }
    setAttendeesLoading(true);
    setAttendeesError(null);
    try {
      setAttendees((await bookingClient.list({ classSlotId: selected.id, limit: 50 })).items);
    } catch (cause) {
      setAttendees([]);
      setAttendeesError(
        cause instanceof Error ? cause.message : 'Daftar peserta belum dapat dimuat.',
      );
    } finally {
      setAttendeesLoading(false);
    }
  }, [bookingClient, selected]);

  useEffect(() => {
    void loadAttendees();
  }, [loadAttendees]);

  // Member yang datang hari ini dengan paket hampir habis: kesempatan menawarkan perpanjangan
  // saat orangnya ada di depan meja, bukan lewat WhatsApp setelah paketnya habis.
  const [expiring, setExpiring] = useState<CustomerBookingRecord[] | null>(null);
  useEffect(() => {
    if (!branch?.id) return;
    let cancelled = false;
    setExpiring(null);
    Promise.resolve()
      .then(() =>
        bookingClient.list({
          branchId: branch.id,
          from: zonedLocalDateTime(todayKey, '00:00', timezone).toISOString(),
          until: zonedLocalDateTime(todayKey, '23:59', timezone).toISOString(),
          limit: 100,
        }),
      )
      .then((page) => {
        if (!cancelled) setExpiring(pickExpiringToday(page.items));
      })
      .catch(() => {
        if (!cancelled) setExpiring([]);
      });
    return () => {
      cancelled = true;
    };
  }, [bookingClient, branch?.id, timezone, todayKey]);

  const className = (slot: ClassSlot) =>
    workspace?.classTypes.find((type) => type.id === slot.classTypeId)?.name ?? 'Kelas Pilates';
  const studioName = (slot: ClassSlot) =>
    workspace?.studios.find((studio) => studio.id === slot.studioId)?.name ??
    branch?.name ??
    'Studio';
  const instructorName = (slot: ClassSlot) =>
    (slot as { instructor?: { displayName?: string | null } | null }).instructor?.displayName ??
    workspace?.instructors.find((instructor) => instructor.id === slot.instructorUserId)
      ?.displayName ??
    'Belum ada instruktur';
  const time = (slot: ClassSlot) =>
    `${formatBranchTime(slot.startAt, timezone)} – ${formatBranchTime(slot.endAt, timezone)}`;

  const window = selected ? attendanceWindow(selected, now) : { open: false };

  const confirmMark = async () => {
    if (!markTarget || !bookingClient.backfillAttendance) return;
    setMarking(true);
    setMarkError('');
    try {
      await bookingClient.backfillAttendance(
        markTarget.id,
        reason.trim(),
        markTarget.version,
        crypto.randomUUID(),
      );
      feedback.showToast({
        tone: 'success',
        title: 'Kehadiran dicatat',
        message: `${markTarget.customer?.displayName ?? 'Pelanggan'} ditandai hadir.`,
      });
      setMarkTarget(null);
      setReason('');
      await loadAttendees();
    } catch {
      setMarkError(
        'Kehadiran belum bisa dicatat. Periksa batas waktu 2 jam setelah kelas selesai, lalu coba lagi.',
      );
    } finally {
      setMarking(false);
    }
  };

  if (!branch)
    return (
      <div className="space-y-4 font-sans text-dd-ink">
        <Feedback kind="info">
          Pilih cabang aktif di bagian atas supaya jadwal dan daftar hadir cabang itu tampil.
        </Feedback>
        {session?.branches && session.branches.length > 0 && (
          <div className="rounded-dd-lg border border-dd-line bg-white p-5 space-y-3">
            <h2 className="text-base font-semibold text-dd-ink">
              Atau pilih cabang bertugas Anda hari ini:
            </h2>
            <div className="flex flex-wrap gap-2.5">
              {session.branches.map((b) => (
                <Button
                  key={b.id}
                  type="button"
                  variant="secondary"
                  className="font-semibold text-dd-forest hover:border-dd-forest"
                  onClick={() => sessionContext?.setActiveBranchId(b.id)}
                >
                  🏢 {b.name}
                </Button>
              ))}
            </div>
          </div>
        )}
      </div>
    );

  const selectedLabel = selected
    ? selected.id === running?.id
      ? 'Berjalan sekarang'
      : slotPhase(selected, now) === 'Selesai'
        ? 'Sudah selesai'
        : nextClassLabel(selected, now)
    : '';
  const upcoming = slots.filter(
    (slot) => slot.id !== selected?.id && slotPhase(slot, now) !== 'Selesai',
  );
  const finished = slots.filter(
    (slot) => slot.id !== selected?.id && slotPhase(slot, now) === 'Selesai',
  );
  const queueTotal = (queues ?? []).reduce((sum, queue) => sum + queue.count, 0);
  const canReadRenewal = Boolean(sessionContext?.hasCapability('package:read'));

  const slotRow = (slot: ClassSlot) => {
    const ended = slotPhase(slot, now) === 'Selesai';
    const belowQuota = slot.minimumQuota > 0 && slot.bookedCount < slot.minimumQuota;
    const isOvercapacity = slot.bookedCount > slot.capacity;
    return (
      <li key={slot.id}>
        <button
          type="button"
          aria-pressed={selected?.id === slot.id}
          aria-label={`Lihat peserta ${className(slot)} ${time(slot)}`}
          onClick={() => setSelectedSlotId(slot.id)}
          className="w-full rounded-dd-lg border border-dd-line bg-white px-5 py-4 text-left transition hover:border-dd-forest"
        >
          <span className="block text-lg font-semibold tabular-nums text-dd-ink">{time(slot)}</span>
          <span className="block font-semibold text-dd-ink">{className(slot)}</span>
          <span className="block text-sm text-dd-muted">
            {studioName(slot)} · {slot.bookedCount} dari {slot.capacity} peserta
            {ended ? ' · Selesai' : ''}
          </span>
          {belowQuota && !ended && (
            <span className="mt-1 block text-sm font-semibold text-dd-warning">
              Di bawah kuota minimum ({slot.bookedCount} dari {slot.minimumQuota}). Diputuskan di
              meja check-in saat kelas mulai bila peserta tidak bertambah.
            </span>
          )}
          {isOvercapacity && (
            <span className="mt-1 flex items-center gap-1 text-sm font-semibold text-dd-danger">
              <AlertTriangle className="size-4" aria-hidden="true" />
              Kelebihan kapasitas ({slot.bookedCount}/{slot.capacity})
            </span>
          )}
        </button>
      </li>
    );
  };

  const formattedDate = new Intl.DateTimeFormat('id-ID', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: timezone,
  }).format(now);

  return (
    <div className="space-y-6 font-sans text-dd-ink">
      <header className="space-y-3">
        <p className="m-0 text-sm font-semibold text-dd-forest">{formattedDate}</p>
        <h1 className="m-0 text-[28px] font-semibold tracking-[-0.02em] sm:text-[32px]">
          Hari ini di meja depan
        </h1>
        <p className="m-0 text-[17px] text-dd-muted">
          Kelas yang berjalan, presensi peserta, dan antrean yang perlu Anda putuskan.
        </p>
        <div className="flex flex-wrap gap-3 pt-1">
          <ButtonLink
            href="/workspace/check-in"
            variant="secondary"
            leadingIcon={<ScanLine className="size-4" aria-hidden="true" />}
          >
            Buka Check-in
          </ButtonLink>
          <ButtonLink
            href="/customers"
            leadingIcon={<UserPlus className="size-4" aria-hidden="true" />}
          >
            Daftarkan member baru
          </ButtonLink>
        </div>
      </header>

      <TargetCabang branchId={branch?.id} muat={muatTarget} />

      {queues && queueTotal > 0 && (
        <section
          aria-labelledby="decision-heading"
          className="flex flex-col gap-4 rounded-dd-lg border border-dd-warning-line/60 bg-dd-warning-soft p-5 sm:flex-row sm:items-center"
        >
          <span
            aria-hidden="true"
            className="grid size-11 shrink-0 place-items-center rounded-dd-lg bg-dd-warning text-lg font-bold text-white"
          >
            {queueTotal}
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="decision-heading" className="m-0 text-lg font-semibold text-dd-warning">
              {queueTotal} hal menunggu keputusan Anda
            </h2>
            <p className="m-0 mt-0.5 text-sm text-dd-ink">
              {queues.map((queue) => `${queue.count} ${queue.label.toLowerCase()}`).join(', ')}.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {queues.slice(0, 2).map((queue, index) => (
              <ButtonLink
                key={queue.key}
                href={queue.href}
                size="sm"
                variant={index === 0 ? 'primary' : 'secondary'}
              >
                {queue.label}
              </ButtonLink>
            ))}
          </div>
        </section>
      )}

      <EmptyWeeksNotice
        branchId={branch.id}
        timezone={timezone}
        client={client}
        initialNow={initialNow}
        canFill={Boolean(sessionContext?.hasCapability('class-slot:manage'))}
      />

      {error && (
        <Feedback kind="error">
          {error}{' '}
          <button
            type="button"
            onClick={() => void loadClasses()}
            className="ml-1 font-semibold underline"
          >
            Coba lagi
          </button>
        </Feedback>
      )}

      {loading ? (
        <Skeleton label="Memuat jadwal hari ini" />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <div className="min-w-0 space-y-6">
            {slots.length === 0 && !error ? (
              <section className="space-y-3 rounded-dd-lg border border-dd-line bg-white p-6">
                <p className="m-0 text-base font-medium">
                  Tidak ada kelas hari ini di {branch.name}.
                </p>
                <ButtonLink href="/workspace/classes" variant="secondary">
                  Buka jadwal kelas
                </ButtonLink>
              </section>
            ) : (
              selected && (
                <section
                  aria-label={selectedLabel}
                  className={`rounded-dd-lg border bg-white p-5 sm:p-6 ${
                    selected.id === running?.id ? 'border-dd-forest' : 'border-dd-line'
                  }`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="m-0 text-lg font-semibold text-dd-ink">{selectedLabel}</p>
                    <span className="rounded-full border border-dd-forest/40 bg-dd-success-soft px-2.5 py-0.5 text-sm font-semibold tabular-nums text-dd-forest">
                      {time(selected)}
                    </span>
                  </div>
                  <h2 className="m-0 mt-3 text-2xl font-semibold text-dd-ink">
                    {className(selected)}
                  </h2>
                  <p className="m-0 mt-1 text-[15px] text-dd-muted">
                    {studioName(selected)} · bersama {instructorName(selected)} · Terisi{' '}
                    {selected.bookedCount} dari {selected.capacity}
                    {selected.bookedCount >= selected.capacity ? ' (penuh)' : ''}
                  </p>

                  <h3 id="attendance-heading" className="m-0 mt-5 text-[15px] font-semibold">
                    Presensi peserta
                  </h3>
                  {!window.open && 'reason' in window && window.reason && (
                    <p className="m-0 mt-1 text-sm text-dd-muted" role="note">
                      {window.reason}
                    </p>
                  )}
                  {attendeesError && <Feedback kind="error">{attendeesError}</Feedback>}
                  {attendeesLoading ? (
                    <Skeleton label="Memuat daftar peserta" />
                  ) : attendees.length === 0 ? (
                    <p className="m-0 mt-2 text-sm text-dd-muted">
                      Belum ada peserta terdaftar di kelas ini.
                    </p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table
                        aria-labelledby="attendance-heading"
                        className="mt-2 w-full min-w-[420px] text-left text-[15px]"
                      >
                        <thead className="text-sm text-dd-muted">
                          <tr className="border-b border-dd-line">
                            <th className="py-2 pr-3 font-medium">Peserta</th>
                            <th className="py-2 pr-3 font-medium">Status</th>
                            <th className="py-2 text-right font-medium">Tindakan</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-dd-line">
                          {attendees.map((booking) => {
                            const present =
                              Boolean(booking.attendance) || booking.status === 'ATTENDED';
                            const cancelled = booking.status === 'CANCELLED';
                            return (
                              <tr key={booking.id}>
                                <td className="py-3 pr-3">
                                  <span className="block font-medium text-dd-ink">
                                    {booking.customer?.displayName ?? 'Pelanggan'}
                                  </span>
                                  <span className="block text-sm text-dd-muted">
                                    {booking.package?.name ?? 'Paket'}
                                    {booking.sessionBalance
                                      ? ` · sisa ${booking.sessionBalance.available} sesi`
                                      : ''}
                                  </span>
                                </td>
                                <td className="py-3 pr-3 text-sm font-semibold">
                                  {present ? (
                                    <span className="text-dd-forest">
                                      Hadir
                                      {booking.attendance?.checkedInAt
                                        ? `, ${formatAttendanceTime(booking.attendance.checkedInAt, timezone)}`
                                        : ''}
                                    </span>
                                  ) : cancelled ? (
                                    <span className="text-dd-muted">Dibatalkan</span>
                                  ) : (
                                    <span className="text-dd-muted">Belum hadir</span>
                                  )}
                                </td>
                                <td className="py-3 text-right">
                                  <div className="flex items-center justify-end gap-1.5">
                                    {!cancelled && (
                                      <Button
                                        size="sm"
                                        variant="secondary"
                                        title="Kirim pesan pengingat WhatsApp"
                                        aria-label={`Kirim WhatsApp ke ${booking.customer?.displayName ?? 'peserta'}`}
                                        onClick={() => {
                                          const cleanPhone =
                                            booking.customer?.phoneMasked?.replace(/\*/g, '') || '';
                                          setWhatsAppModal({
                                            context: {
                                              customerName: booking.customer?.displayName ?? 'Member',
                                              phone: cleanPhone,
                                              className: selected ? className(selected) : undefined,
                                              branchName: branch?.name,
                                              classTime: selected ? time(selected) : undefined,
                                              instructorName: selected ? instructorName(selected) : undefined,
                                              remainingSessions: booking.sessionBalance?.available,
                                              checkInUrl:
                                                typeof globalThis !== 'undefined' && 'location' in globalThis
                                                  ? `${(globalThis as any).location.origin}/check-in`
                                                  : 'https://dailydosepilates.com/check-in',
                                            },
                                            defaultPresetId: 'class_reminder',
                                          });
                                        }}
                                        className="inline-flex items-center gap-1 text-xs font-medium text-dd-forest hover:bg-dd-forest/10"
                                      >
                                        <MessageSquare className="size-3.5 text-dd-forest" aria-hidden="true" />
                                        <span>Kirim WA</span>
                                      </Button>
                                    )}
                                    {present ? (
                                      <span className="text-sm text-dd-muted">Sudah tercatat</span>
                                    ) : canMark && window.open && booking.status === 'BOOKED' ? (
                                      <Button
                                        size="sm"
                                        variant="secondary"
                                        onClick={() => {
                                          setMarkError('');
                                          setReason('');
                                          setMarkTarget(booking);
                                        }}
                                      >
                                        Tandai hadir
                                      </Button>
                                    ) : null}
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>
              )
            )}

            {upcoming.length > 0 && (
              <section aria-labelledby="upcoming-heading" className="space-y-3">
                <h2 id="upcoming-heading" className="m-0 text-xl font-semibold">
                  Berikutnya hari ini
                </h2>
                <ul className="m-0 grid list-none gap-3 p-0">{upcoming.map(slotRow)}</ul>
              </section>
            )}

            {finished.length > 0 && (
              <details className="rounded-dd-lg border border-dd-line bg-white px-5 py-3">
                <summary className="cursor-pointer font-semibold text-dd-ink">
                  Sudah selesai hari ini ({finished.length} kelas)
                </summary>
                <p className="m-0 mt-2 text-sm text-dd-muted">
                  Kehadiran masih bisa dicatat sampai 2 jam setelah kelas selesai.
                </p>
                <ul className="m-0 mt-3 grid list-none gap-2 p-0">{finished.map(slotRow)}</ul>
              </details>
            )}
          </div>

          <aside aria-labelledby="expiring-heading" className="space-y-4">
            <h2 id="expiring-heading" className="m-0 text-xl font-semibold">
              Paketnya akan habis
            </h2>
            {expiring === null ? (
              <Skeleton label="Memuat paket member hari ini" />
            ) : expiring.length > 0 ? (
              <section className="rounded-dd-lg border-2 border-dd-forest bg-white p-5">
                <p className="m-0 text-sm font-semibold text-dd-forest">
                  Datang hari ini, jangan sampai terlewat
                </p>
                <ul className="m-0 mt-3 list-none divide-y divide-dd-line p-0">
                  {expiring.map((item) => (
                    <li key={item.id} className="py-3 first:pt-0 last:pb-0">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <span className="block font-semibold text-dd-ink">
                            {item.customer?.displayName ?? 'Member'}
                          </span>
                          <span className="block text-sm text-dd-muted">
                            Kelas{' '}
                            {item.classSlot ? formatBranchTime(item.classSlot.startAt, timezone) : ''}
                            {item.package ? ` · ${item.package.name}` : ''}
                          </span>
                          <span className="block text-sm font-semibold text-dd-warning">
                            {item.sessionBalance && item.sessionBalance.available > 0
                              ? `Sisa ${item.sessionBalance.available} sesi`
                              : 'Ini sesi terakhirnya'}
                          </span>
                        </div>
                        <Button
                          size="sm"
                          variant="secondary"
                          title="Kirim pengingat perpanjangan via WhatsApp"
                          aria-label={`Ingatkan perpanjangan ke ${item.customer?.displayName ?? 'member'}`}
                          onClick={() => {
                            const cleanPhone = item.customer?.phoneMasked?.replace(/\*/g, '') || '';
                            setWhatsAppModal({
                              context: {
                                customerName: item.customer?.displayName ?? 'Member',
                                phone: cleanPhone,
                                className:
                                  item.classSlot?.classType?.name ??
                                  (item.classSlot && workspace?.classTypes
                                    ? workspace.classTypes.find((t) => t.id === (item.classSlot as any)?.classTypeId)?.name
                                    : 'Pilates'),
                                branchName: branch?.name,
                                remainingSessions: item.sessionBalance?.available ?? 0,
                              },
                              defaultPresetId: 'package_renewal',
                            });
                          }}
                          className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-dd-forest hover:bg-dd-forest/10"
                        >
                          <MessageSquare className="size-3.5 text-dd-forest" aria-hidden="true" />
                          <span>Ingatkan WA</span>
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            ) : (
              <p className="m-0 text-sm text-dd-muted">
                Tidak ada member yang datang hari ini dengan paket hampir habis.
              </p>
            )}
            {canReadRenewal && (
              <section className="rounded-dd-lg border border-dd-line bg-white p-5">
                <p className="m-0 text-[15px] text-dd-ink">
                  Member yang paketnya sudah habis dan belum memperpanjang ada di daftar renewal,
                  lengkap dengan tombol WhatsApp.
                </p>
                <ButtonLink
                  href="/workspace/renewal"
                  variant="secondary"
                  size="sm"
                  className="mt-3"
                >
                  Lihat daftarnya
                </ButtonLink>
              </section>
            )}
          </aside>
        </div>
      )}

      {/* Modal Catat Kehadiran Manual */}
      <Modal
        open={markTarget !== null}
        title="Tandai hadir"
        description={
          markTarget
            ? `${markTarget.customer?.displayName ?? 'Pelanggan'} · alasan dicatat di audit`
            : undefined
        }
        busy={marking}
        onClose={() => setMarkTarget(null)}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" disabled={marking} onClick={() => setMarkTarget(null)}>
              Batal
            </Button>
            <Button
              loading={marking}
              disabled={reason.trim().length < 3}
              onClick={() => void confirmMark()}
            >
              Catat kehadiran
            </Button>
          </div>
        }
      >
        <div className="grid gap-3">
          <p className="text-sm text-dd-muted">Pilih alasan, atau tulis sendiri di bawah.</p>
          <div className="flex flex-wrap gap-2">
            {ATTENDANCE_REASON_PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                aria-pressed={reason === preset}
                onClick={() => setReason(preset)}
                className={`rounded-dd-md border px-3 py-2 text-left text-sm ${
                  reason === preset
                    ? 'border-dd-forest bg-dd-forest/10 font-semibold'
                    : 'border-dd-border-interactive bg-white'
                }`}
              >
                {preset}
              </button>
            ))}
          </div>
          <Textarea
            label="Alasan"
            value={reason}
            maxLength={500}
            onChange={(event) => setReason(event.target.value)}
          />
          {markError && <Feedback kind="error">{markError}</Feedback>}
        </div>
      </Modal>

      {/* Modal Preset Pesan Pengingat WhatsApp */}
      <WhatsAppReminderDialog
        open={whatsAppModal !== null}
        onClose={() => setWhatsAppModal(null)}
        context={whatsAppModal?.context ?? null}
        defaultPresetId={whatsAppModal?.defaultPresetId}
      />
    </div>
  );
}
