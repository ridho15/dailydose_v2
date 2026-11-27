'use client';

import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { apiFetch } from '../../lib/api-client';
import {
  manageCustomerPackage,
  packageActionFailure,
  paketBisaDipakaiUntukKelas,
  type CustomerPackageAction,
  type LedgerBalance,
} from '../../api-clients/ledger-client';
import { bookingFailure, browserBookingClient } from '../../api-clients/booking-client';
import { Modal } from '../../components/app-feedback';
import { Button, ButtonLink } from '../../components/actions';
import { DateInput, TextInput } from '../../components/forms';
import { Feedback, Skeleton } from '../../ui';
import { useSessionContext } from '../../session-context';
import { AssistedSaleDrawer } from '../../purchases/assisted-sale-drawer';

/** Satu paket member sebagaimana dikirim GET /customer-packages. */
export interface PaketMember {
  id: string;
  status: string;
  expiryAt: string;
  ledgerBalance: number;
  available: number;
  packageName: string;
  branchName: string;
  classTypeName: string;
  customer: { id: string; displayName: string; phoneMasked?: string | null };
  usage?: { initialSessions: number };
  /** Dipakai untuk menentukan kelas yang boleh dibooking dengan paket ini. */
  classTypeId?: string | null;
  isMultiBranch?: boolean;
  packageBranchId?: string | null;
  allowedBranchIds?: string[];
}

/** Booking mendatang satu member (GET /bookings?customerId=…&timeline=UPCOMING). */
export interface BookingRingkas {
  id: string;
  status: string;
  classSlot?: {
    startAt: string;
    timezone?: string;
    classType?: { name?: string } | null;
    branch?: { name?: string } | null;
  } | null;
}

/** Kelas yang bisa dipilih saat staf membooking member. */
export interface SlotRingkas {
  id: string;
  branchId: string;
  classTypeId: string;
  startAt: string;
  capacity: number;
  bookedCount: number;
  status: string;
  classType?: { name?: string } | null;
  instructor?: { displayName?: string } | null;
}

export interface PaketMemberClient {
  cari(input: { q: string; filter: Filter; member?: string }): Promise<PaketMember[]>;
  kelola(
    id: string,
    action: CustomerPackageAction,
    input: { reason: string; newValidUntil?: string; expectedValidUntil?: string },
  ): Promise<unknown>;
  bookingMendatang(memberId: string): Promise<BookingRingkas[]>;
  kelasTersedia(branchId: string | null): Promise<SlotRingkas[]>;
  booking(input: { classSlotId: string; customerPackageId: string; customerUserId: string }): Promise<unknown>;
}

export type Filter = 'segera' | 'berakhir' | 'semua';

export const browserPaketMemberClient: PaketMemberClient = {
  async cari({ q, filter, member }) {
    const p = new URLSearchParams({ pageSize: '50', page: '1' });
    if (member) p.set('customerUserId', member);
    if (q.trim()) p.set('search', q.trim());
    else if (!member && filter === 'segera') p.set('expiringWithinDays', '14');
    else if (!member && filter === 'berakhir') p.set('status', 'EXPIRED');
    const r = await apiFetch<{ items: PaketMember[] }>(`/customer-packages?${p.toString()}`, { label: 'Mencari paket…' });
    // "Sudah berakhir" hanya berguna untuk paket yang masih bersisa sesi (bisa diperpanjang).
    return !q.trim() && !member && filter === 'berakhir' ? r.items.filter((i) => i.ledgerBalance > 0) : r.items;
  },
  kelola: (id, action, input) => manageCustomerPackage(id, action, input),
  async bookingMendatang(memberId) {
    const p = new URLSearchParams({ customerId: memberId, timeline: 'UPCOMING', limit: '5' });
    const r = await apiFetch<{ items: BookingRingkas[] }>(`/bookings?${p.toString()}`, { label: 'Memuat booking member…' });
    return r.items ?? [];
  },
  async kelasTersedia(branchId) {
    const now = new Date();
    const p = new URLSearchParams({
      from: now.toISOString(),
      until: new Date(now.getTime() + 7 * HARI).toISOString(),
      limit: '300',
    });
    if (branchId) p.set('branchId', branchId);
    const r = await apiFetch<{ items: SlotRingkas[] }>(`/class-slots?${p.toString()}`, { label: 'Memuat jadwal kelas…' });
    return r.items ?? [];
  },
  booking: (input) =>
    browserBookingClient.create({ ...input, source: 'ADMIN_ASSISTED' }, `staf-booking:${input.customerUserId}:${input.classSlotId}`),
};

