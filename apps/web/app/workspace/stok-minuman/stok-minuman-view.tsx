'use client';

import { type FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../../lib/api-client';
import { Button } from '../../components/actions';
import { DateInput, SelectInput, TextInput } from '../../components/forms';
import { Feedback, Skeleton } from '../../ui';
import { useSessionContext } from '../../session-context';

export type JenisMutasi = 'MASUK' | 'DIJUAL' | 'DIPAKAI_OWNER';

export interface BarangMinuman {
  id: string;
  nama: string;
  satuan: string;
  hargaJualRp: number | null;
  aktif: boolean;
}

export interface Mutasi {
  id: string;
  barangId: string;
  namaBarang: string;
  satuan: string;
  jenis: JenisMutasi;
  jumlah: number;
  hargaSatuanRp: number;
  totalRp: number;
  tanggal: string;
  catatan: string | null;
  oleh: string | null;
}

export interface StokMinumanClient {
  barang(semua: boolean): Promise<{ items: BarangMinuman[] }>;
  stok(branchId: string): Promise<{ items: Array<{ barang: BarangMinuman; stok: number }> }>;
  riwayat(branchId: string, cursor?: string): Promise<{ items: Mutasi[]; nextCursor: string | null }>;
  catat(input: {
    branchId: string;
    barangId: string;
    jenis: JenisMutasi;
    jumlah: number;
    hargaSatuanRp?: number;
    tanggal: string;
    catatan?: string;
  }): Promise<Mutasi & { stokSesudah: number }>;
  buatBarang(input: { nama: string; satuan: string; hargaJualRp: number | null }): Promise<BarangMinuman>;
  ubahBarang(id: string, input: Partial<Pick<BarangMinuman, 'nama' | 'satuan' | 'hargaJualRp' | 'aktif'>>): Promise<BarangMinuman>;
}

const q = (v: string) => encodeURIComponent(v);
export const browserStokMinumanClient: StokMinumanClient = {
  barang: (semua) => apiFetch(`/drinks${semua ? '?semua=1' : ''}`, { label: 'Memuat barang minuman…' }),
  stok: (branchId) => apiFetch(`/drinks/stock?branchId=${q(branchId)}`, { label: 'Memuat stok…' }),
  riwayat: (branchId, cursor) =>
    apiFetch(`/drinks/movements?branchId=${q(branchId)}${cursor ? `&cursor=${q(cursor)}` : ''}`, { label: 'Memuat riwayat…' }),
  catat: (input) => apiFetch('/drinks/movements', { method: 'POST', body: JSON.stringify(input), label: 'Mencatat stok…' }),
  buatBarang: (input) => apiFetch('/drinks', { method: 'POST', body: JSON.stringify(input), label: 'Menambah barang…' }),
  ubahBarang: (id, input) => apiFetch(`/drinks/${q(id)}`, { method: 'PATCH', body: JSON.stringify(input), label: 'Menyimpan barang…' }),
};

export const LABEL_JENIS: Record<JenisMutasi, string> = {
  MASUK: 'Barang masuk',
  DIJUAL: 'Dijual',
  DIPAKAI_OWNER: 'Dipakai owner',
};

const rupiah = (n: number) => `Rp${n.toLocaleString('id-ID')}`;
const hariIniWib = () => new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);

