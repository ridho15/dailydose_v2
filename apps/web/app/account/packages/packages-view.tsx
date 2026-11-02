'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarDays, MessageCircle } from 'lucide-react';
import { browserLedgerClient, type LedgerBalance, type LedgerClient } from '@/api-clients/ledger-client';
import {
  browserOrderClient,
  type CustomerOrder,
  type OrderStatus,
} from '@/api-clients/order-client';
import {
  browserBookingClient,
  type BookingClient,
  type CustomerBookingRecord,
} from '@/api-clients/booking-client';
import { Button, ButtonLink } from '../../components/actions';
import { useStudioPreference } from '../../components/public/public-experience';
import { SharedPackageMembersDialog } from '../../components/shared-package-members-dialog';
import { formatRupiah } from '../../lib/formatters';
import { useSessionContext } from '../../session-context';
import { Feedback, Skeleton, StatusBadge } from '../../ui';

export function isExpiredPackage(item: LedgerBalance): boolean {
  const isPast = new Date(item.expiryAt).getTime() < Date.now();
  return item.status === 'EXPIRED' || isPast;
}

const SEDANG_DIPROSES: readonly OrderStatus[] = ['AWAITING_PAYMENT', 'PENDING', 'ACTION_REQUIRED'];
/** Selama ada pesanan yang diperiksa, halaman memeriksa ulang supaya paket muncul tanpa muat ulang. */
const CEK_ULANG_MS = 60_000;

type OrderClient = Pick<typeof browserOrderClient, 'list'>;

const tanggal = (value: Date | string) =>
  new Date(value).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });

/** "baru saja", "25 menit lalu", "4 jam lalu", "2 hari lalu". */
export function sejak(value: Date | string, now = Date.now()) {
  const menit = Math.max(0, Math.round((now - new Date(value).getTime()) / 60_000));
  if (menit < 2) return 'baru saja';
  if (menit < 60) return `${menit} menit lalu`;
  const jam = Math.round(menit / 60);
  if (jam < 24) return `${jam} jam lalu`;
  return `${Math.round(jam / 24)} hari lalu`;
}

/** Nomor WhatsApp cabang dari daftar tombol WhatsApp publik (`https://wa.me/<nomor>?text=…`). */
function nomorWa(href: string | undefined) {
  return href?.match(/wa\.me\/(\d+)/)?.[1] ?? null;
}

const LANGKAH = ['Pesanan dibuat', 'Bukti transfer', 'Diperiksa studio', 'Paket aktif'] as const;
const langkahKe: Record<string, number> = { AWAITING_PAYMENT: 1, ACTION_REQUIRED: 1, PENDING: 2 };

