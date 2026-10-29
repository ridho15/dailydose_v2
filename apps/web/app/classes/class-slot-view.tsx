'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import {
  browserClassSlotClient,
  classSlotFailure,
  type ClassSlot,
  type ClassSlotClient,
  type ClassTypeOption,
  type InstructorOption,
  type StudioOption,
} from '@/api-clients/class-slot-client';
import {
  formatBranchDay,
  formatBranchLongDate,
  formatBranchTime,
  localDateKey,
  shiftWeek,
  weekWindow,
} from '@/lib/class-time';
import { EmptyState, Feedback, Skeleton, StatusBadge } from '../ui';
import { AdminPageHeader } from '../components/admin/admin-page-header';
import { useSessionContext } from '../session-context';
import { isInstructorOnlySession } from '@/lib/session-audience';
import { CreatePanel, DetailPanel, type CreateTemplate } from './class-slot-panels';
import { LifecycleDialog } from '../components/admin/lifecycle-dialog';
import {
  classStatusTone,
  geserJadwal,
  isDibatalkan,
  kelompokTipeKelas,
  kunciTipeKelas,
  rentangJam,
  statusLabels,
  timezoneLabel,
  type PosisiKalender,
} from './class-slot-presenters';
import { labelHari, TimetableMoveBar, TimetableWeekGrid } from './timetable-week-grid';
import { TimetableRosterPanel, waktuKelas } from './timetable-roster-panel';
import { TopBarSlot } from '../components/top-bar-slot';
import { Button, ButtonLink } from '../components/actions';
import { Drawer, useAppFeedback } from '../components/app-feedback';
import { browserBookingClient, type BookingClient } from '@/api-clients/booking-client';
import { EmptyWeeksNotice } from '../workspace/empty-weeks-notice';

type Panel =
  { kind: 'create'; template?: CreateTemplate } | { kind: 'detail'; slot: ClassSlot } | null;
type BranchOption = { id: string; code?: string; name: string; timezone: string };
/** Nama yang dikirim API bersama slot (tidak ada di tipe ter-generate). */
type SlotNames = {
  classType?: { name?: string | null } | null;
  instructor?: { displayName?: string | null } | null;
  branch?: { name?: string | null } | null;
};

