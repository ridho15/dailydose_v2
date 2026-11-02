'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  browserBookingClient,
  bookingFailure,
  type BookingClient,
  type CheckInIssue,
} from '@/api-clients/booking-client';
import type {
  ClassSlot,
  ClassTypeOption,
  InstructorOption,
  StudioOption,
} from '@/api-clients/class-slot-client';
import { formatBranchTime, zonedLocalDateTime } from '@/lib/class-time';
import { Feedback, StatusBadge } from '../ui';
import { Button, ButtonLink } from '../components/actions';
import { SearchSelect, SelectInput, DateInput, Textarea, TextInput } from '../components/forms';
import { useAppFeedback } from '../components/app-feedback';
import { useSessionContext } from '../session-context';
import {
  cancellationLabels,
  cancellationReasonLabel,
  classStatusTone,
  statusLabels,
  statusSummaries,
  timezoneLabel,
  type CancellationReason,
} from './class-slot-presenters';
import { ActionRow, CapacityMeter, DetailSection, InfoItem } from './class-slot-detail-parts';
import { ClassRosterSection } from './class-roster-section';

type BranchOption = { id: string; code?: string; name: string; timezone: string };

/** Nilai awal form buat kelas, dipakai untuk menduplikasi kelas yang sudah ada. */
export type CreateTemplate = {
  classTypeId: string;
  studioId: string;
  roomId?: string | null;
  instructorUserId?: string | null;
  date: string;
  startTime: string;
  endTime: string;
};

export function CreatePanel({
  branchId,
  branches,
  timezone,
  classTypes,
  instructors,
  studios,
  busy,
  formId = 'class-slot-create-form',
  onDirty,
  onBranchChange,
  onCreate,
  template,
}: {
  template?: CreateTemplate;
  branchId: string;
  branches?: BranchOption[];
  timezone: string;
  classTypes: ClassTypeOption[];
  instructors: InstructorOption[];
  studios: StudioOption[];
  busy: boolean;
  formId?: string;
  onDirty?(): void;
  onBranchChange?(branchId: string): void;
  onCreate(input: {
    branchId: string;
    classTypeId: string;
    studioId: string;
    roomId?: string;
    instructorUserId?: string;
    startAt: Date;
    endAt: Date;
  }): Promise<void>;
}) {
  const [selectedBranchId, setSelectedBranchId] = useState(
    branchId || branches?.[0]?.id || '',
  );
  const [summary, setSummary] = useState(
    'Pilih tanggal dan waktu. Kuota dan kapasitas kelas akan disesuaikan otomatis berdasarkan tipe kelas yang dipilih.',
  );
  const [studioId, setStudioId] = useState(template?.studioId ?? '');
  const [startTime, setStartTime] = useState(template?.startTime ?? '');
  const [endTime, setEndTime] = useState(template?.endTime ?? '');

  useEffect(() => {
    if (template?.startTime) setStartTime(template.startTime);
    if (template?.endTime) setEndTime(template.endTime);
  }, [template?.startTime, template?.endTime]);

  const tambahMenit = (menit: number) => {
    if (!startTime) return;
    const [h, m] = startTime.split(':').map(Number);
    if (isNaN(h!) || isNaN(m!)) return;
    const totalMenit = h! * 60 + m! + menit;
    const jamBaru = Math.floor(totalMenit / 60) % 24;
    const menitBaru = totalMenit % 60;
    const pad = (n: number) => String(n).padStart(2, '0');
    setEndTime(`${pad(jamBaru)}:${pad(menitBaru)}`);
    onDirty?.();
  };

  const activeBranchTimezone =
    branches?.find((b) => b.id === selectedBranchId)?.timezone ?? timezone;

  // Filter pilihan sesuai cabang yang aktif dipilih pada form dan pastikan opsi unik
  const branchClassTypes = useMemo(() => {
    const scoped = classTypes.filter(
      (item) => !item.branchId || item.branchId === selectedBranchId,
    );
    const pool = scoped.length > 0 ? scoped : classTypes;
    return [...new Map(pool.map((item) => [item.id, item])).values()];
  }, [classTypes, selectedBranchId]);
  const branchStudios = studios.filter(
    (studio) => !studio.branchId || studio.branchId === selectedBranchId,
  );
  const branchInstructors = instructors.filter(
    (item) => !item.branchId || item.branchId === selectedBranchId,
  );

  // Auto-select studio bila cabang hanya punya 1 studio aktif
  useEffect(() => {
    if (!studioId && branchStudios.length === 1 && branchStudios[0]) {
      setStudioId(branchStudios[0].id);
    }
  }, [studioId, branchStudios]);

  const rooms = branchStudios.find((studio) => studio.id === studioId)?.rooms ?? [];

  return (
    <form
      id={formId}
      className="grid gap-4"
      aria-label="Form buat kelas"
      aria-busy={busy || undefined}
      onChange={onDirty}
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        try {
          const startAt = zonedLocalDateTime(
            String(data.get('date')),
            String(data.get('startTime')),
            activeBranchTimezone,
          );
          const endAt = zonedLocalDateTime(
            String(data.get('date')),
            String(data.get('endTime')),
            activeBranchTimezone,
          );
          void onCreate({
            branchId: selectedBranchId,
            classTypeId: String(data.get('classTypeId')),
            studioId: String(data.get('studioId')),
            roomId: String(data.get('roomId')) || undefined,
            instructorUserId: String(data.get('instructorUserId')) || undefined,
            startAt,
            endAt,
          });
        } catch {
          setSummary('Waktu selesai harus setelah waktu mulai dan valid pada timezone cabang.');
        }
      }}
    >
      {branches && branches.length > 1 && (
        <SearchSelect
          label="Cabang Studio"
          name="branchId"
          required
          value={selectedBranchId}
          placeholder="Pilih cabang studio"
          options={branches.map((item) => ({
            id: item.id,
            label: item.name,
            description: item.code,
          }))}
          onChange={(value) => {
            setSelectedBranchId(value);
            setStudioId('');
            onBranchChange?.(value);
          }}
        />
      )}
      <SearchSelect
        label="Tipe kelas"
        name="classTypeId"
        required
        defaultValue={template?.classTypeId}
        placeholder="Pilih tipe kelas"
        options={branchClassTypes.map((item) => ({
          id: item.id,
          label: item.name,
        }))}
      />
      <SearchSelect
        label="Area Studio"
        name="studioId"
        required
        value={studioId}
        placeholder={branchStudios.length ? 'Pilih area studio' : 'Tidak ada studio di cabang ini'}
        options={branchStudios.map((item) => {
          const b = branches?.find((br) => br.id === item.branchId);
          return {
            id: item.id,
            label: item.name,
            description: b ? `Cabang ${b.name}` : undefined,
          };
        })}
        onChange={setStudioId}
      />
      {branchStudios.length === 0 && (
        <Feedback kind="warning">
          Cabang ini belum memiliki Area Studio aktif. Silakan tambahkan Area Studio di menu Data Master &gt; Venues.
        </Feedback>
      )}
      <SearchSelect
        key={studioId || 'no-studio'}
        label="Ruangan"
        name="roomId"
        defaultValue={studioId === template?.studioId ? (template?.roomId ?? '') : ''}
        disabled={!studioId || rooms.length === 0}
        placeholder={rooms.length ? 'Opsional' : 'Tidak ada ruangan aktif'}
        options={rooms.map((item) => ({
          id: item.id,
          label: item.name,
          description: `${item.code}${item.capacity ? ` · kapasitas ${item.capacity}` : ''}`,
        }))}
      />
      <SearchSelect
        label="Instruktur"
        name="instructorUserId"
        defaultValue={template?.instructorUserId ?? ''}
        placeholder="Tetapkan nanti (Dapat disimpan sebagai Draft)"
        options={branchInstructors.map((item) => ({ id: item.id, label: item.displayName }))}
      />
      <div className="grid gap-3 sm:grid-cols-3">
        <DateInput label="Tanggal" name="date" defaultValue={template?.date} required />
        <TextInput
          label="Mulai"
          name="startTime"
          type="time"
          value={startTime}
          onChange={(e) => {
            setStartTime(e.target.value);
            onDirty?.();
          }}
          required
        />
        <div>
          <TextInput
            label="Selesai eksklusif"
            name="endTime"
            type="time"
            value={endTime}
            onChange={(e) => {
              setEndTime(e.target.value);
              onDirty?.();
            }}
            required
          />
          {startTime && (
            <div className="mt-1 flex items-center gap-1.5 text-xs text-dd-muted">
              <span>Durasi cepat:</span>
              <button
                type="button"
                onClick={() => tambahMenit(50)}
                className="rounded-dd-sm border border-dd-line bg-dd-surface px-2 py-0.5 font-semibold text-dd-ink hover:border-dd-forest cursor-pointer"
              >
                +50 mnt
              </button>
              <button
                type="button"
                onClick={() => tambahMenit(60)}
                className="rounded-dd-sm border border-dd-line bg-dd-surface px-2 py-0.5 font-semibold text-dd-ink hover:border-dd-forest cursor-pointer"
              >
                +60 mnt
              </button>
            </div>
          )}
        </div>
      </div>
      <Feedback kind="info">
        Timezone: {activeBranchTimezone}. {summary}
      </Feedback>
    </form>
  );
}

