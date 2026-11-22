'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  browserAvailabilityClient,
  availabilityFailure,
  type AvailabilityClient,
  type AvailabilityWindow,
} from '@/api-clients/availability-client';
import { formatBranchDay, formatBranchTime, localDateKey, zonedLocalDateTime } from '@/lib/class-time';
import { useSessionContext } from '../../session-context';
import { AdminPageHeader } from '../../components/admin/admin-page-header';
import { DataTable, TableActionMenu } from '../../components/admin/admin-ui';
import { DateInput, TextInput } from '../../components/forms';
import { Button } from '../../components/actions';
import { Feedback, StatusBadge } from '../../ui';
import { Modal, useAppFeedback } from '../../components/app-feedback';
import { Pencil, Trash2 } from 'lucide-react';
import { GridKetersediaan } from './grid-ketersediaan';

const statusLabels: Record<string, string> = {
  ACTIVE: 'Aktif',
  ENDED: 'Selesai',
};

/** Jam "HH:MM" 24 jam di zona waktu cabang, untuk nilai awal input time. */
const timeValue = (value: Date, timeZone: string) =>
  new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(value);

export function AvailabilityView({
  client = browserAvailabilityClient,
}: {
  client?: AvailabilityClient;
}) {
  const sessionContext = useSessionContext();
  const feedback = useAppFeedback();
  const branch = sessionContext?.activeBranch ?? null;
  const capabilities = sessionContext?.session?.capabilities ?? [];
  const canRead = capabilities.includes('availability:self:read');
  const canCreate = capabilities.includes('availability:self:create');

  const [items, setItems] = useState<AvailabilityWindow[]>([]);
  const [loading, setLoading] = useState(false);
  const [listFailure, setListFailure] = useState<string>();
  const [message, setMessage] = useState<string>();
  const [formFailure, setFormFailure] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
  const [isRecurring, setIsRecurring] = useState(false);
  const [editing, setEditing] = useState<AvailabilityWindow | null>(null);
  const [editFailure, setEditFailure] = useState<string>();
  const [editBusy, setEditBusy] = useState(false);

  const withdraw = async (item: AvailabilityWindow) => {
    const accepted = await feedback.confirm({
      tone: 'danger',
      title: 'Tarik ketersediaan?',
      message: `Ketersediaan ${formatBranchDay(localDateKey(item.startAt, item.timezone), item.timezone)}, ${formatBranchTime(item.startAt, item.timezone)}–${formatBranchTime(item.endAt, item.timezone)} akan dihapus dan tidak lagi terlihat oleh admin.`,
      confirmLabel: 'Tarik ketersediaan',
    });
    if (!accepted) return;
    try {
      await client.remove(item.id);
      setListFailure(undefined);
      setMessage('Ketersediaan ditarik.');
      await load();
    } catch (error) {
      setListFailure(availabilityFailure(error));
    }
  };

  const saveEdit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editing) return;
    const data = new FormData(event.currentTarget);
    let startAt: Date;
    let endAt: Date;
    try {
      startAt = zonedLocalDateTime(String(data.get('date')), String(data.get('startTime')), editing.timezone);
      endAt = zonedLocalDateTime(String(data.get('date')), String(data.get('endTime')), editing.timezone);
      if (endAt <= startAt) throw new Error('INVALID_RANGE');
    } catch {
      setEditFailure('Waktu selesai harus setelah waktu mulai.');
      return;
    }
    setEditFailure(undefined);
    setEditBusy(true);
    try {
      await client.update(editing.id, { startAt, endAt });
      setEditing(null);
      setMessage('Ketersediaan diperbarui.');
      await load();
    } catch (error) {
      setEditFailure(availabilityFailure(error));
    } finally {
      setEditBusy(false);
    }
  };

  const rowActions = (item: AvailabilityWindow) =>
    canCreate && item.status === 'ACTIVE' ? (
      <TableActionMenu
        ariaLabel={`Aksi ketersediaan ${formatBranchDay(localDateKey(item.startAt, item.timezone), item.timezone)}`}
        items={[
          {
            key: 'edit',
            label: 'Ubah jam',
            icon: <Pencil className="size-4" aria-hidden="true" />,
            onClick: () => {
              setEditFailure(undefined);
              setEditing(item);
            },
          },
          {
            key: 'withdraw',
            label: 'Tarik',
            tone: 'danger',
            icon: <Trash2 className="size-4" aria-hidden="true" />,
            onClick: () => void withdraw(item),
          },
        ]}
      />
    ) : null;

  const load = useCallback(async () => {
    if (!canRead || !branch) return;
    setLoading(true);
    setListFailure(undefined);
    try {
      const now = new Date();
      const page = await client.list({
        branchId: branch.id,
        from: now.toISOString(),
        until: new Date(now.getTime() + 90 * 86_400_000).toISOString(),
      });
      setItems(page.items);
    } catch (error) {
      setListFailure(availabilityFailure(error));
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [branch, canRead, client]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!canRead) {
    return (
      <section
        className="rounded-dd-lg border border-dd-danger/30 bg-dd-danger-soft p-6"
        aria-labelledby="availability-title"
      >
        <AdminPageHeader
          title="Ketersediaan mengajar"
          titleId="availability-title"
          description="Anda tidak memiliki izin untuk membaca ketersediaan mengajar."
        />
        <Feedback kind="error">Akses ketersediaan memerlukan izin availability:self:read.</Feedback>
      </section>
    );
  }

  if (!branch) {
    return (
      <section
        className="rounded-dd-lg border border-dd-line bg-dd-surface p-6"
        aria-labelledby="availability-title"
      >
        <AdminPageHeader
          title="Ketersediaan mengajar"
          titleId="availability-title"
          description="Pilih cabang aktif pada bagian atas workspace untuk membuka ketersediaan."
        />
        <Feedback kind="warning">
          Pilih cabang aktif untuk mengajukan atau melihat ketersediaan mengajar Anda.
        </Feedback>
      </section>
    );
  }

  return (
    <section className="space-y-6" aria-labelledby="availability-title">
      <AdminPageHeader
        title="Ketersediaan mengajar"
        titleId="availability-title"
        description={`Ajukan dan lihat jam Anda tersedia mengajar di ${branch.name}. Admin menggunakan ini untuk menjadwalkan kelas.`}
      />

      {canCreate && <GridKetersediaan client={client} branch={branch} onTersimpan={() => void load()} />}

      {canCreate && (
        <div className="rounded-2xl border border-dd-line/80 bg-white p-5">
          <h2 className="text-lg font-semibold text-dd-ink">Jam lain (di luar Pagi, Siang, Sore)</h2>
          <form
            className="mt-4 grid gap-4 sm:grid-cols-3"
            aria-label="Form ketersediaan mengajar"
            onSubmit={(event) => {
              event.preventDefault();
              const form = event.currentTarget;
              const data = new FormData(form);
              setFormFailure(undefined);
              let startAt: Date;
              let endAt: Date;
              try {
                startAt = zonedLocalDateTime(
                  String(data.get('date')),
                  String(data.get('startTime')),
                  branch.timezone,
                );
                endAt = zonedLocalDateTime(
                  String(data.get('date')),
                  String(data.get('endTime')),
                  branch.timezone,
                );
                if (endAt <= startAt) throw new Error('INVALID_RANGE');
              } catch {
                setFormFailure('Waktu selesai harus setelah waktu mulai.');
                return;
              }

              const recurringChecked = isRecurring || Boolean(data.get('isRecurring'));
              const repeatUntilStr = data.get('repeatUntil') ? String(data.get('repeatUntil')) : '';
              let windowsToCreate: Array<{ startAt: Date; endAt: Date }> = [{ startAt, endAt }];

              if (recurringChecked) {
                if (!repeatUntilStr) {
                  setFormFailure('Pilih batas tanggal pengulangan ketersediaan.');
                  return;
                }
                try {
                  const repeatUntilDate = zonedLocalDateTime(
                    repeatUntilStr,
                    String(data.get('endTime')),
                    branch.timezone,
                  );
                  if (repeatUntilDate <= startAt) {
                    setFormFailure('Batas pengulangan harus setelah tanggal mulai.');
                    return;
                  }
                  let currentStart = new Date(startAt.getTime() + 7 * 86_400_000);
                  let currentEnd = new Date(endAt.getTime() + 7 * 86_400_000);
                  while (currentStart <= repeatUntilDate) {
                    windowsToCreate.push({ startAt: currentStart, endAt: currentEnd });
                    currentStart = new Date(currentStart.getTime() + 7 * 86_400_000);
                    currentEnd = new Date(currentEnd.getTime() + 7 * 86_400_000);
                  }
                } catch {
                  setFormFailure('Format batas pengulangan tidak valid.');
                  return;
                }
              }

              void (async () => {
                const count = windowsToCreate.length;
                const accepted = await feedback.confirm({
                  tone: 'warning',
                  title: 'Ajukan ketersediaan?',
                  message:
                    count > 1
                      ? `Anda akan mengajukan ketersediaan mengajar di ${branch.name} untuk ${count} minggu berturut-turut.`
                      : `Anda akan tersedia mengajar di ${branch.name} pada waktu yang dipilih.`,
                  confirmLabel: 'Ajukan',
                });
                if (!accepted) return;
                setSubmitting(true);
                try {
                  for (const win of windowsToCreate) {
                    await client.create({ branchId: branch.id, startAt: win.startAt, endAt: win.endAt });
                  }
                  setMessage(
                    count > 1
                      ? `Ketersediaan berhasil diajukan untuk ${count} minggu berturut-turut.`
                      : 'Ketersediaan berhasil diajukan.',
                  );
                  form.reset();
                  setIsRecurring(false);
                  await load();
                } catch (error) {
                  setFormFailure(availabilityFailure(error));
                } finally {
                  setSubmitting(false);
                }
              })();
            }}
          >
            <DateInput
              label="Tanggal"
              name="date"
              min={localDateKey(new Date(), branch.timezone)}
              required
            />
            <TextInput label="Mulai" name="startTime" type="time" required />
            <TextInput label="Selesai" name="endTime" type="time" required />

            <div className="sm:col-span-3 space-y-3 pt-1">
              <label className="inline-flex items-center gap-2 cursor-pointer select-none text-sm font-medium text-dd-ink">
                <input
                  type="checkbox"
                  name="isRecurring"
                  checked={isRecurring}
                  onChange={(event) => setIsRecurring(event.target.checked)}
                  className="size-4 rounded border-dd-line text-dd-forest focus:ring-dd-forest"
                />
                <span>Ulangi setiap minggu sampai tanggal tertentu</span>
              </label>

              {isRecurring && (
                <div className="max-w-xs pl-6">
                  <DateInput
                    label="Ulangi setiap minggu sampai"
                    name="repeatUntil"
                    min={localDateKey(new Date(Date.now() + 7 * 86_400_000), branch.timezone)}
                    required={isRecurring}
                  />
                </div>
              )}
            </div>

            <div className="sm:col-span-3">
              <Button type="submit" loading={submitting}>
                Ajukan ketersediaan
              </Button>
            </div>
          </form>
          {formFailure && <Feedback kind="error">{formFailure}</Feedback>}
        </div>
      )}

      {message && !loading && <Feedback kind="status">{message}</Feedback>}
      {listFailure && <Feedback kind="error">{listFailure}</Feedback>}

      <DataTable
        items={items}
        loading={loading}
        rowKey={(item) => item.id}
        emptyTitle="Belum ada ketersediaan"
        emptyDescription="Ajukan jam Anda tersedia mengajar menggunakan form di atas."
        columns={[
          {
            id: 'day',
            header: 'Tanggal',
            cell: (item) => formatBranchDay(localDateKey(item.startAt, item.timezone), item.timezone),
          },
          {
            id: 'time',
            header: 'Waktu',
            cell: (item) =>
              `${formatBranchTime(item.startAt, item.timezone)}–${formatBranchTime(item.endAt, item.timezone)}`,
          },
          {
            id: 'status',
            header: 'Status',
            cell: (item) => (
              <StatusBadge tone={item.status === 'ACTIVE' ? 'success' : 'neutral'}>
                {statusLabels[item.status] ?? item.status}
              </StatusBadge>
            ),
          },
          { id: 'actions', header: 'Aksi', cell: (item) => rowActions(item) },
        ]}
        mobileCard={(item) => (
          <div className="grid gap-2">
            <div className="flex items-center justify-between gap-2">
              <strong className="text-dd-ink">
                {formatBranchDay(localDateKey(item.startAt, item.timezone), item.timezone)}
              </strong>
              <StatusBadge tone={item.status === 'ACTIVE' ? 'success' : 'neutral'}>
                {statusLabels[item.status] ?? item.status}
              </StatusBadge>
            </div>
            <span className="text-sm text-dd-muted">
              {formatBranchTime(item.startAt, item.timezone)}–{formatBranchTime(item.endAt, item.timezone)}
            </span>
            {rowActions(item) && <div className="flex justify-end">{rowActions(item)}</div>}
          </div>
        )}
      />

      <Modal
        open={Boolean(editing)}
        title="Ubah jam ketersediaan"
        description="Cabang tidak dapat diganti. Tarik ketersediaan ini bila ingin memindahkannya ke cabang lain."
        busy={editBusy}
        onClose={() => setEditing(null)}
      >
        {editing && (
          <form className="grid gap-4 sm:grid-cols-3" aria-label="Form ubah ketersediaan" onSubmit={saveEdit}>
            <DateInput
              label="Tanggal"
              name="date"
              defaultValue={localDateKey(editing.startAt, editing.timezone)}
              min={localDateKey(new Date(), editing.timezone)}
              required
            />
            <TextInput
              label="Mulai"
              name="startTime"
              type="time"
              defaultValue={timeValue(editing.startAt, editing.timezone)}
              required
            />
            <TextInput
              label="Selesai"
              name="endTime"
              type="time"
              defaultValue={timeValue(editing.endAt, editing.timezone)}
              required
            />
            {editFailure && (
              <div className="sm:col-span-3">
                <Feedback kind="error">{editFailure}</Feedback>
              </div>
            )}
            <div className="flex justify-end gap-3 sm:col-span-3">
              <Button type="button" variant="ghost" onClick={() => setEditing(null)}>
                Batal
              </Button>
              <Button type="submit" loading={editBusy}>
                Simpan perubahan
              </Button>
            </div>
          </form>
        )}
      </Modal>
    </section>
  );
}