const HARI = 86_400_000;
const tanggalWib = (ms: number) => new Date(ms + 7 * 3_600_000).toISOString().slice(0, 10);
const tampilTanggal = (iso: string) =>
  new Date(iso).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Jakarta' });

/** Selisih hari kalender WIB antara hari ini dan tanggal berakhir (negatif = sudah lewat). */
function sisaHari(expiryAt: string, now = Date.now()) {
  const a = Date.parse(`${tanggalWib(now)}T00:00:00Z`);
  const b = Date.parse(`${tanggalWib(new Date(expiryAt).getTime())}T00:00:00Z`);
  return Math.round((b - a) / HARI);
}

function keteranganBerakhir(p: PaketMember) {
  if (p.status === 'FROZEN') return { teks: 'Dibekukan', nada: 'text-dd-muted' };
  const h = sisaHari(p.expiryAt);
  if (h < 0) return { teks: `Berakhir ${-h} hari lalu`, nada: 'text-dd-danger' };
  if (h === 0) return { teks: 'Berakhir hari ini', nada: 'text-dd-danger' };
  if (h <= 14) return { teks: `${h} hari lagi`, nada: 'text-dd-warning' };
  return { teks: `${h} hari lagi`, nada: 'text-dd-muted' };
}

const ALASAN = ['Sakit atau izin medis', 'Kompensasi kelas batal', 'Persetujuan owner'] as const;
const FILTER: Array<{ id: Filter; label: string }> = [
  { id: 'segera', label: '≤ 14 hari lagi' },
  { id: 'berakhir', label: 'Sudah berakhir' },
  { id: 'semua', label: 'Semua' },
];

/**
 * Paket member dalam satu layar: cari member, lihat semua paketnya sebagai kartu, lalu ubah tanggal
 * berakhir, bekukan, buka kembali, atau jual perpanjangan langsung dari kartunya. Paling banyak tiga
 * langkah: cari, pilih aksi, simpan.
 */