export function pesanGalatStok(error: unknown): string {
  const e = error as { data?: { code?: string; error?: { code?: string; details?: Array<{ field?: string; issue?: string }> } } };
  const code = e?.data?.error?.code ?? e?.data?.code ?? '';
  const detail = e?.data?.error?.details?.[0];
  if (code === 'DRINK_STOCK_INSUFFICIENT') {
    const sisa = detail?.issue?.startsWith('STOK_') ? detail.issue.slice(5) : null;
    return `Stok tidak cukup${sisa !== null ? ` (sisa ${sisa})` : ''}. Catat barang masuk dulu atau kurangi jumlahnya.`;
  }
  if (code === 'DRINK_STOCK_UNAVAILABLE')
    return 'Fitur stok minuman belum aktif di server (tabel barang_minuman dan mutasi_stok_minuman belum dibuat). Hubungi pengembang.';
  if (code === 'DRINK_NAME_TAKEN') return 'Nama barang itu sudah ada. Pakai nama lain atau ubah barang yang sudah ada.';
  if (code === 'DRINK_INACTIVE') return 'Barang ini nonaktif. Aktifkan dulu di Master barang sebelum mencatat barang masuk.';
  if (code === 'FORBIDDEN') return 'Anda tidak punya akses ke stok cabang ini.';
  if (detail?.field === 'hargaSatuanRp')
    return 'Isi harga per satuan. Untuk penjualan, harga harus lebih dari Rp0 (atau isi harga jual di Master barang).';
  if (detail?.field === 'jumlah') return 'Jumlah harus angka bulat 1 sampai 10.000.';
  if (detail?.field === 'tanggal') return 'Tanggal tidak boleh melewati hari ini.';
  if (detail?.field === 'nama') return 'Nama barang 2 sampai 80 karakter.';
  if (detail?.field === 'satuan') return 'Isi satuan, misalnya botol, kaleng, atau gelas.';
  return 'Permintaan belum berhasil. Periksa koneksi lalu coba lagi.';
}

type Tab = 'stok' | 'catat' | 'riwayat' | 'master';

/**
 * Stok minuman per cabang. Barang masuk otomatis tercatat sebagai pengeluaran cabang (Jurnal kas,
 * kategori "Beli stok minuman"); barang keluar hanya dijual (menambah laba) atau dipakai owner.
 */
