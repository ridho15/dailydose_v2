'use client';

import { useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, CopyPlus } from 'lucide-react';
import {
  browserClassSlotClient,
  type ClassSlot,
  type ClassSlotClient,
  type ClassWorkspace,
} from '../../../api-clients/class-slot-client';
import { AdminPageHeader } from '../../../components/admin/admin-page-header';
import { Panel } from '../../../components/admin/admin-ui';
import { Button } from '../../../components/actions';
import { useAppFeedback } from '../../../components/app-feedback';
import { Feedback, Skeleton } from '../../../ui';
import { formatBranchDay, formatBranchTime, localDateKey, shiftWeek, weekWindow } from '../../../lib/class-time';
import { useSessionContext } from '../../../session-context';
import { EmptyWeeksNotice } from '../../empty-weeks-notice';
import { DECISION_LABEL, planWeekCopy, runPool, summarizeCopy, type PlannedCopy } from '../../schedule-weeks';

const CONCURRENCY = 3;

interface Preview {
  weeks: number;
  plan: PlannedCopy[];
  workspace: ClassWorkspace;
}

/**
 * Salin kelas minggu ini ke minggu depan atau empat minggu ke depan. Sebelum menyimpan, ditampilkan berapa
 * kelas yang akan dibuat dan mana yang sudah ada atau bentrok. Hanya membuat kelas baru; kelas yang sudah
 * ada (termasuk yang sudah dipesan) tidak pernah ditimpa.
 */
