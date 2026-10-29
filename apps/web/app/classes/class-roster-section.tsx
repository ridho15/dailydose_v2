'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  bookingFailure,
  type BookingClient,
  type CustomerBookingRecord,
} from '@/api-clients/booking-client';
import { Info } from 'lucide-react';
import type { ClassSlot } from '@/api-clients/class-slot-client';
import { Feedback, StatusBadge } from '../ui';
import { Button, ButtonLink } from '../components/actions';
import { SearchInput, SelectInput } from '../components/forms';
import { DataTable, Pagination } from '../components/admin/admin-ui';
import { pageOffset } from '../lib/pagination';
import { useSessionContext } from '../session-context';
import { isInstructorOnlySession } from '@/lib/session-audience';
import { DetailSection, MetricTile } from './class-slot-detail-parts';
import { BatalkanPeserta, type BatalClient } from './batalkan-peserta';
import type { PengajuanPembatalan } from '@/api-clients/booking-client';

const bookingStatusLabels: Record<string, string> = {
  BOOKED: 'Aktif',
  RESCHEDULE_PENDING: 'Menunggu reschedule',
  ATTENDED: 'Hadir',
  CANCELLED: 'Dibatalkan',
  NO_SHOW: 'Tidak hadir',
};

const bookingStatusTone = (status: string) =>
  status === 'CANCELLED' || status === 'NO_SHOW'
    ? 'danger'
    : status === 'ATTENDED'
      ? 'success'
      : 'info';

const bookingHref = (id: string) =>
  `/workspace/bookings/${encodeURIComponent(id)}?returnTo=${encodeURIComponent('/workspace/classes')}`;