export function PaketMemberView({
  client = browserPaketMemberClient,
  memberTetap,
}: {
  client?: PaketMemberClient;
  /** Mode tanam (profil member): paket satu member saja, tanpa kotak cari dan saringan. */
  memberTetap?: string;
}) {
  const ctx = useSessionContext();
  const params = useSearchParams();
  const bolehKelola = Boolean(ctx?.hasCapability('customer-package:manage'));
  const bolehJual = Boolean(ctx?.hasCapability('purchase:record'));
  const bolehBooking = Boolean(ctx?.hasCapability('booking:create:assisted'));
  const [bookingUntuk, setBookingUntuk] = useState<{ member: PaketMember['customer']; paket: PaketMember[] } | null>(null);
  const cabang = useMemo(() => (ctx?.session?.branches ?? []).map((b) => ({ id: b.id, name: b.name })), [ctx?.session?.branches]);

  const [q, setQ] = useState(memberTetap ? '' : (params?.get('q') ?? ''));
  const [member, setMember] = useState(memberTetap ?? params?.get('member') ?? '');
  // Kotak cari di bilah atas membuka halaman ini dengan ?q= baru: ikuti perubahan alamatnya.
  const qAlamat = params?.get('q') ?? '';
  const memberAlamat = params?.get('member') ?? '';
  useEffect(() => {
    if (memberTetap) return;
    if (qAlamat) {
      setQ(qAlamat);
      setMember('');
    } else if (memberAlamat) {
      setMember(memberAlamat);
      setQ('');
    }
  }, [qAlamat, memberAlamat, memberTetap]);
  const [filter, setFilter] = useState<Filter>('segera');
  const [items, setItems] = useState<PaketMember[] | null>(null);
  const [galat, setGalat] = useState('');
  const [info, setInfo] = useState('');
  const [jual, setJual] = useState<PaketMember | null>(null);
  // Dinaikkan setelah staf membooking, supaya daftar booking mendatang dimuat ulang.
  const [versiBooking, setVersiBooking] = useState(0);
  const permintaan = useRef(0);

  const muat = useCallback(async () => {
    const nomor = ++permintaan.current;
    setGalat('');
    try {
      const hasil = await client.cari({ q, filter, member: member || undefined });
      if (nomor === permintaan.current) setItems(hasil);
    } catch {
      if (nomor === permintaan.current) {
        setItems([]);
        setGalat('Paket belum bisa dimuat. Periksa koneksi lalu coba lagi.');
      }
    }
  }, [client, q, filter, member]);

  useEffect(() => {
    setItems(null);
    const t = setTimeout(() => void muat(), q.trim() ? 300 : 0);
    return () => clearTimeout(t);
  }, [muat, q]);

  // Kelompokkan per member supaya semua paket satu orang terlihat bersama.
  const kelompok = useMemo(() => {
    const peta = new Map<string, { member: PaketMember['customer']; paket: PaketMember[] }>();
    for (const p of items ?? []) {
      const g = peta.get(p.customer.id) ?? { member: p.customer, paket: [] };
      g.paket.push(p);
      peta.set(p.customer.id, g);
    }
    return [...peta.values()];
  }, [items]);

  const namaMember = member ? kelompok[0]?.member.displayName : null;

  return (
    <main className={memberTetap ? 'grid gap-4' : 'mx-auto grid max-w-3xl gap-4 p-4 sm:gap-5'}>
      {!memberTetap && (
      <>
      <header className="grid gap-1">
        <h1 className="m-0 text-xl font-semibold text-dd-ink sm:text-2xl">Paket member</h1>
        <p className="m-0 text-[15px] text-dd-muted">Cari member, lalu ubah masa berlaku atau bekukan paketnya langsung dari kartunya.</p>
      </header>

      <TextInput
        label="Cari member"
        type="search"
        value={q}
        placeholder="Nama, nomor WhatsApp, atau email"
        autoFocus
        onChange={(e) => {
          setQ(e.target.value);
          setMember('');
        }}
        className="text-base sm:text-sm"
      />
      </>
      )}

      {memberTetap ? null : member && !q ? (
        <div className="flex flex-wrap items-center gap-2 text-[15px]">
          <span className="text-dd-muted">Menampilkan paket {namaMember ?? 'member ini'}.</span>
          <Button variant="link" onClick={() => setMember('')}>
            Lihat semua
          </Button>
        </div>
      ) : (
        !q.trim() && (
          <div role="group" aria-label="Saring paket" className="grid grid-cols-3 gap-2 sm:flex">
            {FILTER.map((f) => (
              <button
                key={f.id}
                type="button"
                aria-pressed={filter === f.id}
                onClick={() => setFilter(f.id)}
                className={`min-h-11 rounded-dd-md border px-2 text-sm font-semibold sm:px-3 motion-safe:transition-colors ${
                  filter === f.id ? 'border-dd-ink bg-dd-ink text-white' : 'border-dd-line bg-white text-dd-ink hover:bg-dd-surface'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        )
      )}

      {!memberTetap && (
        <nav aria-label="Halaman paket lainnya" className="flex flex-wrap gap-x-4 text-sm">
          <a href="/ledger/adjustments" className="inline-flex min-h-11 items-center font-semibold text-dd-forest underline-offset-4 hover:underline">
            Penyesuaian sesi
          </a>
          <a href="/workspace/renewal" className="inline-flex min-h-11 items-center font-semibold text-dd-forest underline-offset-4 hover:underline">
            Paket habis &amp; renewal
          </a>
          <a href="/ledger" className="inline-flex min-h-11 items-center font-semibold text-dd-forest underline-offset-4 hover:underline">
            Tabel semua paket
          </a>
        </nav>
      )}

      {info && (
        <Feedback kind="status" onDismiss={() => setInfo('')}>
          {info}
        </Feedback>
      )}
      {galat && <Feedback kind="error">{galat}</Feedback>}

      {items === null && <Skeleton label="Memuat paket member" />}
      {items?.length === 0 && !galat && (
        <p className="m-0 rounded-dd-lg border border-dd-line bg-white p-4 text-[15px] text-dd-muted">
          {q.trim()
            ? `Tidak ada paket untuk "${q.trim()}". Coba nama lain atau nomor WhatsApp.`
            : filter === 'segera'
              ? 'Tidak ada paket yang berakhir dalam 14 hari ke depan.'
              : filter === 'berakhir'
                ? 'Tidak ada paket yang sudah berakhir dan masih bersisa sesi.'
                : 'Belum ada paket member.'}
        </p>
      )}

      {kelompok.map((g) => (
        <section key={g.member.id} aria-labelledby={`m-${g.member.id}`} className="grid gap-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id={`m-${g.member.id}`} className="m-0 text-lg font-semibold text-dd-ink">
              {g.member.displayName}
              {g.member.phoneMasked && <span className="ml-2 text-sm font-normal text-dd-muted">{g.member.phoneMasked}</span>}
            </h2>
            <div className="flex flex-wrap items-center gap-2">
              {bolehBooking && g.paket.some((p) => p.status === 'ACTIVE' && sisaHari(p.expiryAt) >= 0 && p.ledgerBalance > 0) && (
                <Button variant="secondary" onClick={() => setBookingUntuk(g)}>
                  Booking kelas
                </Button>
              )}
              {!memberTetap && (
                <a href={`/customers/${encodeURIComponent(g.member.id)}`} className="inline-flex min-h-11 items-center px-2 text-sm font-semibold text-dd-forest underline-offset-4 hover:underline">
                  Profil member
                </a>
              )}
            </div>
          </div>
          {(member || memberTetap || kelompok.length === 1) && <BookingMendatang client={client} memberId={g.member.id} kunci={versiBooking} />}
          <ul className="m-0 grid list-none gap-2 p-0">
            {g.paket.map((p) => (
              <KartuPaket
                key={p.id}
                paket={p}
                client={client}
                bolehKelola={bolehKelola}
                bolehJual={bolehJual && cabang.length > 0}
                onJual={() => setJual(p)}
                onSelesai={(pesan) => {
                  setInfo(pesan);
                  // Tetap tampilkan paket member ini supaya hasil perubahan terlihat, walau tidak lagi masuk saringan.
                  if (member === g.member.id && !q) void muat();
                  else {
                    setQ('');
                    setMember(g.member.id);
                  }
                }}
              />
            ))}
          </ul>
        </section>
      ))}

      {bookingUntuk && (
        <BookingKelasDialog
          client={client}
          member={bookingUntuk.member}
          paket={bookingUntuk.paket}
          branchId={ctx?.activeBranchId || null}
          onTutup={() => setBookingUntuk(null)}
          onBerhasil={(pesan) => {
            setBookingUntuk(null);
            setInfo(pesan);
            setVersiBooking((v) => v + 1);
            void muat();
          }}
        />
      )}

      {jual && (
        <AssistedSaleDrawer
          open
          branch={ctx?.activeBranch ?? (cabang.length === 1 ? cabang[0] : null)}
          branches={cabang}
          customer={{ id: jual.customer.id, name: jual.customer.displayName }}
          perpanjangTargetId={jual.id}
          onClose={() => setJual(null)}
          onRecorded={(purchase) => {
            setJual(null);
            setInfo(
              purchase?.extension?.targetPackageName
                ? `Perpanjangan ${purchase.extension.targetPackageName} dicatat${purchase.paymentUniqueCode ? ` (kode unik ${String(purchase.paymentUniqueCode).padStart(3, '0')}, total Rp${Number(purchase.payableAmountRp ?? 0).toLocaleString('id-ID')})` : ''}. Menunggu persetujuan di antrean Pembayaran.`
                : 'Perpanjangan berbayar dicatat. Paket aktif lagi setelah pembayaran disetujui di antrean Pembayaran.',
            );
            void muat();
          }}
        />
      )}
    </main>
  );
}

type Mode = null | 'tanggal' | 'bekukan' | 'buka';

function KartuPaket({
  paket: p,
  client,
  bolehKelola,
  bolehJual,
  onJual,
  onSelesai,
}: {
  paket: PaketMember;
  client: PaketMemberClient;
  bolehKelola: boolean;
  bolehJual: boolean;
  onJual: () => void;
  onSelesai: (pesan: string) => void;
}) {
  const [mode, setMode] = useState<Mode>(null);
  const ket = keteranganBerakhir(p);
  const lewat = sisaHari(p.expiryAt) < 0 && p.status !== 'FROZEN';
  const total = p.usage?.initialSessions;

  return (
    <li className="rounded-dd-lg border border-dd-line bg-white">
      <div className="grid gap-3 p-4 sm:grid-cols-[1fr_auto] sm:items-center">
        <div className="grid min-w-0 gap-0.5">
          <span className="text-[15px] font-semibold text-dd-ink">{p.packageName}</span>
          <span className="text-sm text-dd-muted">
            {p.classTypeName} · {p.branchName}
          </span>
        </div>
        <dl className="m-0 grid grid-cols-2 gap-3 sm:flex sm:gap-6 sm:text-right">
          <div>
            <dt className="text-xs text-dd-muted">Sisa sesi</dt>
            <dd className="m-0 text-lg font-semibold tabular-nums text-dd-ink">
              {p.ledgerBalance}
              {total ? <span className="text-sm font-normal text-dd-muted"> / {total}</span> : null}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-dd-muted">Berakhir</dt>
            <dd className="m-0 grid">
              <span className="text-[15px] font-semibold text-dd-ink">{tampilTanggal(p.expiryAt)}</span>
              <span className={`text-sm font-medium ${ket.nada}`}>{ket.teks}</span>
            </dd>
          </div>
        </dl>
      </div>

      {(bolehKelola || bolehJual) && mode === null && (
        <div className="grid grid-cols-2 gap-2 border-t border-dd-line p-3 sm:flex sm:flex-wrap">
          {bolehKelola && p.status !== 'FROZEN' && p.ledgerBalance > 0 && (
            <Button variant="secondary" onClick={() => setMode('tanggal')}>
              Ubah tanggal berakhir
            </Button>
          )}
          {bolehJual && p.status !== 'FROZEN' && p.ledgerBalance > 0 && (
            <Button variant="secondary" onClick={onJual}>
              Jual perpanjangan
            </Button>
          )}
          {bolehKelola && p.status === 'ACTIVE' && !lewat && (
            <Button variant="secondary" onClick={() => setMode('bekukan')}>
              Bekukan
            </Button>
          )}
          {bolehKelola && p.status === 'FROZEN' && (
            <Button variant="secondary" onClick={() => setMode('buka')}>
              Buka kembali
            </Button>
          )}
          <ButtonLink variant="ghost" href={`/ledger/${encodeURIComponent(p.id)}`}>
            Riwayat sesi
          </ButtonLink>
        </div>
      )}

      {mode && (
        <FormAksi
          paket={p}
          mode={mode}
          client={client}
          onBatal={() => setMode(null)}
          onSelesai={(pesan) => {
            setMode(null);
            onSelesai(pesan);
          }}
        />
      )}
    </li>
  );
}

function FormAksi({
  paket: p,
  mode,
  client,
  onBatal,
  onSelesai,
}: {
  paket: PaketMember;
  mode: Exclude<Mode, null>;
  client: PaketMemberClient;
  onBatal: () => void;
  onSelesai: (pesan: string) => void;
}) {
  // Tambahan hari dihitung dari tanggal berakhir saat ini, atau dari hari ini bila sudah lewat.
  const dasar = Math.max(new Date(p.expiryAt).getTime(), Date.now());
  const [tanggal, setTanggal] = useState(mode === 'tanggal' ? tanggalWib(dasar + 30 * HARI) : '');
  const [alasan, setAlasan] = useState('');
  const [lainnya, setLainnya] = useState('');
  const [sibuk, setSibuk] = useState(false);
  const [galat, setGalat] = useState('');

  const alasanFinal = alasan === 'Lainnya' ? lainnya.trim() : alasan;
  const selisih = tanggal
    ? Math.round((Date.parse(`${tanggal}T00:00:00Z`) - Date.parse(`${tanggalWib(new Date(p.expiryAt).getTime())}T00:00:00Z`)) / HARI)
    : 0;
  const tanggalSah = mode !== 'tanggal' || (Boolean(tanggal) && tanggal >= tanggalWib(Date.now()));
  const siap = alasanFinal.length >= 3 && tanggalSah;

  const judul = mode === 'tanggal' ? 'Tanggal berakhir baru' : mode === 'bekukan' ? 'Bekukan paket ini?' : 'Buka kembali paket ini?';
  const tombol = mode === 'tanggal' ? 'Simpan tanggal' : mode === 'bekukan' ? 'Bekukan' : 'Buka kembali';

  const kirim = async (e: FormEvent) => {
    e.preventDefault();
    if (!siap || sibuk) return;
    setSibuk(true);
    setGalat('');
    try {
      const action: CustomerPackageAction = mode === 'tanggal' ? 'extend' : mode === 'bekukan' ? 'freeze' : 'unfreeze';
      await client.kelola(p.id, action, {
        reason: alasanFinal,
        expectedValidUntil: p.expiryAt,
        ...(mode === 'tanggal' ? { newValidUntil: tanggal } : {}),
      });
      onSelesai(
        mode === 'tanggal'
          ? `${p.customer.displayName}: ${p.packageName} sekarang berakhir ${tampilTanggal(`${tanggal}T12:00:00+07:00`)}.`
          : mode === 'bekukan'
            ? `${p.customer.displayName}: ${p.packageName} dibekukan. Member tidak bisa booking sampai dibuka kembali.`
            : `${p.customer.displayName}: ${p.packageName} aktif lagi. Masa berlaku bertambah sepanjang paket dibekukan.`,
      );
    } catch (error) {
      setGalat(packageActionFailure(error));
      setSibuk(false);
    }
  };

  return (
    <form onSubmit={(e) => void kirim(e)} className="grid gap-4 border-t border-dd-line bg-dd-surface p-4" aria-label={judul}>
      <h3 className="m-0 text-[15px] font-semibold text-dd-ink">{judul}</h3>

      {mode === 'tanggal' && (
        <div className="grid gap-2">
          <div role="group" aria-label="Tambah hari" className="grid grid-cols-4 gap-2">
            {[7, 14, 30, 60].map((d) => {
              const nilai = tanggalWib(dasar + d * HARI);
              return (
                <button
                  key={d}
                  type="button"
                  aria-pressed={tanggal === nilai}
                  onClick={() => setTanggal(nilai)}
                  className={`min-h-11 rounded-dd-md border text-sm font-semibold motion-safe:transition-colors ${
                    tanggal === nilai ? 'border-dd-forest bg-dd-forest text-white' : 'border-dd-line bg-white text-dd-ink hover:border-dd-forest'
                  }`}
                >
                  +{d} hari
                </button>
              );
            })}
          </div>
          <DateInput label="Atau pilih tanggal" value={tanggal} min={tanggalWib(Date.now())} onChange={(e) => setTanggal(e.target.value)} className="text-base sm:text-sm" />
          {tanggal && (
            <p className="m-0 text-sm text-dd-muted" aria-live="polite">
              Dari {tampilTanggal(p.expiryAt)} menjadi <strong className="text-dd-ink">{tampilTanggal(`${tanggal}T12:00:00+07:00`)}</strong>
              {selisih !== 0 ? ` (${selisih > 0 ? '+' : ''}${selisih} hari)` : ''}. Sisa sesi tidak berubah.
            </p>
          )}
        </div>
      )}
      {mode === 'bekukan' && (
        <p className="m-0 text-sm text-dd-muted">
          Selama dibekukan member tidak bisa booking. Masa berlaku bertambah sepanjang paket dibekukan saat dibuka kembali.
        </p>
      )}

      <fieldset className="m-0 grid gap-2 border-0 p-0">
        <legend className="mb-2 text-sm font-semibold text-dd-ink">Alasan</legend>
        <div className="flex flex-wrap gap-2">
          {[...ALASAN, 'Lainnya'].map((a) => (
            <button
              key={a}
              type="button"
              aria-pressed={alasan === a}
              onClick={() => setAlasan(a)}
              className={`min-h-11 rounded-dd-md border px-3 text-sm motion-safe:transition-colors ${
                alasan === a ? 'border-dd-ink bg-dd-ink font-semibold text-white' : 'border-dd-line bg-white text-dd-ink hover:border-dd-ink'
              }`}
            >
              {a}
            </button>
          ))}
        </div>
        {alasan === 'Lainnya' && (
          <TextInput label="Tulis alasannya" value={lainnya} maxLength={500} onChange={(e) => setLainnya(e.target.value)} className="text-base sm:text-sm" />
        )}
      </fieldset>

      {galat && (
        <p role="alert" className="m-0 text-sm font-medium text-dd-danger">
          {galat}
        </p>
      )}

      <div className="grid grid-cols-2 gap-2 sm:flex">
        <Button type="submit" disabled={!siap} loading={sibuk} variant={mode === 'bekukan' ? 'danger' : 'primary'}>
          {tombol}
        </Button>
        <Button variant="secondary" disabled={sibuk} onClick={onBatal}>
          Batal
        </Button>
      </div>
    </form>
  );
}

const tampilWaktu = (iso: string, timezone = 'Asia/Jakarta') =>
  new Date(iso).toLocaleString('id-ID', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: timezone });

function BookingMendatang({ client, memberId, kunci }: { client: PaketMemberClient; memberId: string; kunci: number }) {
  const [items, setItems] = useState<BookingRingkas[] | null>(null);
  const [galat, setGalat] = useState(false);
  useEffect(() => {
    let batal = false;
    setGalat(false);
    client
      .bookingMendatang(memberId)
      .then((r) => !batal && setItems(r))
      .catch(() => {
        if (!batal) {
          setItems([]);
          setGalat(true);
        }
      });
    return () => {
      batal = true;
    };
  }, [client, memberId, kunci]);

  if (items === null) return null;
  return (
    <div className="rounded-dd-lg border border-dd-line bg-white p-4">
      <h3 className="m-0 text-[15px] font-semibold text-dd-ink">Booking mendatang</h3>
      {galat ? (
        <p className="m-0 mt-1 text-sm text-dd-muted">Booking belum bisa dimuat. Muat ulang halaman untuk mencoba lagi.</p>
      ) : items.length === 0 ? (
        <p className="m-0 mt-1 text-sm text-dd-muted">Belum ada booking mendatang.</p>
      ) : (
        <ul className="m-0 mt-2 grid list-none gap-1 p-0">
          {items.map((b) => (
            <li key={b.id}>
              <a
                href={`/workspace/bookings/${encodeURIComponent(b.id)}`}
                className="flex min-h-11 flex-wrap items-center justify-between gap-2 rounded-dd-md px-2 text-[15px] text-dd-ink no-underline hover:bg-dd-surface"
              >
                <span className="font-semibold">{b.classSlot?.classType?.name ?? 'Kelas'}</span>
                <span className="text-sm text-dd-muted">
                  {b.classSlot ? tampilWaktu(b.classSlot.startAt, b.classSlot.timezone) : ''}
                  {b.classSlot?.branch?.name ? ` · ${b.classSlot.branch.name}` : ''}
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Paket pertama yang boleh dipakai untuk kelas itu (yang paling cepat berakhir dipakai lebih dulu). */
function paketUntukKelas(paket: PaketMember[], slot: SlotRingkas) {
  return [...paket]
    .sort((a, b) => Date.parse(a.expiryAt) - Date.parse(b.expiryAt))
    .find((p) =>
      paketBisaDipakaiUntukKelas(
        {
          isMultiBranch: p.isMultiBranch,
          packageBranchId: p.packageBranchId ?? null,
          allowedBranchIds: p.allowedBranchIds,
          classTypeId: p.classTypeId ?? null,
          expiryAt: new Date(p.expiryAt),
          available: p.available,
          status: p.status,
        } as Pick<LedgerBalance, 'isMultiBranch' | 'packageBranchId' | 'allowedBranchIds' | 'classTypeId' | 'expiryAt' | 'available' | 'status'>,
        slot,
      ),
    );
}

/**
 * Staf membooking member ke kelas dalam dua klik: pilih kelas dari 7 hari ke depan (hanya yang masih
 * ada kursi dan cocok dengan paket member), lalu sistem memakai paket yang paling cepat berakhir.
 */
function BookingKelasDialog({
  client,
  member,
  paket,
  branchId,
  onTutup,
  onBerhasil,
}: {
  client: PaketMemberClient;
  member: PaketMember['customer'];
  paket: PaketMember[];
  branchId: string | null;
  onTutup: () => void;
  onBerhasil: (pesan: string) => void;
}) {
  const [slots, setSlots] = useState<SlotRingkas[] | null>(null);
  const [galat, setGalat] = useState('');
  const [sibuk, setSibuk] = useState<string | null>(null);

  useEffect(() => {
    let batal = false;
    client
      .kelasTersedia(branchId)
      .then((r) => !batal && setSlots(r))
      .catch(() => {
        if (!batal) {
          setSlots([]);
          setGalat('Jadwal kelas belum bisa dimuat. Periksa koneksi lalu coba lagi.');
        }
      });
    return () => {
      batal = true;
    };
  }, [client, branchId]);

  const sekarang = Date.now();
  const pilihan = (slots ?? [])
    .filter((s) => ['PUBLISHED', 'CONFIRMED'].includes(s.status) && Date.parse(s.startAt) > sekarang && s.bookedCount < s.capacity)
    .map((s) => ({ slot: s, paket: paketUntukKelas(paket, s) }))
    .filter((x): x is { slot: SlotRingkas; paket: PaketMember } => Boolean(x.paket))
    .sort((a, b) => Date.parse(a.slot.startAt) - Date.parse(b.slot.startAt));

  const pesan = async (slot: SlotRingkas, p: PaketMember) => {
    setSibuk(slot.id);
    setGalat('');
    try {
      await client.booking({ classSlotId: slot.id, customerPackageId: p.id, customerUserId: member.id });
      onBerhasil(`${member.displayName} dibooking ke ${slot.classType?.name ?? 'kelas'}, ${tampilWaktu(slot.startAt)} (paket ${p.packageName}).`);
    } catch (error) {
      setGalat(await bookingFailure(error));
      setSibuk(null);
    }
  };

  return (
    <Modal open title={`Booking kelas untuk ${member.displayName}`} description="Kelas 7 hari ke depan yang masih ada kursi dan cocok dengan paket member." onClose={onTutup} busy={Boolean(sibuk)}>
      {galat && (
        <p role="alert" className="m-0 mb-3 text-sm font-medium text-dd-danger">
          {galat}
        </p>
      )}
      {slots === null ? (
        <Skeleton label="Memuat jadwal kelas" />
      ) : pilihan.length === 0 ? (
        <p className="m-0 text-[15px] text-dd-muted">
          Tidak ada kelas 7 hari ke depan yang cocok dengan paket member ini dan masih ada kursi. Coba pilih cabang lain di bilah atas.
        </p>
      ) : (
        <ul className="m-0 grid max-h-[60vh] list-none gap-2 overflow-y-auto p-0">
          {pilihan.map(({ slot, paket: p }) => (
            <li key={slot.id} className="flex flex-wrap items-center justify-between gap-3 rounded-dd-lg border border-dd-line p-3">
              <span className="grid min-w-0 gap-0.5">
                <span className="text-[15px] font-semibold text-dd-ink">{slot.classType?.name ?? 'Kelas'}</span>
                <span className="text-sm text-dd-muted">
                  {tampilWaktu(slot.startAt)}
                  {slot.instructor?.displayName ? ` · ${slot.instructor.displayName}` : ''} · sisa {slot.capacity - slot.bookedCount} kursi
                </span>
              </span>
              <Button loading={sibuk === slot.id} disabled={Boolean(sibuk)} onClick={() => void pesan(slot, p)} aria-label={`Booking ${slot.classType?.name ?? 'kelas'} ${tampilWaktu(slot.startAt)}`}>
                Booking
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