function KartuPesanan({ order, waHref }: { order: CustomerOrder; waHref: string | null }) {
  const aktif = langkahKe[order.status] ?? 0;
  const detail = `/orders/${encodeURIComponent(order.id)}?returnTo=${encodeURIComponent('/account/packages')}`;
  return (
    <li className="rounded-dd-xl border border-dd-line bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="m-0 text-base font-semibold text-dd-ink">{order.packageName}</p>
          <p className="m-0 mt-0.5 text-sm text-dd-muted">
            {[order.branchName, formatRupiah(order.payableAmountRp)].filter(Boolean).join(' · ')}
          </p>
        </div>
        <StatusBadge tone={order.status === 'PENDING' ? 'info' : 'warning'}>
          {order.status === 'PENDING'
            ? 'Sedang diperiksa'
            : order.status === 'ACTION_REQUIRED'
              ? 'Bukti perlu diganti'
              : 'Belum dibayar'}
        </StatusBadge>
      </div>

      <ol aria-label="Tahap pesanan" className="m-0 mt-4 grid list-none grid-cols-4 gap-1.5 p-0">
        {LANGKAH.map((nama, i) => (
          <li key={nama} aria-current={i === aktif ? 'step' : undefined}>
            <span
              className={`block h-1.5 rounded-full ${i < aktif ? 'bg-dd-forest' : i === aktif ? 'bg-dd-brass' : 'bg-dd-line'}`}
            />
            <span
              className={`mt-1.5 block text-xs leading-tight ${i === aktif ? 'font-semibold text-dd-ink' : 'text-dd-muted'}`}
            >
              {nama}
            </span>
          </li>
        ))}
      </ol>

      {order.status === 'PENDING' && (
        <p className="m-0 mt-4 text-[15px] leading-relaxed text-dd-ink">
          Bukti transfer terkirim {sejak(order.submittedAt)}. Studio sedang mencocokkan dengan mutasi
          rekening. Paket langsung muncul di halaman ini setelah disetujui; tidak perlu mengirim
          ulang bukti.
        </p>
      )}
      {order.status === 'AWAITING_PAYMENT' && (
        <p className="m-0 mt-4 text-[15px] leading-relaxed text-dd-ink">
          Transfer tepat {formatRupiah(order.payableAmountRp)}, lalu unggah bukti transfernya
          {order.expiresAt ? ` sebelum ${tanggal(order.expiresAt)}` : ''}.
        </p>
      )}
      {order.status === 'ACTION_REQUIRED' && (
        <p className="m-0 mt-4 text-[15px] leading-relaxed text-dd-ink">
          Bukti transfer belum bisa dicocokkan. Unggah ulang foto bukti yang jelas (nominal dan
          tanggal terbaca).
        </p>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        {order.status === 'PENDING' ? (
          waHref && (
            <ButtonLink
              href={waHref}
              target="_blank"
              rel="noreferrer"
              leadingIcon={<MessageCircle className="size-4" aria-hidden="true" />}
            >
              Tanya studio via WhatsApp
            </ButtonLink>
          )
        ) : (
          <ButtonLink href={detail}>
            {order.status === 'ACTION_REQUIRED' ? 'Ganti bukti transfer' : 'Lanjutkan pembayaran'}
          </ButtonLink>
        )}
        <ButtonLink variant="secondary" href={detail}>
          Detail pesanan
        </ButtonLink>
      </div>
    </li>
  );
}

function KartuPaket({
  item,
  milikSendiri,
  onAnggota,
}: {
  item: LedgerBalance;
  milikSendiri: boolean;
  onAnggota(): void;
}) {
  const hampirHabis = item.available > 0 && item.available <= 2;
  return (
    <li className="rounded-dd-xl border border-dd-line bg-white p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="m-0 text-base font-semibold text-dd-ink">{item.packageName ?? 'Paket kelas'}</p>
          <p className="m-0 mt-0.5 text-sm text-dd-muted">
            {[item.classTypeName, item.branchName].filter(Boolean).join(' · ')}
          </p>
          {item.isShareable && (
            <p className="m-0 mt-1 text-xs font-semibold text-dd-forest">
              {milikSendiri ? 'Paket Bersama (Family / Duet)' : `Paket bersama milik ${item.customer?.displayName ?? 'member lain'}`}
            </p>
          )}
        </div>
        <div className="shrink-0 text-right">
          <p className="m-0 text-[32px] font-semibold leading-none tabular-nums text-dd-forest">
            {item.available}
          </p>
          <p className="m-0 mt-1 text-xs text-dd-muted">sesi tersisa</p>
        </div>
      </div>
      <p className={`m-0 mt-3 text-sm ${hampirHabis ? 'font-semibold text-dd-warning' : 'text-dd-muted'}`}>
        Berlaku sampai {tanggal(item.expiryAt)}
        {item.reserved > 0 ? ` · ${item.reserved} sesi sudah dibooking` : ''}
        {hampirHabis ? ' · hampir habis' : ''}
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <ButtonLink
          href={item.branchId ? `/classes?branch=${encodeURIComponent(item.branchId)}#schedule` : '/classes#schedule'}
        >
          Booking kelas
        </ButtonLink>
        {item.isShareable && (
          <Button variant="secondary" onClick={onAnggota}>
            {milikSendiri ? `Kelola Anggota (${item.sharedMembers?.length ?? 0})` : 'Lihat Anggota Bersama'}
          </Button>
        )}
      </div>
    </li>
  );
}

/**
 * Paket Saya: satu halaman untuk semua yang ingin diketahui member tentang paketnya. Pesanan yang
 * masih berjalan (dan tahap pemeriksaannya), paket aktif dengan sisa sesi, booking terdekat, lalu
 * riwayat. Sebelumnya informasi ini tersebar di Pesanan Saya, Paket & Sesi, dan Booking Saya.
 */
export function CustomerPackagesView({
  ledger = browserLedgerClient,
  orders = browserOrderClient,
  bookings = browserBookingClient,
}: {
  ledger?: Pick<LedgerClient, 'list'>;
  orders?: OrderClient;
  bookings?: Pick<BookingClient, 'list'>;
} = {}) {
  const session = useSessionContext();
  const currentUserId = session?.session?.id;
  const studio = useStudioPreference();
  const [paket, setPaket] = useState<LedgerBalance[] | null>(null);
  const [pesanan, setPesanan] = useState<CustomerOrder[]>([]);
  const [booking, setBooking] = useState<CustomerBookingRecord[]>([]);
  const [gagal, setGagal] = useState('');
  const [anggota, setAnggota] = useState<LedgerBalance | null>(null);

  const muat = useCallback(async () => {
    const semuaPaket = async () => {
      const items: LedgerBalance[] = [];
      let cursor: string | undefined;
      for (let halaman = 0; halaman < 10; halaman += 1) {
        const page = await ledger.list(undefined, cursor);
        items.push(...page.items);
        if (!page.nextCursor) break;
        cursor = page.nextCursor;
      }
      return { items };
    };
    const [p, o, b] = await Promise.allSettled([
      semuaPaket(),
      orders.list({ limit: 10 }),
      bookings.list({ timeline: 'UPCOMING', limit: 3 }),
    ]);
    if (p.status === 'fulfilled') setPaket(p.value.items);
    else setGagal('Paket Anda belum dapat dimuat. Coba muat ulang halaman.');
    if (o.status === 'fulfilled') setPesanan(o.value.items ?? []);
    if (b.status === 'fulfilled') setBooking(b.value.items ?? []);
  }, [bookings, ledger, orders]);

  useEffect(() => {
    void muat();
  }, [muat]);

  const berjalan = useMemo(() => pesanan.filter((o) => SEDANG_DIPROSES.includes(o.status)), [pesanan]);
  const adaDiperiksa = berjalan.some((o) => o.status === 'PENDING');
  useEffect(() => {
    if (!adaDiperiksa) return;
    const timer = window.setInterval(() => void muat(), CEK_ULANG_MS);
    return () => window.clearInterval(timer);
  }, [adaDiperiksa, muat]);

  const aktif = (paket ?? []).filter((item) => item.status === 'ACTIVE' && !isExpiredPackage(item));
  const riwayat = (paket ?? []).filter((item) => isExpiredPackage(item) || item.status !== 'ACTIVE');
  const totalSesi = aktif.reduce((s, item) => s + item.available, 0);

  const waUntuk = (order: CustomerOrder) => {
    const daftar = studio?.whatsappStudios ?? [];
    const nomor = nomorWa((daftar.find((s) => s.id === order.branchId) ?? daftar[0])?.href);
    if (!nomor) return null;
    const pesan = `Halo Daily Dose${order.branchName ? ` ${order.branchName}` : ''}, saya sudah transfer ${formatRupiah(order.payableAmountRp)} untuk paket ${order.packageName} (${tanggal(order.submittedAt)}). Mohon dibantu dicek. Terima kasih.`;
    return `https://wa.me/${nomor}?text=${encodeURIComponent(pesan)}`;
  };

  return (
    <main className="space-y-7 font-sans" aria-labelledby="paket-saya-title">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 id="paket-saya-title" className="m-0 text-[26px] font-semibold tracking-[-0.02em] text-dd-ink sm:text-[30px]">
            Paket Saya
          </h1>
          <p className="m-0 mt-1 text-[15px] text-dd-muted">
            {paket === null
              ? 'Memuat paket…'
              : aktif.length
                ? `${totalSesi} sesi tersisa dari ${aktif.length} paket aktif.`
                : 'Belum ada paket aktif.'}
          </p>
        </div>
        <ButtonLink variant="secondary" size="sm" href="/packages">
          Tambah paket
        </ButtonLink>
      </header>

      {gagal && <Feedback kind="error">{gagal}</Feedback>}

      {berjalan.length > 0 && (
        <section aria-labelledby="pesanan-berjalan" className="space-y-3">
          <h2 id="pesanan-berjalan" className="m-0 text-lg font-semibold text-dd-ink">
            Pesanan sedang diproses
          </h2>
          <ul className="m-0 grid list-none gap-3 p-0">
            {berjalan.map((order) => (
              <KartuPesanan key={order.id} order={order} waHref={waUntuk(order)} />
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="paket-aktif" className="space-y-3">
        <h2 id="paket-aktif" className="m-0 text-lg font-semibold text-dd-ink">
          Paket aktif
        </h2>
        {paket === null && !gagal ? (
          <Skeleton label="Memuat paket" />
        ) : aktif.length === 0 ? (
          <div className="rounded-dd-xl border border-dd-line bg-white p-5">
            <p className="m-0 text-base font-semibold text-dd-ink">Belum ada paket aktif</p>
            <p className="m-0 mt-1 text-[15px] text-dd-muted">
              {berjalan.length
                ? 'Paket muncul di sini setelah pesanan di atas disetujui.'
                : 'Beli paket untuk mulai booking kelas.'}
            </p>
            {!berjalan.length && (
              <div className="mt-4">
                <ButtonLink href="/packages">Lihat paket</ButtonLink>
              </div>
            )}
          </div>
        ) : (
          <ul className="m-0 grid list-none gap-3 p-0 md:grid-cols-2">
            {aktif.map((item) => (
              <KartuPaket
                key={item.id}
                item={item}
                milikSendiri={!item.customer?.id || item.customer.id === currentUserId}
                onAnggota={() => setAnggota(item)}
              />
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="booking-terdekat" className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 id="booking-terdekat" className="m-0 text-lg font-semibold text-dd-ink">
            Booking terdekat
          </h2>
          <Link href="/bookings" className="text-sm font-semibold text-dd-forest">
            Semua booking
          </Link>
        </div>
        {booking.length === 0 ? (
          <p className="m-0 text-[15px] text-dd-muted">Belum ada kelas yang dibooking.</p>
        ) : (
          <ul className="m-0 grid list-none gap-2 p-0">
            {booking.map((b) => (
              <li key={b.id}>
                <Link
                  href={`/bookings/${encodeURIComponent(b.id)}`}
                  className="flex items-center gap-3 rounded-dd-lg border border-dd-line bg-white px-4 py-3 text-dd-ink no-underline hover:border-dd-forest"
                >
                  <CalendarDays className="size-5 shrink-0 text-dd-forest" aria-hidden="true" />
                  <span className="min-w-0">
                    <span className="block text-[15px] font-semibold">
                      {b.classSlot?.classType?.name ?? 'Kelas'}
                    </span>
                    <span className="block text-sm text-dd-muted">
                      {b.classSlot
                        ? new Date(b.classSlot.startAt).toLocaleString('id-ID', {
                            weekday: 'short',
                            day: 'numeric',
                            month: 'short',
                            hour: '2-digit',
                            minute: '2-digit',
                            timeZone: b.classSlot.timezone || 'Asia/Jakarta',
                          })
                        : ''}
                      {b.branch?.name ? ` · ${b.branch.name}` : ''}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {(riwayat.length > 0 || pesanan.length > berjalan.length) && (
        <details className="rounded-dd-xl border border-dd-line bg-white p-5">
          <summary className="cursor-pointer text-[15px] font-semibold text-dd-ink">
            Riwayat paket dan pesanan
          </summary>
          {riwayat.length > 0 && (
            <ul className="m-0 mt-4 grid list-none gap-2 p-0">
              {riwayat.map((item) => (
                <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-dd-line/70 pb-2 text-sm">
                  <span className="text-dd-ink">{item.packageName ?? 'Paket kelas'}</span>
                  <span className={item.available > 0 ? 'font-semibold text-dd-danger' : 'text-dd-muted'}>
                    {item.available > 0 ? `${item.available} sesi hangus` : 'Habis'} · berakhir {tanggal(item.expiryAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-4 flex flex-wrap items-center gap-4 text-sm">
            {riwayat.length > 0 && (
              <ButtonLink variant="secondary" size="sm" href="/packages">
                Beli paket baru
              </ButtonLink>
            )}
            <Link href="/orders" className="font-semibold text-dd-forest">
              Lihat semua pesanan
            </Link>
          </div>
        </details>
      )}

      {anggota && (
        <SharedPackageMembersDialog
          open={Boolean(anggota)}
          onClose={() => setAnggota(null)}
          customerPackageId={anggota.id}
          packageName={anggota.packageName}
          canManage={
            (anggota.customer?.id === currentUserId || !anggota.customer?.id) &&
            !isExpiredPackage(anggota) &&
            anggota.status === 'ACTIVE'
          }
          onChanged={() => void muat()}
        />
      )}
    </main>
  );
}
