'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import {
  bookingFailure,
  type BookingClient,
  type BookingCustomer,
  type CustomerBookingRecord,
  type CustomerPackageBalance,
} from '@/api-clients/booking-client';
import type { ClassSlot } from '@/api-clients/class-slot-client';
import { formatBranchTime } from '@/lib/class-time';
import { Button } from '../components/actions';
import { Feedback } from '../ui';
import { BatalkanPeserta, type BatalClient } from './batalkan-peserta';

type RosterClient = Pick<BookingClient, 'list'> &
  Partial<Pick<BookingClient, 'searchRosterCandidates' | 'create'> & BatalClient>;

/** Calon peserta hasil pencarian beserta paket yang akan dipakai, bila ada. */
export interface Calon {
  customer: BookingCustomer;
  paket: CustomerPackageBalance | null;
  /** Alasan tidak bisa ditambahkan; null bila bisa. */
  kendala: string | null;
}

/** Pencarian baru dikirim setelah dua huruf dan jeda singkat, agar tidak memanggil server per ketukan. */
const MIN_HURUF = 2;
const JEDA_CARI_MS = 300;

/**
 * Menentukan paket yang dipakai untuk memasukkan seseorang ke kelas ini.
 *
 * Paket harus aktif, untuk tipe kelas yang sama, masih punya sesi, dan masih berlaku pada saat
 * kelas dimulai, bukan sekadar hari ini: paket yang habis besok tidak boleh dipakai untuk kelas
 * minggu depan. Bila ada beberapa, yang paling cepat berakhir dipakai lebih dulu supaya sesinya
 * tidak hangus percuma.
 */
export function pilihCalon(
  customer: BookingCustomer,
  packages: readonly CustomerPackageBalance[],
  slot: Pick<ClassSlot, 'classTypeId' | 'startAt'> & { branchId?: string },
  timeZone: string,
): Calon {
  const milik = packages.filter(
    (item) =>
      (item.customerUserId ?? item.customer?.id) === customer.id ||
      item.sharedWithUserIds?.includes(customer.id),
  );
  const cocokTipeSemua = milik.filter(
    (item) => !item.classTypeId || item.classTypeId === slot.classTypeId,
  );
  // Paket harus berlaku di cabang kelas ini (cabang paket atau cabang tempat dibeli).
  const cocokTipe = cocokTipeSemua.filter(
    (item) =>
      !slot.branchId ||
      !item.allowedBranchIds ||
      item.allowedBranchIds === 'SEMUA' ||
      item.allowedBranchIds.includes(slot.branchId),
  );
  const layak = cocokTipe
    .filter(
      (item) =>
        item.status === 'ACTIVE' &&
        item.available > 0 &&
        new Date(item.expiryAt).getTime() > slot.startAt.getTime(),
    )
    .sort((a, b) => new Date(a.expiryAt).getTime() - new Date(b.expiryAt).getTime());

  if (layak[0]) return { customer, paket: layak[0], kendala: null };

  const terakhir = [...cocokTipe].sort(
    (a, b) => new Date(b.expiryAt).getTime() - new Date(a.expiryAt).getTime(),
  )[0];
  if (terakhir && new Date(terakhir.expiryAt).getTime() <= slot.startAt.getTime()) {
    return {
      customer,
      paket: null,
      kendala: `Paket habis ${tanggalPendek(new Date(terakhir.expiryAt), timeZone)}`,
    };
  }
  if (terakhir && terakhir.available <= 0) {
    return { customer, paket: null, kendala: 'Sesi paket sudah habis' };
  }
  if (cocokTipeSemua.length > cocokTipe.length)
    return { customer, paket: null, kendala: 'Paketnya berlaku di cabang lain' };
  return { customer, paket: null, kendala: 'Belum punya paket untuk kelas ini' };
}

