'use client';

import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import {
  bookingFailure,
  browserBookingClient,
  type CustomerBookingRecord,
  type BookingClient,
} from '@/api-clients/booking-client';
import { EmptyState, Feedback, PageHeader, Skeleton, StatusBadge } from '../ui';
import { ButtonLink } from '../components/actions';
import { Pagination } from '../components/admin/admin-ui';
import { useSessionContext } from '../session-context';
import { VerificationStatusBanner } from '../components/verification-status-banner';

const statusLabels: Record<string, string> = {
  BOOKED: 'Terjadwal',
  RESCHEDULE_PENDING: 'Menunggu persetujuan',
  CANCELLED: 'Dibatalkan',
  ATTENDED: 'Hadir',
  NO_SHOW: 'Tidak hadir',
};

const statusTones = {
  BOOKED: 'success',
  RESCHEDULE_PENDING: 'warning',
  CANCELLED: 'danger',
  ATTENDED: 'success',
  NO_SHOW: 'danger',
} as const;

export function formatBookingSlotTime(date: Date, timezone?: string, isHistory = false) {
  const currentYear = new Date().getFullYear();
  const showYear = isHistory || date.getFullYear() !== currentYear;
  return date.toLocaleString('id-ID', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    ...(showYear ? { year: 'numeric' } : {}),
    hour: '2-digit',
    minute: '2-digit',
    timeZone: timezone,
  });
}