type SlotDetails = {
  studio?: { name?: string | null } | null;
  room?: { name?: string | null } | null;
  notes?: string | null;
};

export function DetailPanel({
  slot,
  branchCode,
  instructorName,
  classTypes,
  instructors,
  studios = [],
  canManage,
  canComplete,
  canManageAttendance,
  canReadBookings,
  canVerifyInstructor = false,
  isSuperOwner: isSuperOwnerProp,
  bookingClient = browserBookingClient,
  busy,
  onVerifyInstructor,
  onAssign,
  onUpdate,
  onPublish,
  onCancel,
  onComplete,
  onDuplicate,
  onDelete,
}: {
  onDuplicate?(): void;
  onDelete?(): void;
  slot: ClassSlot;
  branchCode?: string;
  instructorName: string;
  classTypes: ClassTypeOption[];
  instructors: InstructorOption[];
  studios?: StudioOption[];
  canManage: boolean;
  canComplete: boolean;
  canManageAttendance: boolean;
  canReadBookings: boolean;
  canVerifyInstructor?: boolean;
  isSuperOwner?: boolean;
  bookingClient?: Pick<BookingClient, 'list'> &
    Partial<
      Pick<
        BookingClient,
        | 'issueBulkCheckIns'
        | 'issueInstructorCheckIn'
        | 'cancelAsStaff'
        | 'cancellationOptions'
        | 'ajukanPembatalanTerlambat'
        | 'pembatalanTertunda'
        | 'putuskanPembatalan'
      >
    >;
  busy: boolean;
  onVerifyInstructor?(notes: string): Promise<void>;
  onAssign(id: string): Promise<void>;
  onUpdate(input: {
    classTypeId: string;
    studioId?: string;
    roomId?: string | null;
    instructorUserId?: string | null;
    startAt: Date;
    endAt: Date;
    capacity?: number;
    bookingCutoffHours?: number | null;
    reason?: string;
  }): Promise<void>;
  onPublish(): Promise<void>;
  onCancel(reason: CancellationReason, note?: string): Promise<void>;
  onComplete(reason: string): Promise<void>;
}) {
  const feedback = useAppFeedback();
  const sessionContext = useSessionContext();
  const isSuperOwner = isSuperOwnerProp ?? Boolean(sessionContext?.session?.roles?.includes('SUPER_OWNER'));
  const [instructorId, setInstructorId] = useState(slot.instructorUserId ?? '');
  const [reason, setReason] = useState<CancellationReason | ''>('');
  const [cancelNote, setCancelNote] = useState('');
  const [completionReason, setCompletionReason] = useState('');
  const [attendanceNote, setAttendanceNote] = useState('');
  const [editOpen, setEditOpen] = useState(false);
  const [issuing, setIssuing] = useState(false);
  const [issues, setIssues] = useState<CheckInIssue[]>([]);
  const [issueFailure, setIssueFailure] = useState('');
  const details = slot as ClassSlot & SlotDetails;
  const isDraft = slot.status === 'DRAFT';
  const isPublished = slot.status === 'PUBLISHED';
  const isConfirmed = slot.status === 'CONFIRMED';
  // Kelas baru bisa diselesaikan setelah jam selesainya; sistem juga menyelesaikannya otomatis.
  const sudahBerakhir = new Date(slot.endAt).getTime() <= Date.now();
  const isClosed = ['COMPLETED', 'CANCELLED', 'AUTO_CANCELLED'].includes(slot.status);
  const canRunClass = isConfirmed && (canComplete || canManageAttendance || canVerifyInstructor);
  const hasActions = isSuperOwner ? canManage : (canManage ? !isClosed : canRunClass);
  const cancelReasonLabel = cancellationReasonLabel(slot.cancellationReasonCode);
  const location = [details.studio?.name, details.room?.name].filter(Boolean).join(' · ');
  const assignRow = (
    <ActionRow
      title="Penugasan instruktur"
      description={slot.instructorUserId ? `Saat ini: ${instructorName}` : 'Belum ada instruktur.'}
      done={Boolean(slot.instructorUserId)}
    >
      <SearchSelect
        label="Instruktur"
        value={instructorId}
        placeholder="Pilih instruktur"
        options={instructors.map((item) => ({ id: item.id, label: item.displayName }))}
        onChange={setInstructorId}
      />
      <Button
        className="w-full sm:w-auto"
        disabled={busy || !instructorId || instructorId === slot.instructorUserId}
        onClick={() => void onAssign(instructorId)}
      >
        {isDraft || !slot.instructorUserId ? 'Tetapkan instruktur' : 'Ganti instruktur'}
      </Button>
    </ActionRow>
  );
  return (
    <div className="grid gap-4">
      <DetailSection
        id="class-summary-title"
        title="Ringkasan kelas"
        description={statusSummaries[slot.status]}
      >
        <div>
          <StatusBadge tone={classStatusTone(slot.status)}>{statusLabels[slot.status]}</StatusBadge>
        </div>
        <dl className="m-0 grid grid-cols-2 gap-x-4 gap-y-4 max-[359px]:grid-cols-1 sm:grid-cols-3">
          <InfoItem label="Waktu">
            {formatBranchTime(slot.startAt, slot.timezone)}–
            {formatBranchTime(slot.endAt, slot.timezone)} {timezoneLabel(slot.timezone)}
          </InfoItem>
          <InfoItem label="Instruktur">{instructorName}</InfoItem>
          <InfoItem label="Studio &amp; ruangan">{location || 'Belum diatur'}</InfoItem>
          <InfoItem label="Kapasitas" className="col-span-full">
            <CapacityMeter
              booked={slot.bookedCount}
              capacity={slot.capacity}
              minimum={slot.minimumQuota}
            />
          </InfoItem>
          <InfoItem label="Batas Booking (Cutoff)" className="col-span-full">
            <span className="font-semibold text-dd-ink text-sm">
              {slot.bookingCutoffHours != null
                ? `${slot.bookingCutoffHours} jam sebelum kelas (H-${Math.round(slot.bookingCutoffHours / 24) || 1})`
                : "Mengikuti konfigurasi default (Master Kuota / 24 Jam)"}
            </span>
          </InfoItem>
          {cancelReasonLabel && isClosed && (
            <InfoItem label="Alasan pembatalan" className="col-span-full">
              {cancelReasonLabel}
            </InfoItem>
          )}
          {details.notes && (
            <InfoItem label="Catatan" className="col-span-full">
              {details.notes}
            </InfoItem>
          )}
        </dl>
        {isPublished && slot.bookedCount < slot.minimumQuota && (
          <Feedback kind="warning">
            Belum mencapai kuota minimum ({slot.bookedCount} dari {slot.minimumQuota} peserta).
            Kelas dibatalkan otomatis bila kuota tidak terpenuhi pada batas waktu konfirmasi.
          </Feedback>
        )}
      </DetailSection>

      {!hasActions && !isClosed && (
        <Feedback kind="info">Anda hanya dapat melihat kelas ini.</Feedback>
      )}

      {isDraft && canManage && (
        <DetailSection
          id="class-prepare-title"
          title="Persiapan kelas"
          description="Lengkapi instruktur dan jadwal, lalu publikasikan agar pelanggan dapat memesan."
        >
          {assignRow}
          <ActionRow
            title="Jadwal dan tipe kelas"
            description="Ubah waktu, tipe kelas, atau instruktur selama kelas masih Draft. Kapasitas dihitung ulang dari konfigurasi."
          >
            <div>
              <Button
                variant="secondary"
                className="w-full sm:w-auto"
                disabled={busy}
                onClick={() => setEditOpen((current) => !current)}
              >
                {editOpen ? 'Tutup edit' : 'Edit kelas'}
              </Button>
            </div>
            {editOpen && (
              <DraftEditForm
                slot={slot}
                classTypes={classTypes}
                instructors={instructors}
                studios={studios}
                busy={busy}
                onSubmit={async (input) => {
                  await onUpdate(input);
                  setEditOpen(false);
                }}
              />
            )}
          </ActionRow>
          <ActionRow
            title="Publikasikan"
            description={
              slot.instructorUserId
                ? 'Kelas akan tampil di katalog dan dapat dipesan pelanggan.'
                : 'Tetapkan instruktur terlebih dahulu untuk mempublikasikan kelas.'
            }
          >
            <div>
              <Button
                className="w-full sm:w-auto"
                disabled={busy || !slot.instructorUserId}
                onClick={() => void onPublish()}
              >
                Publikasikan kelas
              </Button>
            </div>
          </ActionRow>
        </DetailSection>
      )}

      {(isPublished || isConfirmed || (isSuperOwner && slot.status === 'COMPLETED')) && canManage && (
        <DetailSection
          id="class-instructor-title"
          title="Instruktur kelas"
          description={
            isSuperOwner
              ? "Sebagai Super Admin, Anda dapat mengganti instruktur dan mengubah jadwal atau tipe kelas meskipun sudah ada peserta atau kelas sudah selesai."
              : "Instruktur dapat diganti selama kelas belum berjalan. Tipe kelas dan jadwal dapat diubah jika belum ada peserta yang memesan."
          }
        >
          {assignRow}
          {isSuperOwner ? (
            <ActionRow
              title={
                (slot.bookedCount ?? 0) > 0
                  ? 'Edit jadwal, tipe kelas & kapasitas (Super Admin)'
                  : slot.status === 'COMPLETED'
                  ? 'Koreksi jadwal kelas selesai (Super Admin)'
                  : 'Jadwal dan tipe kelas'
              }
              description={
                (slot.bookedCount ?? 0) > 0
                  ? `Kelas ini memiliki ${slot.bookedCount} peserta terdaftar. Sebagai Super Admin, Anda dapat mengubah jadwal, tipe kelas, instruktur, studio/ruangan, maupun kapasitas.`
                  : slot.status === 'COMPLETED'
                  ? 'Kelas sudah selesai. Sebagai Super Admin, Anda dapat mengoreksi data jadwal, tipe kelas, atau catatan historis kelas ini.'
                  : 'Ubah waktu, tipe kelas, studio, atau ruangan sebelum ada peserta yang memesan. Kapasitas dihitung ulang dari konfigurasi.'
              }
            >
              <div>
                <Button
                  variant="secondary"
                  className="w-full sm:w-auto"
                  disabled={busy}
                  onClick={() => setEditOpen((current) => !current)}
                >
                  {editOpen ? 'Tutup edit' : 'Edit kelas (Super Admin)'}
                </Button>
              </div>
              {editOpen && (
                <DraftEditForm
                  slot={slot}
                  classTypes={classTypes}
                  instructors={instructors}
                  studios={studios}
                  busy={busy}
                  isSuperOwner={isSuperOwner}
                  onSubmit={async (input) => {
                    await onUpdate(input);
                    setEditOpen(false);
                  }}
                />
              )}
            </ActionRow>
          ) : (slot.bookedCount ?? 0) === 0 ? (
            <ActionRow
              title="Jadwal dan tipe kelas"
              description="Ubah waktu, tipe kelas, studio, atau ruangan sebelum ada peserta yang memesan. Kapasitas dihitung ulang dari konfigurasi."
            >
              <div>
                <Button
                  variant="secondary"
                  className="w-full sm:w-auto"
                  disabled={busy}
                  onClick={() => setEditOpen((current) => !current)}
                >
                  {editOpen ? 'Tutup edit' : 'Edit kelas'}
                </Button>
              </div>
              {editOpen && (
                <DraftEditForm
                  slot={slot}
                  classTypes={classTypes}
                  instructors={instructors}
                  studios={studios}
                  busy={busy}
                  isSuperOwner={isSuperOwner}
                  onSubmit={async (input) => {
                    await onUpdate(input);
                    setEditOpen(false);
                  }}
                />
              )}
            </ActionRow>
          ) : (slot.bookedCount ?? 0) > 0 ? (
            <ActionRow
              title="Kapasitas & penyesuaian kelas"
              description={`${slot.bookedCount} peserta sudah memesan kelas ini. Jadwal dan tipe kelas terkunci, namun Anda dapat menyesuaikan kapasitas slot atau batas cutoff.`}
            >
              <div>
                <Button
                  variant="secondary"
                  className="w-full sm:w-auto"
                  disabled={busy}
                  onClick={() => setEditOpen((current) => !current)}
                >
                  {editOpen ? 'Tutup edit' : 'Ubah kapasitas kelas'}
                </Button>
              </div>
              {editOpen && (
                <DraftEditForm
                  slot={slot}
                  classTypes={classTypes}
                  instructors={instructors}
                  studios={studios}
                  busy={busy}
                  isSuperOwner={isSuperOwner}
                  onSubmit={async (input) => {
                    await onUpdate(input);
                    setEditOpen(false);
                  }}
                />
              )}
            </ActionRow>
          ) : null}
        </DetailSection>
      )}

      {(isConfirmed || slot.status === 'COMPLETED') && slot.instructorUserId && (
        <DetailSection id="instructor-attendance-title" title="Presensi instruktur">
          {slot.instructorAttendance ? (
            <Feedback kind="status">
              Tercatat{' '}
              {formatBranchTime(new Date(slot.instructorAttendance.checkedInAt), slot.timezone)}{' '}
              melalui{' '}
              {slot.instructorAttendance.method === 'QR_SCAN' ? 'scan QR' : 'verifikasi manual admin'}
              .
            </Feedback>
          ) : (
            <>
              <p className="m-0 text-sm text-dd-muted">
                Belum tercatat. Honor kelas ini ditandai &quot;belum terverifikasi&quot; di laporan
                keuangan sampai presensi instruktur dicatat.
              </p>
              {isConfirmed && !canManageAttendance && (
                <div className="mt-3 flex flex-col justify-between gap-3 rounded-dd-md border border-dd-line bg-dd-surface-muted p-4 sm:flex-row sm:items-center">
                  <span className="text-sm text-dd-muted">
                    Tunjukkan QR Anda ke staf di meja check-in saat tiba di studio.
                  </span>
                  <ButtonLink
                    variant="primary"
                    size="sm"
                    href="/check-in-pass"
                    className="w-full shrink-0 sm:w-auto"
                  >
                    Tampilkan QR saya
                  </ButtonLink>
                </div>
              )}
              {isConfirmed && canManageAttendance && (
                <div className="mt-3 flex flex-col justify-between gap-3 rounded-dd-md border border-dd-line bg-dd-surface-muted p-4 sm:flex-row sm:items-center">
                  <span className="text-sm text-dd-muted">
                    Pindai QR instruktur di halaman Check-in saat ia tiba.
                  </span>
                  <ButtonLink
                    variant="secondary"
                    size="sm"
                    href="/workspace/check-in"
                    className="w-full shrink-0 sm:w-auto"
                  >
                    Buka Check-in
                  </ButtonLink>
                </div>
              )}
              {canVerifyInstructor && onVerifyInstructor && (
                <>
                  <TextInput
                    label="Catatan (opsional)"
                    value={attendanceNote}
                    maxLength={255}
                    placeholder="Contoh: instruktur lupa scan, hadir sesuai daftar peserta"
                    onChange={(event) => setAttendanceNote(event.target.value)}
                  />
                  <div>
                    <Button
                      variant="secondary"
                      className="w-full sm:w-auto"
                      disabled={busy}
                      onClick={() => void onVerifyInstructor(attendanceNote.trim())}
                    >
                      Verifikasi presensi instruktur
                    </Button>
                  </div>
                </>
              )}
            </>
          )}
        </DetailSection>
      )}

      {isConfirmed && canManageAttendance && (
        <DetailSection
          id="class-qr-title"
          title="QR check-in peserta"
          description="Terbitkan pass QR untuk seluruh booking aktif. Setiap pelanggan dikirim lewat tombol WhatsApp masing-masing; browser tidak membuka banyak jendela sekaligus."
        >
          <div>
            <Button
              className="w-full sm:w-auto"
              disabled={busy || issuing}
              onClick={() => {
                const issueBulk = bookingClient.issueBulkCheckIns;
                if (!issueBulk) return;
                void feedback
                  .confirm({
                    tone: 'warning',
                    title: 'Buat QR untuk semua peserta?',
                    message:
                      'Pass diterbitkan per booking aktif. Kegagalan satu pelanggan tidak membatalkan hasil lainnya.',
                    confirmLabel: 'Terbitkan QR',
                  })
                  .then((accepted) => {
                    if (!accepted) return;
                    setIssuing(true);
                    setIssueFailure('');
                    void issueBulk(slot.id, undefined, crypto.randomUUID())
                      .then((response) => {
                        setIssues(
                          response.items.flatMap((item) =>
                            item.ok && item.result ? [item.result] : [],
                          ),
                        );
                        const failures = response.items.filter((item) => !item.ok);
                        if (failures.length)
                          setIssueFailure(
                            `${failures.length} booking tidak dapat diterbitkan. Booking lain tetap berhasil.`,
                          );
                      })
                      .catch(async (error) => setIssueFailure(await bookingFailure(error)))
                      .finally(() => setIssuing(false));
                  });
              }}
            >
              {issuing ? 'Menerbitkan…' : 'Buat QR untuk semua peserta'}
            </Button>
          </div>
          {issueFailure && <Feedback kind="warning">{issueFailure}</Feedback>}
          {issues.length > 0 && (
            <ul className="m-0 grid list-none gap-2 p-0" aria-label="QR peserta siap dikirim">
              {issues.map((issue) => (
                <li
                  key={issue.bookingId}
                  className="rounded-dd-md border border-dd-line bg-dd-surface-muted p-3"
                >
                  <strong className="block text-sm">
                    {issue.maskedCustomerPhone ?? 'Tanpa WhatsApp'}
                  </strong>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {issue.whatsappUrl && (
                      <ButtonLink
                        href={issue.whatsappUrl}
                        target="_blank"
                        rel="noreferrer"
                        size="sm"
                      >
                        Buka WhatsApp
                      </ButtonLink>
                    )}
                    {issue.passUrl && (
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => void navigator.clipboard.writeText(issue.passUrl!)}
                      >
                        Salin link
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </DetailSection>
      )}

      {(isPublished || isConfirmed) && sudahBerakhir && canComplete && (
        <DetailSection
          id="class-complete-title"
          title="Selesaikan kelas"
          description="Peserta tanpa presensi dicatat tidak hadir (tanpa check-in palsu), sesi yang dicadangkan dipakai satu kali, dan buku sesi diperbarui sekaligus. Sistem memeriksa ulang daftar peserta sebelum menyimpan."
        >
          <TextInput
            label="Alasan penyelesaian"
            value={completionReason}
            placeholder="Tulis alasan penyelesaian (minimal 3 karakter)"
            onChange={(event) => setCompletionReason(event.target.value)}
          />
          <div>
            <Button
              className="w-full sm:w-auto"
              disabled={busy || completionReason.trim().length < 3}
              onClick={() => void onComplete(completionReason.trim())}
            >
              Tinjau dan selesaikan kelas
            </Button>
          </div>
        </DetailSection>
      )}

      <ClassRosterSection
        slot={slot}
        showAvailable={!isClosed}
        canReadBookings={canReadBookings}
        bookingClient={bookingClient}
      />

      {/* Kelas terkonfirmasi juga bisa dibatalkan (API mengizinkan), misalnya jadwal lama yang diganti. */}
      {(isDraft || isPublished || isConfirmed) && canManage && (
        <DetailSection
          id="class-cancel-title"
          tone="danger"
          title="Batalkan kelas"
          description={
            slot.bookedCount > 0
              ? `Kelas ini punya ${slot.bookedCount} peserta aktif. Reservasi sesi mereka dilepas, notifikasi otomatis dikirim via WhatsApp ke seluruh peserta & instruktur, dan pembatalan dicatat dalam audit. Tindakan ini tidak dapat diurungkan.`
              : 'Belum ada peserta aktif. Pembatalan dicatat dalam audit dan tidak dapat diurungkan.'
          }
        >
          <SelectInput
            label="Alasan pembatalan"
            value={reason}
            onChange={(event) => setReason(event.target.value as CancellationReason | '')}
          >
            <option value="">Pilih alasan</option>
            {Object.entries(cancellationLabels).map(([value, label]) => (
              <option value={value} key={value}>
                {label}
              </option>
            ))}
          </SelectInput>
          {reason === 'OTHER_REVIEW_REQUIRED' && (
            <Textarea
              label="Jelaskan alasan pembatalan"
              value={cancelNote}
              maxLength={500}
              required
              placeholder="Minimal 3 karakter"
              onChange={(event) => setCancelNote(event.target.value)}
            />
          )}
          <div>
            <Button
              variant="danger"
              className="w-full sm:w-auto"
              disabled={busy || !reason || (reason === 'OTHER_REVIEW_REQUIRED' && cancelNote.trim().length < 3)}
              onClick={() => {
                if (reason) void onCancel(reason, reason === 'OTHER_REVIEW_REQUIRED' ? cancelNote.trim() : undefined);
              }}
            >
              Batalkan kelas ini
            </Button>
          </div>
        </DetailSection>
      )}

      {canManage && onDuplicate && (
        <DetailSection
          id="class-duplicate-title"
          title="Duplikat kelas"
          description="Buat draft kelas baru dengan tipe, studio, ruangan, dan instruktur yang sama, dijadwalkan satu minggu kemudian. Anda dapat mengubahnya sebelum disimpan."
        >
          <div>
            <Button variant="secondary" className="w-full sm:w-auto" disabled={busy} onClick={onDuplicate}>
              Duplikat sebagai draft
            </Button>
          </div>
        </DetailSection>
      )}

      {canManage && onDelete && (isDraft || slot.status === 'CANCELLED') && (
        <DetailSection
          id="class-delete-title"
          tone="danger"
          title="Hapus jadwal kelas"
          description={
            isDraft
              ? 'Draft yang salah dibuat dapat dihapus permanen. Penghapusan dicatat dalam audit dan tidak dapat diurungkan.'
              : 'Kelas batal yang tidak punya booking atau catatan terkait dapat dihapus permanen. Bila masih ada data terkait, kelas dipertahankan sebagai riwayat.'
          }
        >
          <div>
            <Button variant="danger" className="w-full sm:w-auto" disabled={busy} onClick={onDelete}>
              Hapus jadwal kelas
            </Button>
          </div>
        </DetailSection>
      )}
    </div>
  );
}

function DraftEditForm({
  slot,
  classTypes,
  instructors,
  studios = [],
  busy,
  isSuperOwner = false,
  onSubmit,
}: {
  slot: ClassSlot;
  classTypes: ClassTypeOption[];
  instructors: InstructorOption[];
  studios?: StudioOption[];
  busy: boolean;
  isSuperOwner?: boolean;
  onSubmit(input: {
    classTypeId: string;
    studioId?: string;
    roomId?: string | null;
    instructorUserId?: string | null;
    startAt: Date;
    endAt: Date;
    capacity?: number;
    bookingCutoffHours?: number | null;
    reason?: string;
  }): Promise<void>;
}) {
  const parts = (value: Date) => {
    const formatted = new Intl.DateTimeFormat('en-CA', {
      timeZone: slot.timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(value);
    const get = (type: Intl.DateTimeFormatPartTypes) =>
      formatted.find((part) => part.type === type)?.value ?? '';
    return {
      date: `${get('year')}-${get('month')}-${get('day')}`,
      time: `${get('hour')}:${get('minute')}`,
    };
  };
  const start = parts(slot.startAt);
  const end = parts(slot.endAt);
  const [failure, setFailure] = useState('');
  const branchStudios = studios.filter(
    (studio) => !studio.branchId || studio.branchId === slot.branchId,
  );
  const [selectedStudioId, setSelectedStudioId] = useState(
    slot.studioId ?? branchStudios[0]?.id ?? '',
  );
  const [selectedRoomId, setSelectedRoomId] = useState(slot.roomId ?? '');
  const rooms = branchStudios.find((studio) => studio.id === selectedStudioId)?.rooms ?? [];
  const hasBookings = (slot.status === 'PUBLISHED' || slot.status === 'CONFIRMED') && (slot.bookedCount ?? 0) > 0;
  const isLockedForNormalStaff = !isSuperOwner && hasBookings;

  const branchClassTypes = useMemo(() => {
    const scoped = classTypes.filter(
      (item) => !item.branchId || item.branchId === slot.branchId,
    );
    const pool = scoped.length > 0 ? scoped : classTypes;
    const unique = [...new Map(pool.map((item) => [item.id, item])).values()];
    const currentName = (slot as { classType?: { name?: string | null } }).classType?.name;
    if (slot.classTypeId && !unique.some((item) => item.id === slot.classTypeId)) {
      unique.unshift({
        id: slot.classTypeId,
        code: slot.classTypeId.slice(0, 8),
        name: currentName || 'Tipe kelas saat ini',
        branchId: slot.branchId,
      });
    }
    return unique;
  }, [classTypes, slot.branchId, slot.classTypeId, (slot as { classType?: { name?: string | null } }).classType?.name]);

  const branchInstructors = useMemo(() => {
    const scoped = instructors.filter(
      (item) => !item.branchId || item.branchId === slot.branchId,
    );
    const pool = scoped.length > 0 ? scoped : instructors;
    const unique = [...new Map(pool.map((item) => [item.id, item])).values()];
    const currentName = (slot as { instructor?: { displayName?: string | null } }).instructor?.displayName;
    if (slot.instructorUserId && !unique.some((item) => item.id === slot.instructorUserId)) {
      unique.unshift({
        id: slot.instructorUserId,
        displayName: currentName || 'Instruktur saat ini',
        branchId: slot.branchId,
      });
    }
    return unique;
  }, [instructors, slot.branchId, slot.instructorUserId, (slot as { instructor?: { displayName?: string | null } }).instructor?.displayName]);

  return (
    <form
      className="grid gap-3 rounded-dd-md border border-dd-line bg-dd-surface p-4"
      aria-label="Edit draft kelas"
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        if (isLockedForNormalStaff) {
          setFailure('');
          const rawCap = String(data.get('capacity') ?? '').trim();
          const parsedCap = rawCap ? Number(rawCap) : undefined;
          if (parsedCap !== undefined && (parsedCap < (slot.bookedCount ?? 0) || parsedCap < 1)) {
            setFailure(`Kapasitas tidak boleh kurang dari jumlah peserta terdaftar (${slot.bookedCount ?? 0}).`);
            return;
          }
          const rawCutoff = String(data.get('bookingCutoffHours') ?? '').trim();
          const parsedCutoff = rawCutoff === 'default' || rawCutoff === '' ? null : Number(rawCutoff);

          void onSubmit({
            classTypeId: slot.classTypeId,
            studioId: slot.studioId || undefined,
            roomId: slot.roomId || null,
            instructorUserId: slot.instructorUserId || null,
            startAt: slot.startAt,
            endAt: slot.endAt,
            capacity: parsedCap,
            bookingCutoffHours: parsedCutoff,
            reason: String(data.get('reason') ?? '').trim() || undefined,
          });
          return;
        }
        try {
          const startAt = zonedLocalDateTime(
            String(data.get('date')),
            String(data.get('startTime')),
            slot.timezone,
          );
          let endAt = zonedLocalDateTime(
            String(data.get('date')),
            String(data.get('endTime')),
            slot.timezone,
          );
          if (
            endAt <= startAt &&
            localDatePart(slot.endAt, slot.timezone) !== localDatePart(slot.startAt, slot.timezone)
          ) {
            endAt = new Date(endAt.getTime() + 24 * 60 * 60 * 1000);
          }
          if (endAt <= startAt) throw new Error('INVALID_RANGE');
          setFailure('');
          const rawCap = String(data.get('capacity') ?? '').trim();
          const parsedCap = rawCap ? Number(rawCap) : undefined;
          if (parsedCap !== undefined && (parsedCap < (slot.bookedCount ?? 0) || parsedCap < 1)) {
            setFailure(`Kapasitas tidak boleh kurang dari jumlah peserta terdaftar (${slot.bookedCount ?? 0}).`);
            return;
          }
          const rawCutoff = String(data.get('bookingCutoffHours') ?? '').trim();
          const parsedCutoff = rawCutoff === 'default' || rawCutoff === '' ? null : Number(rawCutoff);

          void onSubmit({
            classTypeId: String(data.get('classTypeId') || slot.classTypeId),
            studioId: selectedStudioId || undefined,
            roomId: selectedRoomId || null,
            instructorUserId: String(data.get('instructorUserId') ?? '').trim() || null,
            startAt,
            endAt,
            capacity: parsedCap,
            bookingCutoffHours: parsedCutoff,
            reason: String(data.get('reason') ?? '').trim() || undefined,
          });
        } catch {
          setFailure('Waktu selesai harus setelah waktu mulai.');
        }
      }}
    >
      {isSuperOwner && (slot.bookedCount ?? 0) > 0 && (
        <Feedback kind="warning">
          <strong>Mode Super Admin:</strong> Kelas ini memiliki {slot.bookedCount} peserta terdaftar. Anda memiliki wewenang untuk mengubah jadwal, tipe kelas, atau ruangan. Perubahan jadwal akan otomatis memengaruhi jadwal tiket peserta.
        </Feedback>
      )}
      {isSuperOwner && slot.status === 'COMPLETED' && (
        <Feedback kind="info">
          <strong>Mode Super Admin:</strong> Anda mengoreksi data jadwal, tipe kelas, atau ruangan untuk kelas yang statusnya sudah selesai.
        </Feedback>
      )}
      {isLockedForNormalStaff && (
        <Feedback kind="warning">
          Kelas ini sudah memiliki {slot.bookedCount} peserta yang booking. Jadwal, tipe kelas, dan ruangan dikunci untuk kenyamanan peserta, namun kapasitas tempat/bed dapat disesuaikan (minimal {slot.bookedCount} peserta).
        </Feedback>
      )}
      <SearchSelect
        label="Tipe kelas"
        name="classTypeId"
        defaultValue={slot.classTypeId}
        required
        disabled={isLockedForNormalStaff}
        options={branchClassTypes.map((item) => ({
          id: item.id,
          label: item.name,
          description: item.code,
        }))}
      />
      {branchStudios.length > 0 && (
        <>
          <SearchSelect
            label="Area Studio"
            name="studioId"
            value={selectedStudioId}
            disabled={isLockedForNormalStaff}
            placeholder="Pilih area studio"
            options={branchStudios.map((item) => ({
              id: item.id,
              label: item.name,
            }))}
            onChange={(val) => {
              setSelectedStudioId(val);
              setSelectedRoomId('');
            }}
          />
          <SearchSelect
            key={selectedStudioId || 'no-studio'}
            label="Ruangan"
            name="roomId"
            value={selectedRoomId}
            disabled={isLockedForNormalStaff || !selectedStudioId || rooms.length === 0}
            placeholder={rooms.length ? 'Opsional' : 'Tidak ada ruangan aktif'}
            options={rooms.map((item) => ({
              id: item.id,
              label: item.name,
              description: `${item.code}${item.capacity ? ` · kapasitas ${item.capacity}` : ''}`,
            }))}
            onChange={setSelectedRoomId}
          />
        </>
      )}
      <SearchSelect
        label="Instruktur"
        name="instructorUserId"
        defaultValue={slot.instructorUserId ?? ''}
        placeholder="Tetapkan nanti"
        disabled={isLockedForNormalStaff}
        options={branchInstructors.map((item) => ({ id: item.id, label: item.displayName }))}
      />
      <div className="grid gap-3 sm:grid-cols-3">
        <DateInput label="Tanggal" name="date" defaultValue={start.date} disabled={isLockedForNormalStaff} required={!isLockedForNormalStaff} />
        <TextInput label="Mulai" name="startTime" type="time" defaultValue={start.time} disabled={isLockedForNormalStaff} required={!isLockedForNormalStaff} />
        <TextInput label="Selesai" name="endTime" type="time" defaultValue={end.time} disabled={isLockedForNormalStaff} required={!isLockedForNormalStaff} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <TextInput
          label="Kapasitas Slot (Peserta)"
          name="capacity"
          type="number"
          min={slot.bookedCount ?? 1}
          max={99}
          defaultValue={String(slot.capacity)}
          description={`Minimal ${slot.bookedCount ?? 0} peserta (jumlah saat ini).`}
        />
        <SelectInput
          label="Batas Booking Terakhir (Cutoff)"
          name="bookingCutoffHours"
          defaultValue={slot.bookingCutoffHours != null ? String(slot.bookingCutoffHours) : "default"}
          description="Batas waktu terakhir member dapat booking kelas ini."
        >
          <option value="default">Default Sistem / Kuota Cabang (H-1)</option>
          <option value="2">2 Jam Sebelum Kelas (Last-minute)</option>
          <option value="12">12 Jam Sebelum Kelas</option>
          <option value="24">24 Jam Sebelum Kelas (H-1)</option>
          <option value="48">48 Jam Sebelum Kelas (H-2)</option>
          <option value="72">72 Jam Sebelum Kelas (H-3)</option>
        </SelectInput>
      </div>
      <TextInput
        label="Alasan perubahan (opsional)"
        name="reason"
        minLength={3}
        maxLength={500}
        placeholder="Contoh: penyesuaian jadwal studio"
      />
      {failure && <Feedback kind="error">{failure}</Feedback>}
      <div>
        <Button type="submit" className="w-full sm:w-auto" loading={busy}>
          Simpan perubahan kelas
        </Button>
      </div>
    </form>
  );
}

function localDatePart(value: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}