export function ClassRosterSection({
  slot,
  showAvailable = true,
  canReadBookings,
  bookingClient,
}: {
  slot: ClassSlot;
  showAvailable?: boolean;
  canReadBookings: boolean;
  bookingClient: Pick<BookingClient, 'list'> &
    Partial<BatalClient & Pick<BookingClient, 'pembatalanTertunda'>>;
}) {
  const sessionContext = useSessionContext();
  const isInstructor = isInstructorOnlySession(sessionContext?.session);
  const [roster, setRoster] = useState<CustomerBookingRecord[]>([]);
  const [rosterSummary, setRosterSummary] =
    useState<Awaited<ReturnType<BookingClient['list']>>['summary']>();
  const [rosterQuery, setRosterQuery] = useState('');
  const [rosterStatus, setRosterStatus] = useState('');
  const [rosterCursor, setRosterCursor] = useState<string>();
  const [rosterCursorHistory, setRosterCursorHistory] = useState<string[]>([]);
  const [rosterNextCursor, setRosterNextCursor] = useState<string | null>();
  const [rosterLoading, setRosterLoading] = useState(false);
  const [rosterFailure, setRosterFailure] = useState('');
  /** Pengajuan pembatalan H-24 yang menunggu Manager/Owner, per booking. */
  const [pengajuan, setPengajuan] = useState<Record<string, PengajuanPembatalan>>({});
  const bolehBatal =
    !isInstructor &&
    Boolean(sessionContext?.session?.capabilities.includes('booking:cancel:assisted')) &&
    Boolean(bookingClient.cancelAsStaff);
  const bolehPutus =
    !isInstructor &&
    Boolean(
      sessionContext?.session?.capabilities.some(
        (cap) => cap === 'booking:late-cancel:decide' || cap === 'ledger:adjust:decide',
      ),
    );
  const loadRoster = useCallback(async () => {
    if (!canReadBookings) return;
    setRosterLoading(true);
    setRosterFailure('');
    if (bookingClient.pembatalanTertunda && !isInstructor) {
      bookingClient
        .pembatalanTertunda(slot.id)
        .then((daftar) => setPengajuan(Object.fromEntries(daftar.map((p) => [p.bookingId, p]))))
        .catch(() => setPengajuan({}));
    }
    try {
      const page = await bookingClient.list({
        classSlotId: slot.id,
        q: rosterQuery || undefined,
        status: rosterStatus || undefined,
        cursor: rosterCursor,
        limit: 10,
      });
      setRoster(page.items);
      setRosterSummary(page.summary);
      setRosterNextCursor(page.nextCursor);
    } catch (error) {
      setRosterFailure(await bookingFailure(error));
      setRoster([]);
    } finally {
      setRosterLoading(false);
    }
  }, [bookingClient, canReadBookings, isInstructor, rosterCursor, rosterQuery, rosterStatus, slot.id]);
  useEffect(() => {
    const timer = window.setTimeout(() => void loadRoster(), rosterQuery ? 250 : 0);
    return () => window.clearTimeout(timer);
  }, [loadRoster, rosterQuery]);
  useEffect(() => {
    setRosterCursor(undefined);
    setRosterCursorHistory([]);
  }, [rosterQuery, rosterStatus, slot.id]);

  return (
    <DetailSection
      id="class-roster-title"
      title="Daftar peserta"
      description="Pelanggan dan status booking ditampilkan sesuai cakupan akses Anda."
    >
      {!canReadBookings ? (
        <Feedback kind="info">
          Anda dapat melihat jumlah peserta, tetapi detail pelanggan memerlukan akses booking.
        </Feedback>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 max-sm:[&>*:last-child:nth-child(odd)]:col-span-2">
            <MetricTile
              label="Aktif"
              value={(rosterSummary?.booked ?? 0) + (rosterSummary?.reschedulePending ?? 0)}
            />
            <MetricTile label="Hadir" value={rosterSummary?.attended ?? 0} />
            <MetricTile label="Dibatalkan" value={rosterSummary?.cancelled ?? 0} />
            {showAvailable && (
              <MetricTile label="Tersedia" value={Math.max(0, slot.capacity - slot.bookedCount)} />
            )}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <SearchInput
              label="Cari peserta"
              value={rosterQuery}
              placeholder="Nama atau telepon"
              onChange={(event) => setRosterQuery(event.target.value)}
            />
            <SelectInput
              label="Status booking"
              value={rosterStatus}
              onChange={(event) => setRosterStatus(event.target.value)}
            >
              <option value="">Semua status</option>
              {Object.entries(bookingStatusLabels).map(([value, label]) => (
                <option value={value} key={value}>
                  {label}
                </option>
              ))}
            </SelectInput>
          </div>
          {rosterFailure && (
            <Feedback kind="error">
              {rosterFailure}{' '}
              <Button size="sm" variant="secondary" onClick={() => void loadRoster()}>
                Coba lagi
              </Button>
            </Feedback>
          )}
          <DataTable
            rowNumberOffset={pageOffset(rosterCursorHistory.length, 10)}
            items={roster}
            loading={rosterLoading}
            rowKey={(item) => item.id}
            emptyTitle="Belum ada peserta"
            emptyDescription="Belum ada booking yang sesuai dengan filter daftar peserta."
            columns={[
              {
                id: 'customer',
                header: 'Pelanggan',
                cell: (item) => (
                  <div>
                    <strong className="block">{item.customer?.displayName ?? 'Pelanggan'}</strong>
                    {!isInstructor && (
                      <span className="text-xs text-dd-muted">
                        {item.customer?.phoneMasked ?? 'Kontak termasking'}
                      </span>
                    )}
                  </div>
                ),
              },
              ...(!isInstructor
                ? [
                    {
                      id: 'package',
                      header: 'Paket & sesi',
                      cell: (item: CustomerBookingRecord) => (
                        <div>
                          <span className="block">{item.package?.name ?? 'Paket pelanggan'}</span>
                          <span className="text-xs text-dd-muted">
                            {item.sessionBalance?.available ?? 0} sesi tersedia
                          </span>
                        </div>
                      ),
                    },
                  ]
                : []),
              {
                id: 'status',
                header: 'Status',
                cell: (item) => (
                  <StatusBadge tone={bookingStatusTone(item.status)}>
                    {bookingStatusLabels[item.status] ?? 'Status booking'}
                  </StatusBadge>
                ),
              },
              ...(!isInstructor
                ? [
                    {
                      id: 'action',
                      header: 'Tindakan',
                      cell: (item: CustomerBookingRecord) => (
                        <div className="flex flex-wrap items-center gap-2">
                          <ButtonLink size="sm" variant="secondary" href={bookingHref(item.id)}>
                            Lihat booking
                          </ButtonLink>
                          {(bolehBatal || (bolehPutus && pengajuan[item.id])) && (
                            <BatalkanPeserta
                              booking={item}
                              kelasMulai={slot.startAt}
                              client={bookingClient}
                              pengajuan={pengajuan[item.id]}
                              onBerubah={() => void loadRoster()}
                            />
                          )}
                        </div>
                      ),
                    },
                  ]
                : []),
            ]}
            mobileCard={(item) => (
              <div className="grid gap-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <strong className="block">{item.customer?.displayName ?? 'Pelanggan'}</strong>
                    {!isInstructor && (
                      <span className="text-xs text-dd-muted">
                        {item.customer?.phoneMasked ?? 'Kontak termasking'}
                      </span>
                    )}
                  </div>
                  <StatusBadge tone={bookingStatusTone(item.status)}>
                    {bookingStatusLabels[item.status] ?? 'Status booking'}
                  </StatusBadge>
                </div>
                {!isInstructor && (
                  <>
                    <p className="m-0 text-sm">
                      {item.package?.name ?? 'Paket pelanggan'} · {item.sessionBalance?.available ?? 0}{' '}
                      sesi tersedia
                    </p>
                    <div className="flex flex-wrap items-center gap-2">
                      <ButtonLink size="sm" variant="secondary" href={bookingHref(item.id)}>
                        Lihat booking
                      </ButtonLink>
                      {(bolehBatal || (bolehPutus && pengajuan[item.id])) && (
                        <BatalkanPeserta
                          booking={item}
                          kelasMulai={slot.startAt}
                          client={bookingClient}
                          pengajuan={pengajuan[item.id]}
                          onBerubah={() => void loadRoster()}
                        />
                      )}
                    </div>
                  </>
                )}
              </div>
            )}
          />
          {(rosterCursorHistory.length > 0 || Boolean(rosterNextCursor)) && (
            <Pagination
              hasPrevious={rosterCursorHistory.length > 0}
              hasNext={Boolean(rosterNextCursor)}
              currentPage={rosterCursorHistory.length + 1}
              onPrevious={() => {
                const previous = [...rosterCursorHistory];
                const next = previous.pop();
                setRosterCursorHistory(previous);
                setRosterCursor(next);
              }}
              onNext={() => {
                if (!rosterNextCursor) return;
                setRosterCursorHistory((current) => [...current, rosterCursor ?? '']);
                setRosterCursor(rosterNextCursor);
              }}
            />
          )}
          {isInstructor && (
            <div className="pt-3 border-t border-dd-line/60 flex items-center gap-2 text-xs text-dd-muted">
              <Info className="size-4 shrink-0 text-dd-muted" aria-hidden="true" />
              <span>Instruktur tidak melihat data pembayaran peserta.</span>
            </div>
          )}
        </>
      )}
    </DetailSection>
  );
}
