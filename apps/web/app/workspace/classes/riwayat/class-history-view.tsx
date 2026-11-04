'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import {
  browserClassSlotClient,
  classSlotFailure,
  type ClassSlotClient,
  type RiwayatKelasItem,
} from '../../../api-clients/class-slot-client';
import { AdminPageHeader } from '../../../components/admin/admin-page-header';
import { Badge, DataTable, FilterBar, Panel } from '../../../components/admin/admin-ui';
import { Button, ButtonLink } from '../../../components/actions';
import { useAppFeedback } from '../../../components/app-feedback';
import { CheckboxInput, SelectInput, TextInput } from '../../../components/forms';
import { formatBranchDay, formatBranchTime, localDateKey, zonedLocalDateTime } from '../../../lib/class-time';
import { useSessionContext } from '../../../session-context';
import { Feedback } from '../../../ui';
import { statusLabels } from '../../../classes/class-slot-presenters';

const DAY_MS = 86_400_000;
const STATUS_TONE: Record<string, 'success' | 'warning' | 'danger' | 'neutral'> = {
  COMPLETED: 'success',
  PUBLISHED: 'warning',
  CONFIRMED: 'warning',
  CANCELLED: 'danger',
  AUTO_CANCELLED: 'danger',
};
const BISA_DISELESAIKAN = ['PUBLISHED', 'CONFIRMED'];

/**
 * Riwayat kelas yang sudah lewat untuk staf: siapa hadir, apakah instruktur tercatat hadir, dan
 * apakah honornya terhitung. Dua aksi langsung dari baris: catat presensi instruktur dan selesaikan
 * kelas, supaya kelas yang tertinggal tidak perlu dicari satu per satu di timetable.
 */