export function CopyWeekView({
  client = browserClassSlotClient,
  initialNow,
}: {
  client?: ClassSlotClient;
  initialNow?: Date;
}) {
  const feedback = useAppFeedback();
  const sessionContext = useSessionContext();
  const branch = sessionContext?.activeBranch ?? (sessionContext?.session?.branches?.length === 1 ? sessionContext.session.branches[0] : null);
  const timezone = branch?.timezone ?? 'Asia/Jakarta';
  const canManage = Boolean(sessionContext?.hasCapability('class-slot:manage'));
  const now = useMemo(() => initialNow ?? new Date(), [initialNow]);
  const thisWeek = useMemo(() => weekWindow(now, timezone), [now, timezone]);

  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [publish, setPublish] = useState(true);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [failures, setFailures] = useState<string[]>([]);
  const [finished, setFinished] = useState<{ created: number } | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const buildPreview = useCallback(
    async (weeks: number) => {
      if (!branch?.id) return;
      setLoading(true);
      setError('');
      setPreview(null);
      setFinished(null);
      setFailures([]);
      try {
        const targetEnd = weekWindow(shiftWeek(now, weeks), timezone).end;
        const [source, target] = await Promise.all([
          client.discover({ branchId: branch.id, branches: [{ id: branch.id, timezone }], timezone, from: thisWeek.start, until: thisWeek.end }),
          client.discover({ branchId: branch.id, branches: [{ id: branch.id, timezone }], timezone, from: thisWeek.end, until: targetEnd }),
        ]);
        const plan = Array.from({ length: weeks }, (_, index) =>
          planWeekCopy(source.slots, target.slots, (index + 1) * 7, now),
        ).flat();
        setPreview({ weeks, plan, workspace: source });
      } catch {
        setError('Jadwal belum dapat dimuat. Periksa koneksi lalu coba lagi.');
      } finally {
        setLoading(false);
      }
    },
    [branch?.id, client, now, thisWeek.end, thisWeek.start, timezone],
  );

  const execute = async () => {
    if (!preview || !branch?.id) return;
    const items = preview.plan.filter((item) => item.decision.kind === 'CREATE');
    const accepted = await feedback.confirm({
      tone: 'warning',
      title: `Buat ${items.length} kelas?`,
      message: `Kelas baru dibuat untuk ${preview.weeks === 1 ? 'minggu depan' : `${preview.weeks} minggu ke depan`}. Kelas yang sudah ada tidak diubah.${publish ? ' Kelas dengan instruktur langsung diterbitkan.' : ' Kelas dibuat sebagai draf.'}`,
      confirmLabel: `Buat ${items.length} kelas`,
    });
    if (!accepted) return;
    setProgress({ done: 0, total: items.length });
    setFailures([]);
    let created = 0;
    const problems: string[] = [];
    await runPool(items, CONCURRENCY, async (item) => {
      const label = `${formatBranchDay(localDateKey(item.startAt, timezone), timezone)} ${formatBranchTime(item.startAt, timezone)}`;
      try {
        const slot = await client.create({
          branchId: branch.id,
          classTypeId: item.source.classTypeId,
          studioId: item.source.studioId,
          roomId: item.source.roomId ?? undefined,
          instructorUserId: item.source.instructorUserId ?? undefined,
          startAt: item.startAt,
          endAt: item.endAt,
        });
        created += 1;
        if (publish && item.source.instructorUserId && item.source.status !== 'DRAFT')
          await client.publish(slot.id, slot.version);
      } catch {
        problems.push(label);
      } finally {
        setProgress((current) => (current ? { ...current, done: current.done + 1 } : current));
      }
    });
    setProgress(null);
    setFailures(problems);
    setFinished({ created });
    setPreview(null);
    setRefreshKey((value) => value + 1);
  };

  const className = (slot: ClassSlot) =>
    preview?.workspace.classTypes.find((type) => type.id === slot.classTypeId)?.name ?? 'Kelas Pilates';

  if (!branch)
    return <Feedback kind="info">Pilih cabang aktif di bagian atas supaya jadwal cabang itu bisa disalin.</Feedback>;
  if (!canManage)
    return <Feedback kind="error">Anda tidak memiliki izin mengelola kelas di cabang ini.</Feedback>;

  const summary = preview ? summarizeCopy(preview.plan) : null;
  const notCreated = preview ? preview.plan.filter((item) => item.decision.kind !== 'CREATE') : [];

  return (
    <section className="space-y-6" aria-labelledby="copy-week-title">
      <AdminPageHeader
        title="Salin jadwal minggu"
        titleId="copy-week-title"
        description={`Salin kelas minggu ini (${thisWeek.label}) ke minggu berikutnya. Kelas yang sudah ada tidak diubah.`}
        actions={
          <div className="flex flex-wrap items-center gap-4">
            <Link href="/workspace/classes/rutin" className="text-sm font-semibold text-dd-forest">
              Jadwal rutin
            </Link>
            <Link href="/workspace/classes" className="inline-flex items-center gap-1.5 text-sm font-semibold text-dd-forest">
              <ArrowLeft className="size-4" aria-hidden="true" /> Kembali ke timetable
            </Link>
          </div>
        }
      />

      <EmptyWeeksNotice branchId={branch.id} timezone={timezone} initialNow={initialNow} refreshKey={refreshKey} />

      <Panel className="space-y-4 p-5">
        <div className="flex flex-wrap gap-3">
          <Button leadingIcon={<CopyPlus className="size-4" aria-hidden="true" />} disabled={loading || progress !== null} onClick={() => void buildPreview(1)}>
            Salin minggu ini ke minggu depan
          </Button>
          <Button variant="secondary" leadingIcon={<CopyPlus className="size-4" aria-hidden="true" />} disabled={loading || progress !== null} onClick={() => void buildPreview(4)}>
            Salin ke empat minggu ke depan
          </Button>
        </div>
        {error && <Feedback kind="error">{error}</Feedback>}
        {loading && <Skeleton label="Menyusun rencana salin" />}
      </Panel>

      {preview && summary && (
        <Panel className="space-y-4 p-5" role="region" aria-label="Rencana salin">
          <h2 className="text-lg font-bold">Rencana salin</h2>
          {preview.plan.length === 0 ? (
            <p className="text-sm text-dd-muted">Minggu ini belum punya kelas untuk disalin.</p>
          ) : (
            <p className="text-base" role="status">
              <strong>{summary.create} kelas akan dibuat</strong>
              {summary.exists > 0 && `, ${summary.exists} sudah ada`}
              {summary.conflicts > 0 && `, ${summary.conflicts} bentrok`}
              {summary.past > 0 && `, ${summary.past} sudah lewat`}.
            </p>
          )}
          {notCreated.length > 0 && (
            <div className="space-y-1">
              <p className="text-sm font-semibold text-dd-ink">Yang tidak akan dibuat</p>
              <ul className="m-0 list-none space-y-1 p-0 text-sm">
                {notCreated.slice(0, 30).map((item, index) => (
                  <li key={`${item.source.id}-${index}`} className="text-dd-muted">
                    {formatBranchDay(localDateKey(item.startAt, timezone), timezone)} {formatBranchTime(item.startAt, timezone)} · {className(item.source)}:{' '}
                    <strong className={item.decision.kind === 'EXISTS' || item.decision.kind === 'PAST' ? 'text-dd-muted' : 'text-dd-danger'}>
                      {DECISION_LABEL[item.decision.kind]}
                    </strong>
                  </li>
                ))}
              </ul>
              {notCreated.length > 30 && <p className="text-sm text-dd-muted">dan {notCreated.length - 30} lainnya.</p>}
            </div>
          )}
          {summary.create > 0 && (
            <>
              <label className="flex items-center gap-2 text-sm font-medium">
                <input type="checkbox" checked={publish} onChange={(event) => setPublish(event.target.checked)} />
                Terbitkan kelas yang punya instruktur setelah dibuat
              </label>
              <div className="flex flex-wrap gap-2">
                <Button disabled={progress !== null} onClick={() => void execute()}>
                  Buat {summary.create} kelas
                </Button>
                <Button variant="ghost" disabled={progress !== null} onClick={() => setPreview(null)}>
                  Batal
                </Button>
              </div>
            </>
          )}
        </Panel>
      )}

      {progress && (
        <p role="status" className="text-sm font-semibold">
          Membuat kelas… {progress.done} dari {progress.total}
        </p>
      )}
      {finished && (
        <Panel className="space-y-2 p-5" role="status">
          <p className="font-semibold">{finished.created} kelas dibuat.</p>
          {failures.length > 0 && (
            <>
              <Feedback kind="error">
                {failures.length} kelas tidak dapat dibuat (kemungkinan bentrok jadwal yang baru muncul): {failures.join(', ')}.
              </Feedback>
            </>
          )}
        </Panel>
      )}
    </section>
  );
}