export function CustomerBookingsView({
  client = browserBookingClient,
}: {
  client?: BookingClient;
}) {
  const session = useSessionContext()?.session;
  const [items, setItems] = useState<CustomerBookingRecord[]>([]);
  const [timeline, setTimeline] = useState<'UPCOMING' | 'HISTORY'>('UPCOMING');
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [cursor, setCursor] = useState<string>();
  const [cursorHistory, setCursorHistory] = useState<string[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>();
  const [total, setTotal] = useState(0);

  const loadPage = useCallback(
    async (pageCursor?: string) => {
      setLoading(true);
      setMessage('');
      try {
        const page = await client.list({ timeline, cursor: pageCursor, limit: 20 });
        setItems(page.items);
        setNextCursor(page.nextCursor);
        setTotal(page.summary?.total ?? page.items.length);
        setCursor(pageCursor);
        return true;
      } catch (error) {
        setMessage(await bookingFailure(error));
        return false;
      } finally {
        setLoading(false);
      }
    },
    [client, timeline],
  );

  useEffect(() => {
    setCursorHistory([]);
    void loadPage();
  }, [loadPage]);

  return (
    <section aria-labelledby="customer-bookings-title">
      <PageHeader
        eyebrow="Booking saya"
        title="Jadwal latihan Anda"
        titleId="customer-bookings-title"
        description="Lihat booking aktif dan riwayat kelas yang dibuat menggunakan akun Anda."
        context={<ButtonLink href="/classes#schedule">Booking kelas baru</ButtonLink>}
      />
      <div className="mt-4">
        <VerificationStatusBanner
          status={session?.identityVerificationStatus}
          returnTo="/bookings"
        />
      </div>
      <div
        className="my-5 inline-flex rounded-none border border-ed-line bg-ed-tint/50 p-1"
        role="tablist"
        aria-label="Linimasa booking"
      >
        {(['UPCOMING', 'HISTORY'] as const).map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={timeline === value}
            className={`min-h-11 rounded-none px-4 text-sm font-semibold transition cursor-pointer ${
              timeline === value
                ? 'bg-ed-forest text-white'
                : 'bg-transparent text-ed-muted hover:bg-ed-tint hover:text-ed-ink'
            }`}
            onClick={() => setTimeline(value)}
          >
            {value === 'UPCOMING' ? 'Mendatang' : 'Riwayat'}
          </button>
        ))}
      </div>
      {loading ? (
        <Skeleton label="Memuat booking customer" />
      ) : items.length === 0 ? (
        <EmptyState
          title={
            timeline === 'UPCOMING' ? 'Belum ada jadwal mendatang' : 'Belum ada riwayat booking'
          }
          description={
            timeline === 'UPCOMING'
              ? 'Pilih kelas dari jadwal untuk membuat booking berikutnya.'
              : 'Booking yang selesai atau dibatalkan akan tampil di sini.'
          }
        />
      ) : (
        <>
          <div className="customer-booking-list space-y-4">
            {items.map((item, index) => {
              const availablePlaces =
                item.classSlot?.capacity !== undefined && item.classSlot?.bookedCount !== undefined
                  ? Math.max(0, item.classSlot.capacity - item.classSlot.bookedCount)
                  : undefined;
              return (
                <Link
                  href={`/bookings/${encodeURIComponent(item.id)}`}
                  className="group block rounded-none border border-ed-line bg-white p-5 text-ed-ink no-underline shadow-none hover:border-ed-forest hover:bg-ed-tint/10 transition-colors"
                  key={item.id}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex items-start gap-2.5">
                      <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-none border border-ed-line bg-ed-tint font-serif text-xs font-normal text-ed-forest mt-0.5">
                        #{cursorHistory.length * 20 + index + 1}
                      </span>
                      <div>
                        <strong className="font-serif block text-lg font-normal tracking-tight text-ed-ink">
                          {item.classSlot?.classType.name ?? 'Kelas Daily Dose'}
                        </strong>
                        <span className="mt-1 block text-xs text-ed-muted">
                          {item.classSlot?.studio?.name
                            ? `${item.classSlot.studio.name} · ${item.branch?.name}`
                            : (item.branch?.name ?? 'Studio Daily Dose')}
                        </span>
                      </div>
                    </div>
                    <StatusBadge
                      tone={statusTones[item.status as keyof typeof statusTones] ?? 'neutral'}
                    >
                      {item.status === 'BOOKED' &&
                      item.classSlot &&
                      item.classSlot.endAt.getTime() < Date.now()
                        ? 'Status kehadiran sedang diproses'
                        : (statusLabels[item.status] ?? 'Status booking')}
                    </StatusBadge>
                  </div>

                  <div
                    className={`mt-4 grid gap-2.5 rounded-none border border-ed-line/70 bg-ed-tint/40 p-3.5 text-xs text-ed-muted ${
                      timeline === 'UPCOMING' ? 'sm:grid-cols-2 lg:grid-cols-3' : 'sm:grid-cols-2'
                    }`}
                  >
                    <div>
                      <span className="block text-[13px] font-bold text-ed-green">
                        Waktu Sesi
                      </span>
                      <strong className="mt-0.5 block text-xs font-semibold text-ed-ink">
                        {item.classSlot
                          ? formatBookingSlotTime(
                              item.classSlot.startAt,
                              item.classSlot.timezone,
                              timeline === 'HISTORY',
                            )
                          : `Dibuat ${item.createdAt.toLocaleString('id-ID')}`}
                      </strong>
                    </div>

                    <div>
                      <span className="block text-[13px] font-bold text-ed-green">
                        Instruktur
                      </span>
                      <strong className="mt-0.5 block text-xs font-semibold text-ed-ink truncate">
                        {item.classSlot?.instructor?.displayName ?? 'Tim Daily Dose'}
                      </strong>
                    </div>

                    {item.status === 'CANCELLED' ? (
                      <div>
                        <span className="block text-[13px] font-bold text-ed-green">
                          Status Booking
                        </span>
                        <strong className="mt-0.5 block text-xs font-semibold text-rose-800">
                          Booking dibatalkan
                        </strong>
                      </div>
                    ) : (
                      timeline === 'UPCOMING' &&
                      item.status === 'BOOKED' && (
                        <div>
                          <span className="block text-[13px] font-bold text-ed-green">
                            Ketersediaan Slot
                          </span>
                          <strong className="mt-0.5 block text-xs font-semibold text-ed-ink">
                            {item.classSlot?.capacity
                              ? `${item.classSlot.bookedCount ?? 1}/${item.classSlot.capacity} terisi (${availablePlaces ?? 0} sisa tempat)`
                              : 'Tersedia'}
                          </strong>
                        </div>
                      )
                    )}
                  </div>

                  <div className="mt-3 flex items-center justify-between text-xs text-ed-muted pt-2 border-t border-ed-line">
                    <span className="truncate max-w-xs sm:max-w-md">
                      Paket: <strong className="font-medium text-ed-ink">{item.package?.name ?? 'Paket Customer'}</strong>
                    </span>
                    <span className="inline-flex items-center gap-1 font-semibold text-ed-forest group-hover:text-ed-green shrink-0">
                      <span>{timeline === 'UPCOMING' && item.status === 'BOOKED' ? 'Lihat detail & QR Pass' : 'Lihat detail'}</span>
                      <ArrowRight className="size-3.5" />
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>
          <div className="mt-5">
            <Pagination
              hasPrevious={cursorHistory.length > 0 && !loading}
              hasNext={Boolean(nextCursor) && !loading}
              totalLabel={
                total <= items.length
                  ? `${items.length.toLocaleString('id-ID')} booking`
                  : `${items.length.toLocaleString('id-ID')} dari ${total.toLocaleString('id-ID')} booking`
              }
              currentPage={cursorHistory.length + 1}
              onPrevious={() => {
                const previous = cursorHistory.at(-1) ?? '';
                void loadPage(previous || undefined).then((loaded) => {
                  if (loaded) setCursorHistory((current) => current.slice(0, -1));
                });
              }}
              onNext={() => {
                if (!nextCursor) return;
                void loadPage(nextCursor).then((loaded) => {
                  if (loaded) setCursorHistory((current) => [...current, cursor ?? '']);
                });
              }}
            />
          </div>
        </>
      )}
      {message && <Feedback kind="error">{message}</Feedback>}
    </section>
  );
}
