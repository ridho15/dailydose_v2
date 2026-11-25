'use client';

import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { apiFetch } from '../../lib/api-client';
import { manageCustomerPackage, packageActionFailure, type CustomerPackageAction } from '../../api-clients/ledger-client';
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
}

export interface PaketMemberClient {
  cari(input: { q: string; filter: Filter; member?: string }): Promise<PaketMember[]>;
  kelola(
    id: string,
    action: CustomerPackageAction,
    input: { reason: string; newValidUntil?: string; expectedValidUntil?: string },
  ): Promise<unknown>;
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
export function PaketMemberView({ client = browserPaketMemberClient }: { client?: PaketMemberClient }) {
  const ctx = useSessionContext();
  const params = useSearchParams();
  const bolehKelola = Boolean(ctx?.hasCapability('customer-package:manage'));
  const bolehJual = Boolean(ctx?.hasCapability('purchase:record'));
  const cabang = useMemo(() => (ctx?.session?.branches ?? []).map((b) => ({ id: b.id, name: b.name })), [ctx?.session?.branches]);

  const [q, setQ] = useState(params?.get('q') ?? '');
  const [member, setMember] = useState(params?.get('member') ?? '');
  const [filter, setFilter] = useState<Filter>('segera');
  const [items, setItems] = useState<PaketMember[] | null>(null);
  const [galat, setGalat] = useState('');
  const [info, setInfo] = useState('');
  const [jual, setJual] = useState<PaketMember | null>(null);
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
    <main className="mx-auto grid max-w-3xl gap-4 p-4 sm:gap-5">
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

      {member && !q ? (
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
            <a href={`/customers/${encodeURIComponent(g.member.id)}`} className="inline-flex min-h-11 items-center text-sm font-semibold text-dd-forest underline-offset-4 hover:underline">
              Profil member
            </a>
          </div>
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

      {jual && (
        <AssistedSaleDrawer
          open
          branch={ctx?.activeBranch ?? (cabang.length === 1 ? cabang[0] : null)}
          branches={cabang}
          customer={{ id: jual.customer.id, name: jual.customer.displayName }}
          perpanjangTargetId={jual.id}
          onClose={() => setJual(null)}
          onRecorded={() => {
            setJual(null);
            setInfo('Perpanjangan berbayar dicatat. Paket aktif lagi setelah pembayaran disetujui di antrean Pembayaran.');
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
          {bolehJual && lewat && p.ledgerBalance > 0 && (
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