export function TimetableRosterPanel({
  slot,
  classTypeName,
  instructorName,
  studioName,
  client,
  canAdd,
  canRemove,
  canManageClass,
  onManage,
  onChanged,
  dalamLaci = false,
}: {
  slot: ClassSlot;
  classTypeName: string;
  instructorName: string;
  studioName?: string;
  client: RosterClient;
  canAdd: boolean;
  canRemove: boolean;
  canManageClass: boolean;
  onManage(): void;
  /** Dipanggil setelah peserta bertambah atau berkurang, agar angka keterisian ikut berubah. */
  onChanged(): void;
  /** Di dalam laci samping: judul dan waktu sudah ada di kepala laci, jadi tidak diulang. */
  dalamLaci?: boolean;
}) {
  const [peserta, setPeserta] = useState<CustomerBookingRecord[]>([]);
  const [query, setQuery] = useState('');
  const [hasilCari, setHasilCari] = useState<Calon[]>([]);
  const [mencari, setMencari] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [failure, setFailure] = useState('');
  const [loading, setLoading] = useState(true);
  const intentKeys = useRef(new Map<string, string>());

  /** Satu kunci per niat, supaya klik ganda tidak membuat dua booking. */
  const kunciNiat = (niat: string) => {
    const ada = intentKeys.current.get(niat);
    if (ada) return ada;
    const baru = crypto.randomUUID();
    intentKeys.current.set(niat, baru);
    return baru;
  };

  const muatPeserta = useCallback(async () => {
    const page = await client.list({ classSlotId: slot.id, status: 'BOOKED', limit: 50 });
    setPeserta(page.items);
  }, [client, slot.id]);

  useEffect(() => {
    let batal = false;
    setLoading(true);
    setFailure('');
    setQuery('');
    client
      .list({ classSlotId: slot.id, status: 'BOOKED', limit: 50 })
      .then((page) => {
        if (!batal) setPeserta(page.items);
      })
      .catch(async (error) => {
        if (!batal) setFailure(await bookingFailure(error));
      })
      .finally(() => {
        if (!batal) setLoading(false);
      });
    return () => {
      batal = true;
    };
  }, [client, slot.id]);

  const sudahTerdaftar = useMemo(
    () => new Set(peserta.map((item) => item.customerUserId)),
    [peserta],
  );

  useEffect(() => {
    const kata = query.trim();
    if (!canAdd || !client.searchRosterCandidates || kata.length < MIN_HURUF) {
      setHasilCari([]);
      setMencari(false);
      return;
    }
    let batal = false;
    setMencari(true);
    const timer = window.setTimeout(() => {
      client.searchRosterCandidates!(slot.branchId, kata)
        .then(({ customers, packages }) => {
          if (batal) return;
          setHasilCari(
            customers
              .filter((customer) => !sudahTerdaftar.has(customer.id))
              .map((customer) => pilihCalon(customer, packages, slot, slot.timezone))
              .sort((a, b) => Number(Boolean(a.kendala)) - Number(Boolean(b.kendala))),
          );
        })
        .catch(async (error) => {
          if (!batal) setFailure(await bookingFailure(error));
        })
        .finally(() => {
          if (!batal) setMencari(false);
        });
    }, JEDA_CARI_MS);
    return () => {
      batal = true;
      window.clearTimeout(timer);
    };
  }, [canAdd, client, query, slot, sudahTerdaftar]);

  const hasil = hasilCari;

  const penuh = slot.bookedCount >= slot.capacity;

  const tambah = async (calon: Calon) => {
    if (!calon.paket || !client.create) return;
    setBusyId(calon.customer.id);
    setFailure('');
    try {
      await client.create(
        {
          classSlotId: slot.id,
          customerPackageId: calon.paket.id,
          customerUserId: calon.customer.id,
          source: 'ADMIN_ASSISTED',
        },
        kunciNiat(`tambah:${calon.customer.id}`),
      );
      intentKeys.current.delete(`tambah:${calon.customer.id}`);
      setQuery('');
      await muatPeserta();
      onChanged();
    } catch (error) {
      setFailure(await bookingFailure(error));
    } finally {
      setBusyId(null);
    }
  };

  const waktu = waktuKelas(slot);

  const Wadah = dalamLaci ? 'div' : 'aside';
  return (
    <Wadah
      aria-labelledby={dalamLaci ? undefined : 'tt-roster'}
      className={
        dalamLaci
          ? 'min-w-0'
          : 'min-w-0 rounded-dd-md border border-dd-border-interactive bg-white p-5'
      }
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          {!dalamLaci && (
            <>
              <h2 id="tt-roster" className="m-0 text-xl font-semibold text-dd-ink">
                {classTypeName}
              </h2>
              <p className="m-0 mt-0.5 text-base text-dd-ink">{waktu}</p>
            </>
          )}
          <p className="m-0 mt-1 text-[15px] text-dd-muted">
            {[studioName, instructorName, `${slot.bookedCount} dari ${slot.capacity} terisi`]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>
        {canManageClass && (
          <Button variant="secondary" onClick={onManage}>
            Atur kelas
          </Button>
        )}
      </div>

      {failure && (
        <div className="mt-4">
          <Feedback kind="error">{failure}</Feedback>
        </div>
      )}

      <div className="mt-5 flex flex-wrap items-start gap-7">
        {slot.status === 'DRAFT' && (
          <div className="min-w-0 flex-[1_1_320px] rounded-dd-sm border border-amber-200 bg-amber-50/70 p-4 text-sm text-amber-900">
            <p className="font-semibold text-amber-950">Kelas masih berstatus Draf</p>
            <p className="mt-1 text-xs text-amber-800 leading-relaxed">
              Publikasikan kelas melalui menu <strong>Atur kelas</strong> terlebih dahulu agar dapat menambahkan member ke dalam roster.
            </p>
          </div>
        )}
        {slot.status === 'CANCELLED' && (
          <div className="min-w-0 flex-[1_1_320px] rounded-dd-sm border border-red-200 bg-red-50/70 p-4 text-sm text-red-900">
            <p className="font-semibold text-red-950">Kelas telah dibatalkan</p>
            <p className="mt-1 text-xs text-red-800 leading-relaxed">
              Tidak dapat menambahkan member pada kelas yang sudah dibatalkan.
            </p>
          </div>
        )}
        {canAdd && (
          <div className="min-w-0 flex-[1_1_320px]">
            <label htmlFor="tt-add" className="mb-2 block text-[15px] font-bold text-dd-ink">
              Tambah member ke kelas ini
            </label>
            <div
              className={`flex h-12 items-center gap-2.5 border border-dd-border-interactive bg-white px-3 focus-within:border-dd-forest ${
                hasil.length ? 'rounded-t-dd-sm' : 'rounded-dd-sm'
              }`}
            >
              <Search className="size-[18px] shrink-0 text-dd-muted" aria-hidden="true" />
              <input
                id="tt-add"
                type="search"
                value={query}
                disabled={loading || penuh}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={penuh ? 'Kelas sudah penuh' : 'Ketik nama atau nomor WhatsApp'}
                className="h-full min-w-0 flex-1 border-0 bg-transparent text-base text-dd-ink outline-none placeholder:text-dd-muted"
              />
            </div>
            {hasil.length > 0 && (
              <ul
                aria-label="Hasil pencarian member"
                className="m-0 list-none overflow-hidden rounded-b-dd-sm border border-t-0 border-dd-border-interactive p-0"
              >
                {hasil.map((calon, index) => (
                  <li
                    key={calon.customer.id}
                    className={index > 0 ? 'border-t border-dd-line/60' : undefined}
                  >
                    {calon.kendala ? (
                      <div className="flex min-h-14 items-center justify-between gap-2.5 p-3">
                        <span className="min-w-0">
                          <span className="block text-base font-bold text-dd-muted">
                            {calon.customer.displayName}
                          </span>
                          <span className="block text-sm text-dd-danger">{calon.kendala}</span>
                        </span>
                        <span className="shrink-0 text-sm text-dd-muted">Perlu paket</span>
                      </div>
                    ) : (
                      <button
                        type="button"
                        disabled={busyId !== null}
                        onClick={() => void tambah(calon)}
                        className="flex min-h-14 w-full items-center justify-between gap-2.5 border-0 bg-dd-success-soft p-3 text-left transition hover:bg-dd-success-soft/70 disabled:opacity-60"
                      >
                        <span className="min-w-0">
                          <span className="block text-base font-bold text-dd-ink">
                            {calon.customer.displayName}
                          </span>
                          <span className="block text-sm text-dd-forest">
                            {calon.paket?.packageName ?? calon.paket?.name ?? 'Paket aktif'} · sisa{' '}
                            {calon.paket?.available}
                            {calon.paket?.customer?.id &&
                              calon.paket.customer.id !== calon.customer.id && (
                                <span className="block text-xs font-semibold text-dd-forest/80">
                                  Milik {calon.paket.customer.displayName} (Paket Bersama)
                                </span>
                              )}
                          </span>
                        </span>
                        <span className="shrink-0 rounded-[6px] bg-dd-forest px-3 py-1.5 text-sm font-bold text-white">
                          {busyId === calon.customer.id ? 'Menambah…' : 'Tambah'}
                        </span>
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {mencari && <p className="m-0 mt-2 text-sm text-dd-muted">Mencari…</p>}
            {query.trim().length >= MIN_HURUF && hasil.length === 0 && !loading && !mencari && (
              <p className="m-0 mt-2 text-sm text-dd-muted">
                Tidak ada member aktif bernama &ldquo;{query.trim()}&rdquo; yang belum terdaftar di
                kelas ini. Coba nomor WhatsApp atau email-nya.
              </p>
            )}
            <p className="m-0 mt-2 text-sm text-dd-muted">
              Satu tekan langsung masuk roster. Sesi baru terpotong saat kelas selesai dan member
              hadir.
            </p>
          </div>
        )}

        <div className="min-w-0 flex-[1_1_320px]">
          <h3 className="m-0 mb-2.5 font-sans text-base font-bold text-dd-ink">
            Peserta terdaftar
          </h3>
          {loading ? (
            <p className="m-0 text-[15px] text-dd-muted">Memuat peserta…</p>
          ) : peserta.length === 0 ? (
            <p className="m-0 text-[15px] text-dd-muted">
              Belum ada peserta. Kelas ini masih bisa diseret ke jam lain.
            </p>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-2 p-0" aria-label="Peserta terdaftar">
              {peserta.map((booking) => (
                <li
                  key={booking.id}
                  className="flex items-center justify-between gap-2.5 border-b border-dd-line/60 pb-2"
                >
                  <span className="min-w-0">
                    <span className="block text-base text-dd-ink">
                      {booking.customer?.displayName ?? 'Member'}
                    </span>
                    {booking.sessionBalance && (
                      <span className="block text-sm text-dd-muted">
                        Sisa {booking.sessionBalance.available} sesi
                        {(booking as any).package?.owner &&
                          (booking as any).package.owner.id !== booking.customerUserId && (
                            <span className="block text-xs text-dd-forest">
                              Paket {(booking as any).package.name} (milik {(booking as any).package.owner.displayName})
                            </span>
                          )}
                      </span>
                    )}
                  </span>
                  {canRemove && (
                    <BatalkanPeserta
                      booking={booking}
                      kelasMulai={slot.startAt}
                      client={client}
                      onBerubah={() => {
                        void muatPeserta();
                        onChanged();
                      }}
                    />
                  )}
                </li>
              ))}
            </ul>
          )}
          {canRemove && (
            <p className="m-0 mt-3 text-sm text-dd-muted">
              Tombol X membatalkan booking setelah konfirmasi. Lebih dari 24 jam sebelum kelas
              langsung batal dan sesinya utuh; kurang dari itu perlu persetujuan Manager atau Owner.
            </p>
          )}
        </div>
      </div>
    </Wadah>
  );
}

/** Hari, tanggal, dan jam kelas menurut zona waktu cabang; dipakai juga sebagai keterangan laci. */
export function waktuKelas(slot: Pick<ClassSlot, 'startAt' | 'endAt' | 'timezone'>) {
  return `${tanggalPanjang(slot.startAt, slot.timezone)} · ${formatBranchTime(
    slot.startAt,
    slot.timezone,
  )} sampai ${formatBranchTime(slot.endAt, slot.timezone)}`;
}

function tanggalPanjang(value: Date, timeZone: string) {
  return new Intl.DateTimeFormat('id-ID', {
    timeZone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(value);
}

function tanggalPendek(value: Date, timeZone: string) {
  return new Intl.DateTimeFormat('id-ID', {
    timeZone,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(value);
}