export function ClassHistoryView({
  client = browserClassSlotClient,
  initialNow,
}: {
  client?: ClassSlotClient;
  initialNow?: Date;
}) {
  const feedback = useAppFeedback();
  const sessionContext = useSessionContext();
  const branch =
    sessionContext?.activeBranch ??
    (sessionContext?.session?.branches?.length === 1 ? sessionContext.session.branches[0] : null);
  const timezone = branch?.timezone ?? 'Asia/Jakarta';
  const now = useMemo(() => initialNow ?? new Date(), [initialNow]);
  const canManage = Boolean(sessionContext?.hasCapability('class-slot:manage'));
  const canAttend = Boolean(sessionContext?.hasCapability('attendance:manage'));

  const [from, setFrom] = useState(() => localDateKey(new Date(now.getTime() - 30 * DAY_MS), timezone));
  const [until, setUntil] = useState(() => localDateKey(now, timezone));
  const [status, setStatus] = useState('');
  const [tanpaPresensi, setTanpaPresensi] = useState(false);
  const [items, setItems] = useState<RiwayatKelasItem[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!client.riwayat) return;
    setLoading(true);
    setFailure('');
    try {
      const result = await client.riwayat({
        branchId: branch?.id,
        from: zonedLocalDateTime(from, '00:00', timezone).toISOString(),
        until: zonedLocalDateTime(until, '23:59', timezone).toISOString(),
        status,
        tanpaPresensi,
      });
      setItems(result.items);
      setTruncated(result.truncated);
    } catch (error) {
      setFailure(classSlotFailure(error) ?? '');
    } finally {
      setLoading(false);
    }
  }, [client, branch?.id, from, until, status, tanpaPresensi, timezone]);

  useEffect(() => {
    void load();
  }, [load]);

  const aksi = async (item: RiwayatKelasItem, kerja: () => Promise<boolean>) => {
    setBusyId(item.id);
    try {
      if (await kerja()) await load();
    } catch (error) {
      feedback.showToast({ tone: 'danger', title: 'Gagal memproses kelas', message: classSlotFailure(error) });
    } finally {
      setBusyId(null);
    }
  };

  const catatPresensi = (item: RiwayatKelasItem) =>
    aksi(item, async () => {
      const ok = await feedback.confirm({
        tone: 'warning',
        title: 'Catat presensi instruktur?',
        message: `${item.instructorName ?? 'Instruktur'} dicatat hadir pada kelas ini dan honornya dihitung terverifikasi. Tercatat atas nama Anda.`,
        confirmLabel: 'Catat hadir',
      });
      if (!ok) return false;
      await client.verifyInstructorAttendance!(item.id, 'Dicatat dari riwayat kelas');
      return true;
    });

  const selesaikan = (item: RiwayatKelasItem) =>
    aksi(item, async () => {
      const control = await client.completionControl(item.id);
      const ok = await feedback.confirm({
        tone: 'danger',
        title: 'Selesaikan kelas?',
        message: `${control.attendanceCount} hadir dan ${control.noShowCount} tidak hadir akan dicatat. ${control.activeReservationCount} reservasi aktif akan dipakai satu kali.`,
        confirmLabel: 'Selesaikan kelas',
      });
      if (!ok) return false;
      await client.complete(item.id, control.expectedVersion, control.controlHash, 'Diselesaikan dari riwayat kelas');
      return true;
    });

  const belumSelesai = items.filter((i) => BISA_DISELESAIKAN.includes(i.status)).length;
  const tanpaPresensiCount = items.filter(
    (i) => i.instructorId && !i.instructorAttendance && i.status !== 'CANCELLED' && i.status !== 'AUTO_CANCELLED',
  ).length;

  return (
    <div className="space-y-5">
      <AdminPageHeader
        title="Riwayat kelas"
        description="Kelas yang sudah lewat: kehadiran peserta, presensi instruktur, dan honor. Pakai filter untuk menemukan kelas yang belum beres."
        actions={
          <ButtonLink href="/workspace/classes" variant="secondary">
            <ArrowLeft className="size-4" aria-hidden="true" /> Kembali ke timetable
          </ButtonLink>
        }
      />

      <FilterBar
        label="Filter riwayat kelas"
        onApply={() => void load()}
        applying={loading}
        showReset={false}
      >
        <TextInput label="Dari tanggal" type="date" value={from} max={until} onChange={(e) => setFrom(e.target.value)} />
        <TextInput label="Sampai tanggal" type="date" value={until} min={from} onChange={(e) => setUntil(e.target.value)} />
        <SelectInput label="Status kelas" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Semua status</option>
          {Object.entries(statusLabels)
            .filter(([value]) => value !== 'DRAFT')
            .map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
        </SelectInput>
        <CheckboxInput
          label="Hanya tanpa presensi instruktur"
          checked={tanpaPresensi}
          onChange={(e) => setTanpaPresensi(e.target.checked)}
        />
      </FilterBar>

      {failure && <Feedback kind="error">{failure}</Feedback>}
      {!loading && !failure && (belumSelesai > 0 || tanpaPresensiCount > 0) && (
        <Feedback kind="status">
          {belumSelesai > 0 && `Dari kelas yang tampil: ${belumSelesai} belum diselesaikan. `}
          {tanpaPresensiCount > 0 &&
            `${tanpaPresensiCount} belum punya presensi instruktur, honornya belum terverifikasi.`}
        </Feedback>
      )}
      {truncated && (
        <Feedback kind="status">Hanya 200 kelas terbaru yang tampil. Persempit rentang tanggal untuk melihat sisanya.</Feedback>
      )}

      <Panel className="p-0">
        <DataTable
          items={items}
          loading={loading}
          rowKey={(item) => item.id}
          emptyTitle="Tidak ada kelas pada rentang ini"
          emptyDescription="Ubah rentang tanggal atau lepas filter untuk melihat kelas lain."
          columns={[
            {
              id: 'waktu',
              header: 'Waktu',
              cell: (item) => (
                <div className="grid">
                  <span className="font-semibold text-dd-ink">
                    {formatBranchDay(localDateKey(new Date(item.startAt), item.timezone), item.timezone, now)}
                  </span>
                  <span className="text-dd-muted">
                    {formatBranchTime(new Date(item.startAt), item.timezone)} sampai{' '}
                    {formatBranchTime(new Date(item.endAt), item.timezone)}
                  </span>
                </div>
              ),
            },
            {
              id: 'kelas',
              header: 'Kelas',
              cell: (item) => (
                <div className="grid">
                  <span className="font-semibold text-dd-ink">{item.classTypeName}</span>
                  <span className="text-dd-muted">
                    {[item.branchName, item.instructorName ?? 'Tanpa instruktur'].join(' · ')}
                  </span>
                </div>
              ),
            },
            {
              id: 'status',
              header: 'Status',
              cell: (item) => (
                <Badge tone={STATUS_TONE[item.status] ?? 'neutral'}>
                  {item.status === 'COMPLETED'
                    ? 'Selesai'
                    : BISA_DISELESAIKAN.includes(item.status)
                      ? 'Belum diselesaikan'
                      : (statusLabels[item.status] ?? item.status)}
                </Badge>
              ),
            },
            {
              id: 'peserta',
              header: 'Peserta',
              cell: (item) => (
                <span className="whitespace-nowrap">
                  {item.attendedCount} hadir, {item.noShowCount} tidak hadir
                  {item.bookedCount > 0 && `, ${item.bookedCount} belum dicatat`}
                  {item.cancelledCount > 0 && `, ${item.cancelledCount} batal`}
                  <span className="block text-dd-muted">Kapasitas {item.capacity}</span>
                </span>
              ),
            },
            {
              id: 'presensi',
              header: 'Presensi instruktur',
              cell: (item) => {
                if (!item.instructorId) return <span className="text-dd-muted">Tanpa instruktur</span>;
                if (item.instructorAttendance)
                  return (
                    <span>
                      Hadir pk {formatBranchTime(new Date(item.instructorAttendance.checkedInAt), item.timezone)}
                      <span className="block text-dd-muted">
                        {item.instructorAttendance.method === 'QR_SCAN' ? 'Scan QR' : 'Verifikasi manual'}
                      </span>
                    </span>
                  );
                if (item.status === 'CANCELLED' || item.status === 'AUTO_CANCELLED')
                  return <span className="text-dd-muted">Kelas batal</span>;
                return <Badge tone="warning">Belum tercatat</Badge>;
              },
            },
            {
              id: 'honor',
              header: 'Honor',
              cell: (item) =>
                item.status !== 'COMPLETED' ? (
                  <span className="text-dd-muted">Menunggu kelas selesai</span>
                ) : !item.instructorAttendance ? (
                  <span className="text-dd-muted">Belum terverifikasi</span>
                ) : (
                  <Badge tone="success">Masuk payroll</Badge>
                ),
            },
            {
              id: 'aksi',
              header: 'Tindakan',
              cell: (item) => (
                <div className="flex flex-wrap gap-2">
                  {canAttend && item.instructorId && !item.instructorAttendance && item.status !== 'CANCELLED' && item.status !== 'AUTO_CANCELLED' && (
                    <Button size="sm" variant="secondary" disabled={busyId === item.id} onClick={() => void catatPresensi(item)}>
                      Catat presensi
                    </Button>
                  )}
                  {canManage && BISA_DISELESAIKAN.includes(item.status) && (
                    <Button size="sm" disabled={busyId === item.id} onClick={() => void selesaikan(item)}>
                      Selesaikan
                    </Button>
                  )}
                </div>
              ),
            },
          ]}
        />
      </Panel>
    </div>
  );
}