export function StokMinumanView({ client = browserStokMinumanClient }: { client?: StokMinumanClient }) {
  const ctx = useSessionContext();
  const session = ctx?.session;
  const bolehCatat = Boolean(ctx?.hasCapability('inventory:record'));
  const bolehKelola = Boolean(ctx?.hasCapability('inventory:manage'));
  const cabangList = useMemo(() => (session?.branches ?? []).map((b) => ({ id: b.id, name: b.name })), [session?.branches]);
  const [branchId, setBranchId] = useState(ctx?.activeBranchId || cabangList[0]?.id || '');
  const [tab, setTab] = useState<Tab>('stok');
  const [stok, setStok] = useState<Array<{ barang: BarangMinuman; stok: number }> | null>(null);
  const [galat, setGalat] = useState('');
  const [info, setInfo] = useState('');

  useEffect(() => {
    if (!branchId && cabangList[0]) setBranchId(ctx?.activeBranchId || cabangList[0].id);
  }, [branchId, cabangList, ctx?.activeBranchId]);

  const muatStok = useCallback(async () => {
    if (!branchId) return;
    setStok(null);
    try {
      setStok((await client.stok(branchId)).items);
    } catch (error) {
      setGalat(pesanGalatStok(error));
      setStok([]);
    }
  }, [branchId, client]);
  useEffect(() => void muatStok(), [muatStok]);

  const tabs: Array<{ id: Tab; label: string }> = [
    { id: 'stok', label: 'Stok' },
    ...(bolehCatat ? [{ id: 'catat' as const, label: 'Catat masuk/keluar' }] : []),
    { id: 'riwayat', label: 'Riwayat' },
    ...(bolehKelola ? [{ id: 'master' as const, label: 'Master barang' }] : []),
  ];

  return (
    <main className="mx-auto grid max-w-4xl gap-5 p-4">
      <header className="grid gap-1">
        <h1 className="m-0 text-2xl font-semibold text-dd-ink">Stok Minuman</h1>
        <p className="m-0 text-[15px] text-dd-muted">
          Barang masuk otomatis jadi pengeluaran cabang di Jurnal kas. Barang keluar dicatat sebagai dijual (masuk laba) atau
          dipakai owner.
        </p>
      </header>

      {cabangList.length > 1 && (
        <SelectInput label="Cabang" value={branchId} onChange={(e) => setBranchId(e.target.value)} wrapperClassName="max-w-xs">
          {cabangList.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </SelectInput>
      )}

      <div role="tablist" aria-label="Bagian stok minuman" className="flex flex-wrap gap-2">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => {
              setTab(t.id);
              setGalat('');
              setInfo('');
            }}
            className={`min-h-11 rounded-dd-md border px-4 text-[15px] font-semibold motion-safe:transition-colors ${
              tab === t.id ? 'border-dd-ink bg-dd-ink text-white' : 'border-dd-line bg-white text-dd-ink hover:bg-dd-surface'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {info && <Feedback kind="status">{info}</Feedback>}
      {galat && <Feedback kind="error">{galat}</Feedback>}

      {tab === 'stok' && <TabelStok stok={stok} />}
      {tab === 'catat' && bolehCatat && (
        <FormCatat
          client={client}
          branchId={branchId}
          barang={(stok ?? []).filter((s) => s.barang.aktif || s.stok > 0)}
          onBerhasil={(pesan) => {
            setGalat('');
            setInfo(pesan);
            void muatStok();
          }}
          onGalat={(pesan) => {
            setInfo('');
            setGalat(pesan);
          }}
        />
      )}
      {tab === 'riwayat' && <Riwayat client={client} branchId={branchId} />}
      {tab === 'master' && bolehKelola && (
        <MasterBarang
          client={client}
          onBerubah={() => void muatStok()}
          onGalat={(pesan) => {
            setInfo('');
            setGalat(pesan);
          }}
          onInfo={(pesan) => {
            setGalat('');
            setInfo(pesan);
          }}
        />
      )}
    </main>
  );
}

function TabelStok({ stok }: { stok: Array<{ barang: BarangMinuman; stok: number }> | null }) {
  if (stok === null) return <Skeleton label="Memuat stok minuman" />;
  if (stok.length === 0)
    return (
      <p className="m-0 rounded-dd-lg border border-dd-line bg-white p-4 text-[15px] text-dd-muted">
        Belum ada barang minuman. Manager atau Super Owner menambahkannya di tab Master barang.
      </p>
    );
  return (
    <ul className="m-0 grid list-none rounded-dd-lg border border-dd-line bg-white p-0">
      {stok.map(({ barang, stok: n }) => (
        <li key={barang.id} className="flex items-center justify-between gap-3 border-b border-dd-line px-4 py-3 last:border-b-0">
          <div className="grid gap-0.5">
            <span className="text-[15px] font-semibold text-dd-ink">{barang.nama}</span>
            <span className="text-sm text-dd-muted">
              {barang.hargaJualRp !== null ? `Harga jual ${rupiah(barang.hargaJualRp)} / ${barang.satuan}` : 'Harga jual belum diisi'}
              {!barang.aktif ? ' · nonaktif' : ''}
            </span>
          </div>
          <span className={`text-lg font-semibold tabular-nums ${n <= 0 ? 'text-dd-danger' : n < 5 ? 'text-dd-warning' : 'text-dd-ink'}`}>
            {n} {barang.satuan}
          </span>
        </li>
      ))}
    </ul>
  );
}

function FormCatat({
  client,
  branchId,
  barang,
  onBerhasil,
  onGalat,
}: {
  client: StokMinumanClient;
  branchId: string;
  barang: Array<{ barang: BarangMinuman; stok: number }>;
  onBerhasil: (pesan: string) => void;
  onGalat: (pesan: string) => void;
}) {
  const [jenis, setJenis] = useState<JenisMutasi>('MASUK');
  const [barangId, setBarangId] = useState('');
  const [jumlah, setJumlah] = useState('');
  const [harga, setHarga] = useState('');
  const [tanggal, setTanggal] = useState(hariIniWib);
  const [catatan, setCatatan] = useState('');
  const [sibuk, setSibuk] = useState(false);

  const pilihan = barang.find((b) => b.barang.id === barangId);
  const n = Number(jumlah);
  const h = harga === '' ? (jenis === 'DIJUAL' ? (pilihan?.barang.hargaJualRp ?? NaN) : NaN) : Number(harga);
  const butuhHarga = jenis !== 'DIPAKAI_OWNER';
  const jumlahValid = Number.isInteger(n) && n >= 1 && n <= 10_000;
  const hargaValid = !butuhHarga || (Number.isInteger(h) && (jenis === 'DIJUAL' ? h > 0 : h >= 0));
  const stokCukup = jenis === 'MASUK' || !pilihan || n <= pilihan.stok;
  const siap = Boolean(branchId && pilihan && jumlahValid && hargaValid && stokCukup && tanggal);

  const kirim = async (e: FormEvent) => {
    e.preventDefault();
    if (!siap || sibuk || !pilihan) return;
    setSibuk(true);
    try {
      const hasil = await client.catat({
        branchId,
        barangId,
        jenis,
        jumlah: n,
        ...(butuhHarga ? { hargaSatuanRp: h } : {}),
        tanggal,
        ...(catatan.trim() ? { catatan: catatan.trim() } : {}),
      });
      const nilai = jenis === 'MASUK' ? ` senilai ${rupiah(hasil.totalRp)} dan masuk pengeluaran cabang` : jenis === 'DIJUAL' ? ` senilai ${rupiah(hasil.totalRp)}` : '';
      onBerhasil(`${LABEL_JENIS[jenis]}: ${hasil.namaBarang} ${n} ${hasil.satuan}${nilai}. Stok sekarang ${hasil.stokSesudah}.`);
      setJumlah('');
      setHarga('');
      setCatatan('');
    } catch (error) {
      onGalat(pesanGalatStok(error));
    } finally {
      setSibuk(false);
    }
  };

  return (
    <form onSubmit={(e) => void kirim(e)} className="grid gap-3 rounded-dd-lg border border-dd-line bg-white p-4 sm:grid-cols-2">
      <fieldset className="m-0 grid gap-2 border-0 p-0 sm:col-span-2">
        <legend className="mb-2 text-[15px] font-semibold text-dd-ink">Jenis</legend>
        <div className="flex flex-wrap gap-2">
          {(Object.keys(LABEL_JENIS) as JenisMutasi[]).map((j) => (
            <label
              key={j}
              className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-dd-md border px-4 text-[15px] ${
                jenis === j ? 'border-dd-ink bg-dd-surface font-semibold' : 'border-dd-line'
              }`}
            >
              <input type="radio" name="jenis" value={j} checked={jenis === j} onChange={() => setJenis(j)} />
              {LABEL_JENIS[j]}
            </label>
          ))}
        </div>
      </fieldset>
      <SelectInput label="Barang" value={barangId} onChange={(e) => setBarangId(e.target.value)}>
        <option value="">Pilih barang</option>
        {barang.map(({ barang: b, stok }) => (
          <option key={b.id} value={b.id}>
            {b.nama} (stok {stok} {b.satuan})
          </option>
        ))}
      </SelectInput>
      <TextInput
        label={`Jumlah${pilihan ? ` (${pilihan.barang.satuan})` : ''}`}
        inputMode="numeric"
        value={jumlah}
        onChange={(e) => setJumlah(e.target.value.replace(/\D/g, ''))}
        error={jumlah && !stokCukup ? `Stok hanya ${pilihan?.stok ?? 0}.` : undefined}
      />
      {butuhHarga && (
        <TextInput
          label={jenis === 'MASUK' ? 'Harga beli per satuan (Rp)' : 'Harga jual per satuan (Rp)'}
          inputMode="numeric"
          value={harga}
          placeholder={jenis === 'DIJUAL' && pilihan?.barang.hargaJualRp ? String(pilihan.barang.hargaJualRp) : undefined}
          onChange={(e) => setHarga(e.target.value.replace(/\D/g, ''))}
          description={
            jenis === 'DIJUAL' && pilihan?.barang.hargaJualRp
              ? `Kosongkan untuk memakai harga jual ${rupiah(pilihan.barang.hargaJualRp)}.`
              : undefined
          }
        />
      )}
      <DateInput label="Tanggal" value={tanggal} max={hariIniWib()} onChange={(e) => setTanggal(e.target.value)} />
      <TextInput
        label="Catatan (opsional)"
        value={catatan}
        maxLength={200}
        onChange={(e) => setCatatan(e.target.value)}
        wrapperClassName="sm:col-span-2"
      />
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
        <Button type="submit" disabled={!siap} loading={sibuk}>
          Catat {LABEL_JENIS[jenis].toLowerCase()}
        </Button>
        {siap && butuhHarga && <span className="text-[15px] text-dd-muted">Total {rupiah(n * h)}</span>}
      </div>
      <p className="m-0 text-sm text-dd-muted sm:col-span-2">
        Catatan stok tidak bisa diubah atau dihapus. Bila salah, catat kebalikannya dengan keterangan di kolom catatan.
      </p>
    </form>
  );
}

