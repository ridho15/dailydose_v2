'use client';

import { useEffect, useRef, useState } from 'react';
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

  const activeBranchTimezone =
    branches?.find((b) => b.id === selectedBranchId)?.timezone ?? timezone;

  // Filter pilihan sesuai cabang yang aktif dipilih pada form
  const branchClassTypes = classTypes.filter(
    (item) => !item.branchId || item.branchId === selectedBranchId,
  );
  const branchStudios = studios.filter(
    (studio) => !studio.branchId || studio.branchId === selectedBranchId,
  );
  const branchInstructors = instructors.filter(
    (item) => !item.branchId || item.branchId === selectedBranchId,
  );

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
        placeholder="Tetapkan nanti"
        options={branchInstructors.map((item) => ({ id: item.id, label: item.displayName }))}
      />
      <div className="grid gap-3 sm:grid-cols-3">
        <DateInput label="Tanggal" name="date" defaultValue={template?.date} required />
        <TextInput label="Mulai" name="startTime" type="time" defaultValue={template?.startTime} required />
        <TextInput
          label="Selesai eksklusif"
          name="endTime"
          type="time"
          defaultValue={template?.endTime}
          required
        />
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
    reason?: string;
  }): Promise<void>;
  onPublish(): Promise<void>;
  onCancel(reason: CancellationReason, note?: string): Promise<void>;
  onComplete(reason: string): Promise<void>;
}) {
  const feedback = useAppFeedback();
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
  const isClosed = ['COMPLETED', 'CANCELLED', 'AUTO_CANCELLED'].includes(slot.status);
  const canRunClass = isConfirmed && (canComplete || canManageAttendance || canVerifyInstructor);
  const hasActions = canManage ? !isClosed : canRunClass;
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

      {(isPublished || isConfirmed) && canManage && (
        <DetailSection
          id="class-instructor-title"
          title="Instruktur kelas"
          description="Instruktur dapat diganti selama kelas belum berjalan. Tipe kelas dan jadwal dapat diubah jika belum ada peserta yang memesan."
        >
          {assignRow}
          {(isPublished || isConfirmed) && (slot.bookedCount ?? 0) === 0 ? (
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
                  onSubmit={async (input) => {
                    await onUpdate(input);
                    setEditOpen(false);
                  }}
                />
              )}
            </ActionRow>
          ) : (isPublished || isConfirmed) && (slot.bookedCount ?? 0) > 0 ? (
            <ActionRow
              title="Jadwal dan tipe kelas"
              description={`${slot.bookedCount} peserta sudah memesan kelas ini. Tipe kelas dan jadwal terkunci untuk melindungi jadwal peserta.`}
            >
              <div>
                <Button
                  variant="secondary"
                  className="w-full sm:w-auto opacity-60"
                  disabled
                  title="Jadwal dan tipe kelas terkunci karena sudah ada peserta yang booking"
                >
                  Edit kelas (Terkunci)
                </Button>
              </div>
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

      {isConfirmed && canComplete && (
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

      {(isDraft || isPublished) && canManage && (
        <DetailSection
          id="class-cancel-title"
          tone="danger"
          title="Batalkan kelas"
          description={
            slot.bookedCount > 0
              ? `Kelas ini punya ${slot.bookedCount} peserta aktif. Reservasi sesi mereka dilepas dan pembatalan dicatat dalam audit. Tindakan ini tidak dapat diurungkan.`
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
  onSubmit,
}: {
  slot: ClassSlot;
  classTypes: ClassTypeOption[];
  instructors: InstructorOption[];
  studios?: StudioOption[];
  busy: boolean;
  onSubmit(input: {
    classTypeId: string;
    studioId?: string;
    roomId?: string | null;
    instructorUserId?: string | null;
    startAt: Date;
    endAt: Date;
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

  return (
    <form
      className="grid gap-3 rounded-dd-md border border-dd-line bg-dd-surface p-4"
      aria-label="Edit draft kelas"
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
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
          void onSubmit({
            classTypeId: String(data.get('classTypeId') || slot.classTypeId),
            studioId: selectedStudioId || undefined,
            roomId: selectedRoomId || null,
            instructorUserId: String(data.get('instructorUserId') ?? '').trim() || null,
            startAt,
            endAt,
            reason: String(data.get('reason') ?? '').trim() || undefined,
          });
        } catch {
          setFailure('Waktu selesai harus setelah waktu mulai.');
        }
      }}
    >
      <SearchSelect
        label="Tipe kelas"
        name="classTypeId"
        defaultValue={slot.classTypeId}
        required
        options={classTypes.map((item) => ({
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
            disabled={!selectedStudioId || rooms.length === 0}
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
        options={instructors.map((item) => ({ id: item.id, label: item.displayName }))}
      />
      <div className="grid gap-3 sm:grid-cols-3">
        <DateInput label="Tanggal" name="date" defaultValue={start.date} required />
        <TextInput label="Mulai" name="startTime" type="time" defaultValue={start.time} required />
        <TextInput label="Selesai" name="endTime" type="time" defaultValue={end.time} required />
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