export function ClassSlotView({
  client = browserClassSlotClient,
  branchOverride,
  branchesOverride,
  capabilitiesOverride,
  bookingClient = browserBookingClient,
}: {
  client?: ClassSlotClient;
  branchOverride?: BranchOption | null;
  branchesOverride?: BranchOption[];
  capabilitiesOverride?: readonly string[];
  bookingClient?: Pick<BookingClient, 'list'> &
    Partial<
      Pick<
        BookingClient,
        | 'issueBulkCheckIns'
        | 'issueInstructorCheckIn'
        | 'searchRosterCandidates'
        | 'create'
        | 'cancelAsStaff'
        | 'cancellationOptions'
        | 'ajukanPembatalanTerlambat'
        | 'pembatalanTertunda'
        | 'putuskanPembatalan'
      >
    >;
}) {
  const sessionContext = useSessionContext();
  const feedback = useAppFeedback();
  // Instruktur bisa mengajar di beberapa cabang (mis. GG dan MK) dan tidak punya pemilih cabang:
  // jadwalnya diambil dari semua cabangnya, bukan hanya cabang pertama.
  const instrukturSaja = isInstructorOnlySession(sessionContext?.session);
  const branch = instrukturSaja ? null : (branchOverride ?? sessionContext?.activeBranch ?? null);
  const sessionBranches = sessionContext?.session?.branches;
  const branches = useMemo(
    () => branchesOverride ?? sessionBranches ?? (branch ? [branch] : []),
    [branch, branchesOverride, sessionBranches],
  );
  const authorityKey = sessionContext?.session?.id ?? 'test';
  const capabilities = capabilitiesOverride ?? sessionContext?.session?.capabilities ?? [];
  const isInstructor = isInstructorOnlySession(sessionContext?.session);
  const canRead = capabilities.includes('class-slot:read');
  const canManage = !isInstructor && capabilities.includes('class-slot:manage');
  const canManageAttendance = !isInstructor && capabilities.includes('attendance:manage');
  const canCompleteClass = canManage || capabilities.includes('attendance:self');
  const canReadBookings = capabilities.includes('booking:read');
  const canViewAllBranches = !isInstructor && capabilities.includes('branch:all');
  const globalMode = !branch && (canViewAllBranches || isInstructor);
  const canOperate = Boolean(branch && canManage);
  const canOperateAttendance = Boolean(branch && canManageAttendance);
  const canCreateSlot = Boolean((branch || (globalMode && branches.length > 0)) && canManage);
  const [reference, setReference] = useState(new Date());
  const [slots, setSlots] = useState<ClassSlot[]>([]);
  const [classTypes, setClassTypes] = useState<ClassTypeOption[]>([]);
  const [instructors, setInstructors] = useState<InstructorOption[]>([]);
  const [studios, setStudios] = useState<StudioOption[]>([]);
  const [classTypeFilter, setClassTypeFilter] = useState('');
  const [tampilBatal, setTampilBatal] = useState(false);
  const [panel, setPanel] = useState<Panel>(null);
  const [message, setMessage] = useState<string>();
  const [failure, setFailure] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [panelDirty, setPanelDirty] = useState(false);
  const [slotToDelete, setSlotToDelete] = useState<ClassSlot | null>(null);
  const [selectedMobileDay, setSelectedMobileDay] = useState<string>('ALL');
  /** Kelas yang dipilih di kalender; daftar pesertanya tampil di bawah kalender. */
  const [selectedId, setSelectedId] = useState<string | null>(null);
  /** Pemindahan yang belum disimpan: id kelas ke posisi barunya. */
  const [tertunda, setTertunda] = useState<Record<string, PosisiKalender>>({});
  const [savingMoves, setSavingMoves] = useState(false);
  const displayTimezone = branch?.timezone ?? branches[0]?.timezone ?? 'Asia/Jakarta';
  const week = useMemo(
    () => (branch || globalMode ? weekWindow(reference, displayTimezone) : null),
    [branch, displayTimezone, globalMode, reference],
  );
  const load = useCallback(async () => {
    if (!canRead || (!branch && !globalMode) || !week) return;
    setBusy(true);
    setFailure(undefined);
    try {
      const workspace = await client.discover({
        branchId: branch?.id,
        branches: globalMode ? branches : undefined,
        timezone: displayTimezone,
        from: week.start,
        until: week.end,
      });
      // Instruktur hanya melihat kelas yang ia ajar.
      setSlots(
        isInstructor
          ? workspace.slots.filter((slot) => slot.instructorUserId === sessionContext?.session?.id)
          : workspace.slots,
      );
      setClassTypes(workspace.classTypes);
      setInstructors(workspace.instructors);
      setStudios(workspace.studios);
    } catch (error) {
      setFailure(classSlotFailure(error));
      setSlots([]);
    } finally {
      setBusy(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    branch?.id,
    branches.length,
    canRead,
    client,
    displayTimezone,
    globalMode,
    week?.start,
    week?.end,
  ]);

  useEffect(() => {
    setSlots([]);
    setClassTypes([]);
    setInstructors([]);
    setStudios([]);
    setClassTypeFilter('');
    setPanel(null);
    setMessage(undefined);
    setFailure(undefined);
  }, [branch?.id, authorityKey]);

  useEffect(() => {
    void load();
  }, [load]);

  const openPanel = (next: NonNullable<Panel>) => {
    setPanelDirty(false);
    if (next.kind === 'create') setFailure(undefined);
    setPanel(next);
  };
  const closePanel = () => {
    setPanelDirty(false);
    setPanel(null);
  };
  /** Nilai awal draft baru dari kelas yang ada: sama persis, satu minggu kemudian. */
  const duplicateTemplate = (slot: ClassSlot): CreateTemplate => {
    const next = new Date(slot.startAt.getTime() + 7 * 86_400_000);
    const clock = (value: Date) =>
      new Intl.DateTimeFormat('en-GB', {
        timeZone: slot.timezone,
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      }).format(value);
    return {
      classTypeId: slot.classTypeId,
      studioId: slot.studioId,
      roomId: slot.roomId,
      instructorUserId: slot.instructorUserId,
      date: localDateKey(next, slot.timezone),
      startTime: clock(slot.startAt),
      endTime: clock(slot.endAt),
    };
  };
  /** Menjalankan aksi kelas; hasilnya `true` bila tersimpan, supaya panel hanya ditutup saat berhasil. */
  const run = async (action: () => Promise<ClassSlot>, success: string): Promise<boolean> => {
    setBusy(true);
    setFailure(undefined);
    try {
      const updated = await action();
      setSlots((current) => {
        const exists = current.some((slot) => slot.id === updated.id);
        return exists
          ? current.map((slot) => (slot.id === updated.id ? updated : slot))
          : [updated, ...current];
      });
      if (panel?.kind === 'detail') setPanel({ kind: 'detail', slot: updated });
      setMessage(success);
      return true;
    } catch (error) {
      setFailure(classSlotFailure(error));
      return false;
    } finally {
      setBusy(false);
    }
  };
  // API sudah menyertakan nama tipe kelas/instruktur/cabang pada slot; daftar lokal hanya cadangan.
  const classTypeName = (id: string, slot?: ClassSlot) =>
    (slot as SlotNames | undefined)?.classType?.name ??
    classTypes.find((item) => item.id === id)?.name ??
    'Tipe kelas';
  const instructorName = (id?: string | null, slot?: ClassSlot) =>
    id
      ? ((slot as SlotNames | undefined)?.instructor?.displayName ??
        instructors.find((item) => item.id === id)?.displayName ??
        'Instruktur belum dimuat')
      : 'Belum ditetapkan';
  const branchName = (id: string, slot?: ClassSlot) =>
    (slot as SlotNames | undefined)?.branch?.name ??
    branches.find((item) => item.id === id)?.name ??
    'Cabang';
  // Chip tipe kelas digabung menurut nama: di mode semua cabang, tiap cabang punya tipe "Group"
  // sendiri dengan id berbeda, dan satu chip per id membuat nama yang sama muncul berkali-kali.
  // Role baca-saja (Owner/instruktur) tidak punya akses katalog; nama diambil dari slot yang tampil.
  const namaSlot = (slot: ClassSlot) => classTypeName(slot.classTypeId, slot);
  const classTypeOptions = kelompokTipeKelas(
    classTypes.length ? classTypes.map((item) => item.name) : slots.map(namaSlot),
  );
  const batal = slots.filter(isDibatalkan).length;
  const visible = slots
    .filter((slot) => tampilBatal || !isDibatalkan(slot))
    .filter((slot) => !classTypeFilter || kunciTipeKelas(namaSlot(slot)) === classTypeFilter)
    .sort((left, right) => left.startAt.getTime() - right.startAt.getTime());
  const grouped = new Map(
    (week?.days ?? []).map((day) => [
      day,
      visible.filter((slot) => localDateKey(slot.startAt, displayTimezone) === day),
    ]),
  );

  if (!canRead) {
    return (
      <section
        className="rounded-dd-lg border border-dd-danger/30 bg-dd-danger-soft p-6"
        aria-labelledby="classes-title"
      >
        <AdminPageHeader
          title="Timetable kelas"
          titleId="classes-title"
          description="Anda tidak memiliki izin untuk membaca jadwal kelas."
        />
        <Feedback kind="error">Akses kelas memerlukan izin class-slot:read.</Feedback>
      </section>
    );
  }

  if (!branch && !globalMode) {
    return (
      <section
        className="rounded-dd-lg border border-dd-line bg-dd-surface p-6"
        aria-labelledby="classes-title"
      >
        <AdminPageHeader
          title="Timetable kelas"
          titleId="classes-title"
          description="Pilih cabang aktif pada bagian atas workspace untuk membuka jadwal."
        />
        <Feedback kind="warning">
          Pilih cabang aktif untuk membuka timetable sesuai cakupan Anda.
        </Feedback>
      </section>
    );
  }

  /** Jam mulai menurut zona waktu cabang, bukan zona server. */
  const slotHour = (slot: ClassSlot) =>
    Number.parseInt(formatBranchTime(slot.startAt, slot.timezone).slice(0, 2), 10);

  const todayKey = localDateKey(new Date(), displayTimezone);

  const posisiAsli = (slot: ClassSlot): PosisiKalender => ({
    hari: localDateKey(slot.startAt, slot.timezone),
    jam: slotHour(slot),
  });
  const posisi = (slot: ClassSlot) => tertunda[slot.id] ?? posisiAsli(slot);

  // Kelas batal tidak ikut melebarkan rentang jam; yang batal di luar jam studio tetap dibuat muat
  // bila staf memilih menampilkannya.
  const gridHours = rentangJam(
    (tampilBatal ? visible : visible.filter((slot) => !isDibatalkan(slot))).map(slotHour),
  );
  const jamTeks = (jam: number) => `${String(jam).padStart(2, '0')}.00`;

  /** Nama depan saja; kolom hari terlalu sempit untuk nama lengkap. */
  const firstName = (nama: string) => nama.trim().split(/\s+/)[0] ?? nama;

  /** Menandai pemindahan; kembali ke tempat asal sama dengan membatalkannya. */
  const stage = (slot: ClassSlot, tujuan: PosisiKalender | null) =>
    setTertunda((kini) => {
      const next = { ...kini };
      const asli = posisiAsli(slot);
      if (!tujuan || (tujuan.hari === asli.hari && tujuan.jam === asli.jam)) delete next[slot.id];
      else next[slot.id] = tujuan;
      return next;
    });

  /**
   * Menyimpan semua pemindahan satu per satu. Yang gagal tetap bergaris putus-putus di posisi
   * barunya supaya staf bisa mencoba lagi atau membatalkannya, dan alasannya disebut per kelas.
   * `expectedVersion` membuat pemindahan gagal terang-terangan bila staf lain baru mengubah kelas
   * yang sama, bukan menimpa pekerjaannya diam-diam.
   */
  const simpanPemindahan = async () => {
    setSavingMoves(true);
    setFailure(undefined);
    setMessage(undefined);
    const gagal: string[] = [];
    let berhasil = 0;
    for (const [id, tujuan] of Object.entries(tertunda)) {
      const slot = slots.find((item) => item.id === id);
      if (!slot) continue;
      const asli = posisiAsli(slot);
      const jadwal = geserJadwal({
        startAt: slot.startAt,
        endAt: slot.endAt,
        hariAsal: asli.hari,
        jamAsal: asli.jam,
        hariTujuan: tujuan.hari,
        jamTujuan: tujuan.jam,
      });
      if (!jadwal) continue;
      try {
        const updated = await client.update(slot.id, {
          classTypeId: slot.classTypeId,
          studioId: slot.studioId,
          roomId: slot.roomId ?? null,
          instructorUserId: slot.instructorUserId ?? null,
          startAt: jadwal.startAt,
          endAt: jadwal.endAt,
          expectedVersion: slot.version,
          reason: 'Dipindah lewat kalender',
        });
        setSlots((kini) => kini.map((item) => (item.id === updated.id ? updated : item)));
        setTertunda((kini) => {
          const next = { ...kini };
          delete next[id];
          return next;
        });
        berhasil += 1;
      } catch (error) {
        gagal.push(
          `${classTypeName(slot.classTypeId, slot)} ke ${labelHari(tujuan.hari)} ${jamTeks(
            tujuan.jam,
          )}: ${classSlotFailure(error)}`,
        );
      }
    }
    setSavingMoves(false);
    if (berhasil)
      setMessage(berhasil === 1 ? 'Satu kelas dipindah.' : `${berhasil} kelas dipindah.`);
    if (gagal.length)
      setFailure(`Belum tersimpan, masih bergaris putus-putus: ${gagal.join('; ')}`);
  };

  const selectedSlot = slots.find((item) => item.id === selectedId) ?? null;
  const canAddToRoster =
    !isInstructor &&
    capabilities.includes('booking:create:assisted') &&
    Boolean(bookingClient.searchRosterCandidates && bookingClient.create);
  const canRemoveFromRoster =
    !isInstructor &&
    capabilities.includes('booking:cancel:assisted') &&
    Boolean(bookingClient.cancelAsStaff);

  /**
   * Menekan kelas menampilkan pesertanya di bawah kalender, seperti mockup. Tanpa izin membaca
   * booking tidak ada peserta yang bisa ditampilkan, jadi panel detail kelas yang dibuka.
   */
  const pilihKelas = (slot: ClassSlot) => {
    if (!canReadBookings) {
      openPanel({ kind: 'detail', slot });
      return;
    }
    setSelectedId(slot.id);
  };

  const slotCard = (slot: ClassSlot) => {
    const isCancelled = slot.status === 'CANCELLED' || slot.status === 'AUTO_CANCELLED';
    const isDraft = slot.status === 'DRAFT';
    return (
      <button
        type="button"
        className={`w-full text-left rounded-xl border p-3 shadow-xs transition-all duration-200 flex flex-col gap-1.5 focus-visible:outline focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[#09371f] cursor-pointer hover:shadow-md ${
          isCancelled
            ? 'border-dd-danger/30 bg-dd-danger-soft/40 text-dd-danger opacity-80'
            : isDraft
              ? 'border-dd-warning/30 bg-dd-warning-soft/30 hover:border-dd-warning'
              : 'border-dd-border-interactive bg-white hover:border-dd-forest'
        }`}
        key={slot.id}
        onClick={() => openPanel({ kind: 'detail', slot })}
      >
        <div className="flex items-center justify-between gap-1.5 w-full flex-wrap xl:flex-col xl:items-start 2xl:flex-row 2xl:items-center 2xl:justify-between text-xs font-bold text-dd-ink">
          <span className="whitespace-nowrap">
            {formatBranchTime(slot.startAt, slot.timezone)}–
            {formatBranchTime(slot.endAt, slot.timezone)}
          </span>
          <StatusBadge tone={classStatusTone(slot.status)}>{statusLabels[slot.status]}</StatusBadge>
        </div>
        <div className="font-semibold text-sm text-dd-forest leading-snug">
          {classTypeName(slot.classTypeId, slot)}
        </div>
        <div className="text-xs text-dd-ink font-medium">
          {instructorName(slot.instructorUserId, slot)}
        </div>
        {globalMode && (
          <div className="text-[11px] text-dd-muted">{branchName(slot.branchId, slot)}</div>
        )}
        <div
          className={`mt-1 pt-1.5 border-t border-dd-line/60 text-[11px] flex items-center justify-between ${
            slot.bookedCount > slot.capacity
              ? 'text-red-700 font-semibold'
              : slot.bookedCount >= slot.capacity
                ? 'text-amber-700 font-medium'
                : 'text-dd-muted'
          }`}
        >
          {slot.bookedCount > slot.capacity ? (
            <span className="rounded bg-red-100 text-red-700 px-1 py-0.5 font-bold inline-flex items-center gap-0.5">
              <span>⚠️</span> {slot.bookedCount}/{slot.capacity} lewat kapasitas
            </span>
          ) : (
            <span>
              {slot.bookedCount}/{slot.capacity} terisi
            </span>
          )}
          <span>min. {slot.minimumQuota}</span>
        </div>
      </button>
    );
  };

  return (
    <section className="space-y-[22px]" aria-labelledby="classes-title">
      {week && (
        <TopBarSlot>
          <button
            type="button"
            aria-label="Minggu sebelumnya"
            onClick={() => setReference(shiftWeek(reference, -1))}
            className="flex size-11 items-center justify-center rounded-dd-sm border border-dd-border-interactive bg-white text-dd-ink transition hover:border-dd-forest"
          >
            <ChevronLeft className="size-[18px]" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => setReference(new Date())}
            className="min-h-11 rounded-dd-sm border border-dd-border-interactive bg-white px-4 text-[15px] font-bold text-dd-ink transition hover:border-dd-forest"
          >
            Minggu ini
          </button>
          <button
            type="button"
            aria-label="Minggu berikutnya"
            onClick={() => setReference(shiftWeek(reference, 1))}
            className="flex size-11 items-center justify-center rounded-dd-sm border border-dd-border-interactive bg-white text-dd-ink transition hover:border-dd-forest"
          >
            <ChevronRight className="size-[18px]" aria-hidden="true" />
          </button>
          <p
            className="m-0 ml-2 min-w-0 truncate font-display text-[19px] font-semibold text-dd-ink"
            aria-live="polite"
          >
            {week.label.replace(' – ', ' sampai ')}
          </p>
        </TopBarSlot>
      )}

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-[280px] flex-1">
          <h1
            id="classes-title"
            className="m-0 text-[26px] font-semibold tracking-[-0.02em] text-dd-ink"
          >
            {isInstructor ? 'Jadwal kelas saya' : 'Timetable kelas'}
          </h1>
          <p className="m-0 mt-1 max-w-4xl text-base text-dd-muted">
            {isInstructor
              ? 'Kelas yang Anda ajar di semua cabang Anda, pada waktu lokal studio. Nama cabang tertera di tiap kelas.'
              : `Pukul ${jamTeks(gridHours[0] ?? 9)} sampai ${jamTeks(
                  gridHours.at(-1) ?? 22,
                )}, satu minggu penuh. Tekan satu kelas untuk mengatur pesertanya.${
                  canManage
                    ? ' Kelas yang belum ada pesertanya bisa diseret ke jam lain.'
                    : ' Akses Anda hanya untuk melihat.'
                }${globalMode ? ' Menampilkan semua cabang; pilih cabang di bilah atas untuk fokus.' : ''}`}
          </p>
        </div>
        {!isInstructor && canManage && (
          // Jadwal rutin dan salin minggu dibuka dari sini, bukan dari menu samping.
          <div className="flex flex-wrap gap-2">
            <ButtonLink href="/workspace/classes/rutin" variant="secondary">
              Jadwal rutin
            </ButtonLink>
            <ButtonLink href="/workspace/classes/salin" variant="secondary">
              Salin minggu
            </ButtonLink>
          </div>
        )}
        {!isInstructor && (
          <Button
            disabled={!canCreateSlot}
            title={!canManage ? 'Akses membuat kelas memerlukan izin class-slot:manage' : undefined}
            onClick={() => openPanel({ kind: 'create' })}
          >
            Buat kelas
          </Button>
        )}
      </div>

      {branch && !isInstructor && (
        <EmptyWeeksNotice
          branchId={branch.id}
          timezone={branch.timezone}
          client={client}
          canFill={canOperate}
        />
      )}

      {busy && <Skeleton label="Memuat timetable kelas" />}
      {failure && <Feedback kind="error">{failure}</Feedback>}
      {message && !busy && <Feedback kind="status">{message}</Feedback>}
      {!busy && slots.length === 0 ? (
        <EmptyState
          title="Belum ada kelas pada minggu ini"
          description={
            isInstructor
              ? 'Belum ada kelas yang ditugaskan kepada Anda minggu ini. Coba minggu lain.'
              : 'Ubah minggu atau buat draft kelas baru.'
          }
        />
      ) : !busy && visible.length === 0 ? (
        <EmptyState
          title={
            batal > 0 && !classTypeFilter
              ? 'Semua kelas minggu ini batal'
              : 'Tidak ada kelas sesuai filter'
          }
          description="Ubah tipe kelas, minggu, atau tampilkan kelas batal."
          action={
            <div className="flex flex-wrap justify-center gap-2">
              {classTypeFilter && (
                <button
                  type="button"
                  onClick={() => setClassTypeFilter('')}
                  className="min-h-11 rounded-dd-lg border border-dd-border-interactive bg-white px-4 text-[15px] font-semibold text-dd-ink"
                >
                  Semua tipe
                </button>
              )}
              {batal > 0 && (
                <button
                  type="button"
                  onClick={() => setTampilBatal(true)}
                  className="min-h-11 rounded-dd-lg border border-dd-border-interactive bg-white px-4 text-[15px] font-semibold text-dd-ink"
                >
                  Tampilkan {batal} kelas batal
                </button>
              )}
            </div>
          }
        />
      ) : (
        <>
          {/* Tipe kelas dalam satu ketuk, seperti mockup. */}
          {(classTypeOptions.length > 1 || batal > 0) && (
            <div
              className="flex flex-wrap items-center gap-2"
              role="group"
              aria-label="Saring menurut tipe kelas"
            >
              {(classTypeOptions.length > 1
                ? [{ id: '', label: 'Semua tipe' }, ...classTypeOptions]
                : []
              ).map((opsi) => {
                const aktif = classTypeFilter === opsi.id;
                return (
                  <button
                    type="button"
                    aria-pressed={aktif}
                    onClick={() => setClassTypeFilter(opsi.id)}
                    className={`min-h-11 rounded-[9px] px-4 text-[15px] transition focus-visible:outline focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[#09371f] ${
                      aktif
                        ? 'border-0 bg-dd-forest font-bold text-white'
                        : 'border border-dd-border-interactive bg-white font-medium text-dd-ink hover:border-dd-forest'
                    }`}
                    key={opsi.id || 'semua'}
                  >
                    {opsi.label}
                  </button>
                );
              })}
              {batal > 0 && (
                <label className="ml-auto flex min-h-11 cursor-pointer items-center gap-2 text-[15px] text-dd-muted">
                  <input
                    type="checkbox"
                    checked={tampilBatal}
                    onChange={(e) => setTampilBatal(e.target.checked)}
                    className="size-4 accent-dd-forest"
                  />
                  Tampilkan {batal} kelas batal
                </label>
              )}
            </div>
          )}

          {/* Desktop: baris jam x kolom hari (≥ xl), lalu keterangan dan tombol simpan pemindahan. */}
          <div className="hidden xl:block">
            <div className="overflow-x-auto">
              <TimetableWeekGrid
                days={week?.days ?? []}
                hours={gridHours}
                todayKey={todayKey}
                slots={visible}
                posisi={posisi}
                tertunda={tertunda}
                selectedId={selectedId}
                canMove={canManage}
                namaTipe={(slot) => classTypeName(slot.classTypeId, slot)}
                namaInstruktur={(slot) => firstName(instructorName(slot.instructorUserId, slot))}
                onSelect={pilihKelas}
                onStage={stage}
              />
            </div>
            {canManage && (
              <TimetableMoveBar
                jumlahTertunda={Object.keys(tertunda).length}
                saving={savingMoves}
                onSave={() => void simpanPemindahan()}
                onCancel={() => setTertunda({})}
              />
            )}
          </div>

          {/* Peserta kelas terbuka di laci samping, di atas kalender: satu tekan, tanpa menggulir
              halaman, dan kalender tetap di tempatnya ketika laci ditutup. */}
          <Drawer
            open={Boolean(selectedSlot)}
            title={selectedSlot ? classTypeName(selectedSlot.classTypeId, selectedSlot) : ''}
            description={selectedSlot ? waktuKelas(selectedSlot) : undefined}
            onClose={() => setSelectedId(null)}
            className="max-w-xl"
          >
            {selectedSlot && (
              <TimetableRosterPanel
                key={selectedSlot.id}
                slot={selectedSlot}
                classTypeName={classTypeName(selectedSlot.classTypeId, selectedSlot)}
                instructorName={instructorName(selectedSlot.instructorUserId, selectedSlot)}
                studioName={studios.find((studio) => studio.id === selectedSlot.studioId)?.name}
                client={bookingClient}
                canAdd={canAddToRoster}
                canRemove={canRemoveFromRoster}
                canManageClass
                dalamLaci
                onManage={() => {
                  setSelectedId(null);
                  openPanel({ kind: 'detail', slot: selectedSlot });
                }}
                onChanged={() => void load()}
              />
            )}
          </Drawer>

          {/* Mobile & Tablet Agenda View with 1-Tap Day Filter (< xl) */}
          <div className="xl:hidden flex flex-col gap-4" aria-label="Agenda kelas mingguan">
            {/* Quick Day Selector Strip */}
            <div
              className="flex items-center gap-1.5 overflow-x-auto pb-2 no-scrollbar"
              role="group"
              aria-label="Pilih hari jadwal"
            >
              <button
                type="button"
                onClick={() => setSelectedMobileDay('ALL')}
                className={`shrink-0 rounded-full min-h-[44px] inline-flex items-center px-3.5 py-1.5 text-xs font-semibold transition focus-visible:outline focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[#09371f] ${
                  selectedMobileDay === 'ALL'
                    ? 'bg-dd-forest text-white shadow-xs'
                    : 'bg-dd-surface-muted text-dd-muted hover:text-dd-ink border border-dd-border-interactive'
                }`}
              >
                Semua ({visible.length})
              </button>
              {week?.days.map((day) => {
                const daySlots = grouped.get(day) ?? [];
                const isSelected = selectedMobileDay === day;
                const dayNum = day.slice(8, 10);
                const dayName = formatBranchDay(day, displayTimezone).slice(0, 3);
                const isToday = localDateKey(new Date(), displayTimezone) === day;
                return (
                  <button
                    key={day}
                    type="button"
                    onClick={() => setSelectedMobileDay(day)}
                    className={`shrink-0 rounded-full min-h-[44px] px-3 py-1.5 text-xs font-semibold transition inline-flex items-center gap-1.5 focus-visible:outline focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[#09371f] ${
                      isSelected
                        ? 'bg-dd-forest text-white shadow-xs'
                        : 'bg-dd-surface-muted text-dd-muted hover:text-dd-ink border border-dd-border-interactive'
                    }`}
                  >
                    {isToday && (
                      <span
                        className={`size-1.5 rounded-full ${isSelected ? 'bg-white' : 'bg-dd-forest'}`}
                        title="Hari ini"
                      />
                    )}
                    <span>
                      {dayName}, {dayNum}
                    </span>
                    <span
                      className={`text-[10px] px-1 rounded-full ${
                        isSelected ? 'bg-white/25 text-white' : 'bg-dd-line text-dd-muted'
                      }`}
                    >
                      {daySlots.length}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Day Cards: 1-col on mobile, 2-col on tablet if ALL is active */}
            <div
              className={
                selectedMobileDay === 'ALL'
                  ? 'grid grid-cols-1 md:grid-cols-2 gap-4'
                  : 'flex flex-col gap-4'
              }
            >
              {week?.days
                .filter((day) => selectedMobileDay === 'ALL' || selectedMobileDay === day)
                .map((day) => {
                  const daySlots = grouped.get(day) ?? [];
                  const isToday = localDateKey(new Date(), displayTimezone) === day;
                  return (
                    <section
                      key={day}
                      className={`rounded-2xl border bg-white p-4 shadow-xs flex flex-col gap-3 ${
                        isToday ? 'border-dd-forest/40 ring-1 ring-dd-forest/20' : 'border-dd-line'
                      }`}
                    >
                      <h2 className="text-sm font-bold text-dd-ink pb-2 border-b border-dd-line flex items-center justify-between">
                        <span className="flex items-center gap-1.5">
                          {formatBranchDay(day, displayTimezone)}
                          {isToday && (
                            <span className="rounded-full bg-dd-forest/10 text-dd-forest text-[10px] font-semibold px-2 py-0.5">
                              Hari ini
                            </span>
                          )}
                        </span>
                        <span className="text-xs font-normal text-dd-muted">
                          {daySlots.length} sesi
                        </span>
                      </h2>
                      <div className="flex flex-col gap-2.5">
                        {daySlots.length ? (
                          daySlots.map(slotCard)
                        ) : (
                          <p className="text-xs text-dd-muted italic py-2">
                            Tidak ada kelas pada hari ini.
                          </p>
                        )}
                      </div>
                    </section>
                  );
                })}
            </div>
          </div>
        </>
      )}

      <Drawer
        open={Boolean(panel)}
        title={
          panel?.kind === 'create'
            ? panel.template
              ? 'Duplikat kelas'
              : 'Buat draft kelas'
            : panel?.kind === 'detail'
              ? classTypeName(panel.slot.classTypeId, panel.slot)
              : 'Kelas'
        }
        description={
          panel?.kind === 'detail'
            ? `${formatBranchLongDate(panel.slot.startAt, panel.slot.timezone)} · ${branchName(panel.slot.branchId, panel.slot)}`
            : panel?.kind === 'create'
              ? branch?.name
                ? `${branch.name} · ${timezoneLabel(branch.timezone)}`
                : 'Pilih cabang dan konfigurasi jadwal kelas baru'
              : undefined
        }
        busy={busy}
        className={panel?.kind === 'detail' ? 'max-w-4xl' : undefined}
        dirty={panel?.kind === 'create' && panelDirty}
        onDirtyClose={() =>
          feedback.confirm({
            tone: 'warning',
            title: 'Batalkan pembuatan kelas?',
            message: 'Jadwal yang belum disimpan akan hilang.',
            confirmLabel: 'Buang input',
          })
        }
        onClose={closePanel}
        footer={
          panel?.kind === 'create' ? (
            <div className="grid gap-3">
              {failure && <Feedback kind="error">Kelas belum tersimpan. {failure}</Feedback>}
              <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  disabled={busy}
                  className="w-full sm:w-auto"
                  onClick={() =>
                    void (async () => {
                      if (
                        !panelDirty ||
                        (await feedback.confirm({
                          tone: 'warning',
                          title: 'Batalkan pembuatan kelas?',
                          message: 'Jadwal yang belum disimpan akan hilang.',
                          confirmLabel: 'Buang input',
                        }))
                      )
                        closePanel();
                    })()
                  }
                >
                  Batal
                </Button>
                <Button
                  type="submit"
                  form="class-slot-create-form"
                  loading={busy}
                  className="w-full sm:w-auto"
                >
                  Buat draft
                </Button>
              </div>
            </div>
          ) : undefined
        }
      >
        {panel?.kind === 'create' && (branch || (globalMode && branches.length > 0)) ? (
          <CreatePanel
            branchId={branch?.id ?? branches[0]?.id ?? ''}
            branches={branches}
            timezone={branch?.timezone ?? branches[0]?.timezone ?? displayTimezone}
            classTypes={classTypes}
            instructors={instructors}
            studios={studios}
            busy={busy}
            template={panel.template}
            onDirty={() => setPanelDirty(true)}
            onBranchChange={async (selectedBranchId) => {
              if (client.getBranchStudios) {
                try {
                  const branchStudios = await client.getBranchStudios(selectedBranchId);
                  setStudios((prev) => {
                    const others = prev.filter((s) => s.branchId !== selectedBranchId);
                    return [...others, ...branchStudios];
                  });
                } catch (err) {
                  console.error('Gagal memuat studio cabang:', err);
                }
              }
            }}
            onCreate={async (input) => {
              const accepted = await feedback.confirm({
                tone: 'warning',
                title: 'Buat draft kelas?',
                message: 'Jadwal akan dibuat sebagai draft.',
                confirmLabel: 'Buat draft',
              });
              if (!accepted) return;
              // Gagal (mis. jadwal bentrok): form tetap terbuka dengan isiannya dan pesan di bawahnya.
              if (await run(() => client.create(input), 'Draft kelas berhasil dibuat.'))
                closePanel();
            }}
          />
        ) : panel?.kind === 'detail' ? (
          <DetailPanel
            slot={panel.slot}
            branchCode={branch?.code ?? branches.find((b) => b.id === panel.slot.branchId)?.code}
            instructorName={instructorName(panel.slot.instructorUserId, panel.slot)}
            classTypes={classTypes}
            instructors={instructors}
            studios={studios}
            canManage={canOperate}
            canComplete={canCompleteClass}
            canManageAttendance={canOperateAttendance}
            canReadBookings={canReadBookings}
            canVerifyInstructor={canOperateAttendance && Boolean(client.verifyInstructorAttendance)}
            bookingClient={bookingClient}
            busy={busy}
            onDuplicate={() =>
              openPanel({ kind: 'create', template: duplicateTemplate(panel.slot) })
            }
            onDelete={() => setSlotToDelete(panel.slot)}
            onVerifyInstructor={async (notes) => {
              const accepted = await feedback.confirm({
                tone: 'warning',
                title: 'Verifikasi presensi instruktur?',
                message:
                  'Instruktur dicatat hadir pada kelas ini dan honornya dihitung sebagai terverifikasi. Tindakan ini tercatat atas nama Anda.',
                confirmLabel: 'Verifikasi',
              });
              if (!accepted) return;
              await run(async () => {
                const result = await client.verifyInstructorAttendance!(panel.slot.id, notes);
                return {
                  ...panel.slot,
                  instructorAttendance: { checkedInAt: result.checkedInAt, method: result.method },
                };
              }, 'Presensi instruktur berhasil dicatat.');
            }}
            onAssign={async (instructorId) => {
              const accepted = await feedback.confirm({
                tone: 'warning',
                title: 'Tetapkan instruktur?',
                message:
                  panel.slot.status === 'DRAFT'
                    ? 'Instruktur terpilih akan ditetapkan pada kelas ini.'
                    : 'Instruktur kelas akan diganti. Peserta yang sudah memesan akan melihat instruktur yang baru.',
                confirmLabel: 'Tetapkan',
              });
              if (accepted)
                await run(
                  () => client.assign(panel.slot.id, instructorId),
                  'Instruktur berhasil ditetapkan.',
                );
            }}
            onUpdate={async (input) => {
              const accepted = await feedback.confirm({
                tone: 'warning',
                title: 'Simpan perubahan kelas?',
                message:
                  'Jadwal draft dan konfigurasi kapasitas akan dihitung ulang. Perubahan dicatat dalam audit.',
                confirmLabel: 'Simpan perubahan',
              });
              if (accepted)
                await run(
                  () => client.update(panel.slot.id, input),
                  'Draft kelas berhasil diperbarui.',
                );
            }}
            onPublish={async () => {
              const accepted = await feedback.confirm({
                tone: 'warning',
                title: 'Publikasikan kelas?',
                message: 'Kelas akan tersedia pada katalog dan workflow booking.',
                confirmLabel: 'Publikasikan',
              });
              if (accepted)
                await run(
                  () => client.publish(panel.slot.id, panel.slot.version),
                  'Kelas berhasil dipublikasikan.',
                );
            }}
            onCancel={async (reason, note) => {
              const accepted = await feedback.confirm({
                tone: 'danger',
                title: 'Batalkan kelas?',
                message: 'Reservasi aktif akan dilepaskan dan tindakan dicatat dalam audit.',
                confirmLabel: 'Batalkan kelas',
              });
              if (accepted)
                await run(
                  () => client.cancel(panel.slot.id, reason, panel.slot.version, note || undefined),
                  'Kelas berhasil dibatalkan.',
                );
            }}
            onComplete={async (reason) => {
              setBusy(true);
              setFailure(undefined);
              try {
                const control = await client.completionControl(panel.slot.id);
                const accepted = await feedback.confirm({
                  tone: 'danger',
                  title: 'Selesaikan kelas?',
                  message: `${control.attendanceCount} hadir dan ${control.noShowCount} tidak hadir akan dicatat. ${control.activeReservationCount} reservasi aktif akan dipakai satu kali.`,
                  confirmLabel: 'Selesaikan kelas',
                });
                if (!accepted) return;
                const result = await client.complete(
                  panel.slot.id,
                  control.expectedVersion,
                  control.controlHash,
                  reason,
                );
                const updated = {
                  ...panel.slot,
                  status: 'COMPLETED' as const,
                  bookedCount: 0,
                  version: panel.slot.version + 1,
                };
                setSlots((current) =>
                  current.map((slot) => (slot.id === updated.id ? updated : slot)),
                );
                setPanel({ kind: 'detail', slot: updated });
                setMessage(
                  `Kelas selesai: ${result.attendanceCount} hadir, ${result.noShowCount ?? 0} no-show.`,
                );
              } catch (error) {
                setFailure(classSlotFailure(error));
              } finally {
                setBusy(false);
              }
            }}
          />
        ) : null}
      </Drawer>

      <LifecycleDialog
        request={
          slotToDelete
            ? {
                kind: 'class-slot',
                id: slotToDelete.id,
                name: `${classTypeName(slotToDelete.classTypeId, slotToDelete)} · ${formatBranchLongDate(slotToDelete.startAt, slotToDelete.timezone)} ${formatBranchTime(slotToDelete.startAt, slotToDelete.timezone)}`,
                action: 'delete',
              }
            : null
        }
        onClose={() => setSlotToDelete(null)}
        onDone={async (done) => {
          const removed = slotToDelete;
          setSlotToDelete(null);
          if (removed) setSlots((current) => current.filter((slot) => slot.id !== removed.id));
          closePanel();
          setFailure(undefined);
          setMessage(done);
        }}
      />
    </section>
  );
}