function Riwayat({ client, branchId }: { client: StokMinumanClient; branchId: string }) {
  const [items, setItems] = useState<Mutasi[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [galat, setGalat] = useState('');
  const [sibuk, setSibuk] = useState(false);

  const muat = useCallback(
    async (lanjut?: string) => {
      if (!branchId) return;
      setSibuk(true);
      setGalat('');
      try {
        const r = await client.riwayat(branchId, lanjut);
        setItems((lama) => (lanjut ? [...(lama ?? []), ...r.items] : r.items));
        setCursor(r.nextCursor);
      } catch (error) {
        setGalat(pesanGalatStok(error));
        setItems((lama) => lama ?? []);
      } finally {
        setSibuk(false);
      }
    },
    [branchId, client],
  );
  useEffect(() => {
    setItems(null);
    void muat();
  }, [muat]);

  if (items === null) return <Skeleton label="Memuat riwayat stok" />;
  return (
    <section className="grid gap-3">
      {galat && <Feedback kind="error">{galat}</Feedback>}
      {items.length === 0 && !galat && (
        <p className="m-0 rounded-dd-lg border border-dd-line bg-white p-4 text-[15px] text-dd-muted">Belum ada catatan stok di cabang ini.</p>
      )}
      {items.length > 0 && (
        <ul className="m-0 grid list-none rounded-dd-lg border border-dd-line bg-white p-0">
          {items.map((m) => (
            <li key={m.id} className="grid gap-0.5 border-b border-dd-line px-4 py-3 last:border-b-0">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-[15px] font-semibold text-dd-ink">
                  {m.jenis === 'MASUK' ? '+' : '−'}
                  {m.jumlah} {m.satuan} {m.namaBarang}
                </span>
                <span className="text-sm text-dd-muted">{m.tanggal}</span>
              </div>
              <span className="text-sm text-dd-muted">
                {LABEL_JENIS[m.jenis]}
                {m.totalRp > 0 ? ` · ${rupiah(m.totalRp)}` : ''}
                {m.oleh ? ` · oleh ${m.oleh}` : ''}
                {m.catatan ? ` · ${m.catatan}` : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
      {cursor && (
        <div>
          <Button variant="secondary" loading={sibuk} onClick={() => void muat(cursor)}>
            Muat lebih banyak
          </Button>
        </div>
      )}
    </section>
  );
}

function MasterBarang({
  client,
  onBerubah,
  onGalat,
  onInfo,
}: {
  client: StokMinumanClient;
  onBerubah: () => void;
  onGalat: (pesan: string) => void;
  onInfo: (pesan: string) => void;
}) {
  const [items, setItems] = useState<BarangMinuman[] | null>(null);
  const [form, setForm] = useState({ nama: '', satuan: 'botol', harga: '' });
  const [edit, setEdit] = useState<{ id: string; nama: string; satuan: string; harga: string } | null>(null);
  const [sibuk, setSibuk] = useState(false);

  const muat = useCallback(async () => {
    try {
      setItems((await client.barang(true)).items);
    } catch (error) {
      onGalat(pesanGalatStok(error));
      setItems([]);
    }
  }, [client, onGalat]);
  useEffect(() => void muat(), [muat]);

  const harga = (v: string) => (v === '' ? null : Number(v));
  const siap = form.nama.trim().length >= 2 && form.satuan.trim().length >= 1;

  const jalankan = async (aksi: () => Promise<unknown>, pesan: string) => {
    setSibuk(true);
    try {
      await aksi();
      onInfo(pesan);
      void muat();
      onBerubah();
      return true;
    } catch (error) {
      onGalat(pesanGalatStok(error));
      return false;
    } finally {
      setSibuk(false);
    }
  };

  const tambah = async (e: FormEvent) => {
    e.preventDefault();
    if (!siap || sibuk) return;
    const ok = await jalankan(
      () => client.buatBarang({ nama: form.nama.trim(), satuan: form.satuan.trim(), hargaJualRp: harga(form.harga) }),
      `${form.nama.trim()} ditambahkan.`,
    );
    if (ok) setForm({ nama: '', satuan: form.satuan, harga: '' });
  };

  return (
    <section className="grid gap-4">
      <form onSubmit={(e) => void tambah(e)} className="grid gap-3 rounded-dd-lg border border-dd-line bg-white p-4 sm:grid-cols-3">
        <h2 className="m-0 text-lg font-semibold text-dd-ink sm:col-span-3">Tambah barang</h2>
        <TextInput label="Nama barang" value={form.nama} maxLength={80} onChange={(e) => setForm((f) => ({ ...f, nama: e.target.value }))} />
        <TextInput label="Satuan" value={form.satuan} maxLength={20} onChange={(e) => setForm((f) => ({ ...f, satuan: e.target.value }))} />
        <TextInput
          label="Harga jual (Rp, opsional)"
          inputMode="numeric"
          value={form.harga}
          onChange={(e) => setForm((f) => ({ ...f, harga: e.target.value.replace(/\D/g, '') }))}
        />
        <div className="sm:col-span-3">
          <Button type="submit" disabled={!siap} loading={sibuk}>
            Tambah barang
          </Button>
        </div>
      </form>

      {items === null && <Skeleton label="Memuat master barang" />}
      {items && items.length > 0 && (
        <ul className="m-0 grid list-none rounded-dd-lg border border-dd-line bg-white p-0">
          {items.map((b) =>
            edit?.id === b.id ? (
              <li key={b.id} className="grid gap-3 border-b border-dd-line px-4 py-3 last:border-b-0 sm:grid-cols-3">
                <TextInput label="Nama barang" value={edit.nama} maxLength={80} onChange={(e) => setEdit({ ...edit, nama: e.target.value })} />
                <TextInput label="Satuan" value={edit.satuan} maxLength={20} onChange={(e) => setEdit({ ...edit, satuan: e.target.value })} />
                <TextInput
                  label="Harga jual (Rp)"
                  inputMode="numeric"
                  value={edit.harga}
                  onChange={(e) => setEdit({ ...edit, harga: e.target.value.replace(/\D/g, '') })}
                />
                <div className="flex gap-2 sm:col-span-3">
                  <Button
                    loading={sibuk}
                    disabled={edit.nama.trim().length < 2 || !edit.satuan.trim()}
                    onClick={() =>
                      void jalankan(
                        () => client.ubahBarang(b.id, { nama: edit.nama.trim(), satuan: edit.satuan.trim(), hargaJualRp: harga(edit.harga) }),
                        `${edit.nama.trim()} disimpan.`,
                      ).then((ok) => ok && setEdit(null))
                    }
                  >
                    Simpan
                  </Button>
                  <Button variant="secondary" disabled={sibuk} onClick={() => setEdit(null)}>
                    Batal
                  </Button>
                </div>
              </li>
            ) : (
              <li key={b.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-dd-line px-4 py-3 last:border-b-0">
                <div className="grid gap-0.5">
                  <span className="text-[15px] font-semibold text-dd-ink">{b.nama}</span>
                  <span className="text-sm text-dd-muted">
                    {b.satuan} · {b.hargaJualRp !== null ? `jual ${rupiah(b.hargaJualRp)}` : 'harga jual belum diisi'} ·{' '}
                    {b.aktif ? 'Aktif' : 'Nonaktif'}
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    onClick={() => setEdit({ id: b.id, nama: b.nama, satuan: b.satuan, harga: b.hargaJualRp === null ? '' : String(b.hargaJualRp) })}
                  >
                    Ubah
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={sibuk}
                    onClick={() =>
                      void jalankan(() => client.ubahBarang(b.id, { aktif: !b.aktif }), b.aktif ? `${b.nama} dinonaktifkan.` : `${b.nama} aktif lagi.`)
                    }
                  >
                    {b.aktif ? 'Nonaktifkan' : 'Aktifkan'}
                  </Button>
                </div>
              </li>
            ),
          )}
        </ul>
      )}
    </section>
  );
}
