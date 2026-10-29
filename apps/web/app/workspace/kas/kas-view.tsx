'use client';

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  browserKeuanganClient,
  keuanganFailure,
  type JurnalKas,
  type KeuanganClient,
  type OwnerSingkat,
} from '@/api-clients/keuangan-client';
import { KATEGORI_PENGELUARAN, labelKategori } from '../../lib/kategori-pengeluaran';
import { useSessionContext } from '../../session-context';
import { Feedback, Skeleton } from '../../ui';
import { tigaBulan } from '../owner-home';
import { SettlementOwnerSection } from './settlement-owner';

const rp = (n: number) => `${n < 0 ? '−' : ''}Rp ${Math.abs(n).toLocaleString('id-ID')}`;

function hariIniJakarta(now: number) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date(now));
}

function tanggalPendek(iso: string) {
  return new Intl.DateTimeFormat('id-ID', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(`${iso}T00:00:00Z`));
}

function namaBulan(period: string) {
  const [y, m] = period.split('-').map(Number);
  return new Intl.DateTimeFormat('id-ID', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(y!, m! - 1, 1)));
}

/** Nominal yang diketik staf: "450.000", "Rp 450000", atau "450000" menjadi 450000. */
export function bacaNominal(teks: string): number | null {
  const angka = teks.replace(/[^\d]/g, '');
  if (!angka) return null;
  const nilai = Number(angka);
  return Number.isSafeInteger(nilai) && nilai > 0 ? nilai : null;
}

function FormPengeluaran({
  client,
  branchId,
  branchName,
  now,
  onSaved,
}: {
  client: KeuanganClient;
  branchId: string;
  branchName: string;
  now: number;
  onSaved(): void;
}) {
  const hariIni = hariIniJakarta(now);
  const [tanggal, setTanggal] = useState(hariIni);
  const [kategori, setKategori] = useState<string>(KATEGORI_PENGELUARAN[0].code);
  const [keterangan, setKeterangan] = useState('');
  const [nominal, setNominal] = useState('');
  // Kosong: dibayar dari kas cabang. Berisi id Super Owner: uang pribadinya, diganti saat settlement.
  const [dibayarOleh, setDibayarOleh] = useState('');
  const [owners, setOwners] = useState<OwnerSingkat[]>([]);
  const [sibuk, setSibuk] = useState(false);

  useEffect(() => {
    let batal = false;
    client
      .daftarOwner?.()
      .then((daftar) => !batal && setOwners(daftar))
      .catch(() => !batal && setOwners([]));
    return () => {
      batal = true;
    };
  }, [client]);
  const [pesan, setPesan] = useState<{ kind: 'status' | 'error'; text: string } | null>(null);

  const amountRp = bacaNominal(nominal);
  const siap = Boolean(tanggal && tanggal <= hariIni && keterangan.trim() && amountRp);

  const simpan = async (event: FormEvent) => {
    event.preventDefault();
    if (!siap || !amountRp) return;
    setSibuk(true);
    setPesan(null);
    try {
      await client.catatPengeluaran({
        branchId,
        incurredOn: tanggal,
        categoryCode: kategori,
        description: keterangan.trim(),
        amountRp,
        ...(dibayarOleh ? { dibayarOlehId: dibayarOleh } : {}),
      });
      const pembayar = owners.find((o) => o.id === dibayarOleh)?.nama;
      setPesan({
        kind: 'status',
        text: `${labelKategori(kategori)} ${rp(amountRp)} tercatat untuk ${branchName}${
          pembayar ? `, dibayar ${pembayar} (diganti saat settlement)` : ''
        }.`,
      });
      setKeterangan('');
      setNominal('');
      setDibayarOleh('');
      onSaved();
    } catch (error) {
      setPesan({
        kind: 'error',
        text: keuanganFailure(error, 'Pengeluaran belum tersimpan. Coba lagi.'),
      });
    } finally {
      setSibuk(false);
    }
  };

  const kontrol =
    'mt-1 block min-h-11 w-full rounded-dd-lg border border-dd-border-interactive bg-white px-3 text-[15px] text-dd-ink';

  return (
    <form
      onSubmit={simpan}
      aria-labelledby="form-pengeluaran-title"
      className="space-y-4 rounded-dd-lg border border-dd-line bg-white p-5"
    >
      <div>
        <h2 id="form-pengeluaran-title" className="m-0 text-lg font-semibold">
          Catat pengeluaran
        </h2>
        <p className="m-0 mt-0.5 text-sm text-dd-muted">
          Untuk {branchName}. Salah ketik? Minta Finance atau Owner mengubahnya.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="text-sm font-medium text-dd-ink">
          Tanggal
          <input
            type="date"
            value={tanggal}
            max={hariIni}
            onChange={(e) => setTanggal(e.target.value)}
            className={kontrol}
            required
          />
        </label>
        <label className="text-sm font-medium text-dd-ink">
          Kategori
          <select
            value={kategori}
            onChange={(e) => setKategori(e.target.value)}
            className={kontrol}
          >
            {KATEGORI_PENGELUARAN.map((k) => (
              <option key={k.code} value={k.code}>
                {k.label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm font-medium text-dd-ink sm:col-span-2">
          Keterangan
          <input
            type="text"
            value={keterangan}
            maxLength={500}
            placeholder="Contoh: handuk 10 pcs, toko Sumber Rejeki"
            onChange={(e) => setKeterangan(e.target.value)}
            className={kontrol}
            required
          />
        </label>
        <label className="text-sm font-medium text-dd-ink">
          Nominal (Rp)
          <input
            type="text"
            inputMode="numeric"
            value={nominal}
            placeholder="450.000"
            onChange={(e) => setNominal(e.target.value)}
            className={kontrol}
            required
          />
        </label>
        {owners.length > 0 && (
          <label className="text-sm font-medium text-dd-ink">
            Dibayar oleh
            <select
              value={dibayarOleh}
              onChange={(e) => setDibayarOleh(e.target.value)}
              className={kontrol}
            >
              <option value="">Kas cabang</option>
              {owners.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.nama} (uang pribadi, diganti)
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="flex items-end">
          <button
            type="submit"
            disabled={!siap || sibuk}
            className="min-h-11 w-full rounded-dd-lg bg-dd-forest px-5 text-[15px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {sibuk ? 'Menyimpan…' : 'Simpan pengeluaran'}
          </button>
        </div>
      </div>
      {pesan && <Feedback kind={pesan.kind}>{pesan.text}</Feedback>}
    </form>
  );
}

/**
 * Jurnal kas cabang: uang masuk dari paket yang lunas, uang keluar dari pengeluaran yang dicatat
 * staf. Admin mencatat pembelian barang di sini; Owner membaca jurnal tiap cabang.
 */
export function KasView({
  client = browserKeuanganClient,
  now = Date.now(),
}: {
  client?: KeuanganClient;
  now?: number;
}) {
  const context = useSessionContext();
  const branch = context?.activeBranch;
  const branchId = context?.activeBranchId || undefined;
  const bisaCatat = Boolean(
    context?.hasCapability?.('expense:create') || context?.hasCapability?.('finance:manage'),
  );
  const bulan = useMemo(() => tigaBulan(now), [now]);
  const [periode, setPeriode] = useState(bulan[0]!);
  const [jurnal, setJurnal] = useState<JurnalKas | null>(null);
  const [gagal, setGagal] = useState('');

  const muat = useCallback(() => {
    let batal = false;
    setGagal('');
    client
      .jurnalKas({ branchId, period: periode })
      .then((j) => !batal && setJurnal(j))
      .catch((error) => {
        if (batal) return;
        setJurnal(null);
        setGagal(keuanganFailure(error, 'Jurnal kas belum dapat dimuat. Coba muat ulang halaman.'));
      });
    return () => {
      batal = true;
    };
  }, [branchId, client, periode]);

  useEffect(() => {
    setJurnal(null);
    return muat();
  }, [muat]);

  const lintasCabang = !branchId;
  const bisaSettlement = Boolean(
    context?.hasCapability?.('owner-settlement:manage') &&
    client.settlementOwner &&
    client.porsiOwner &&
    client.simpanPorsi,
  );
  const namaCabang = (id: string) =>
    context?.session?.branches?.find((b) => b.id === id)?.name ?? '';

  return (
    <section aria-labelledby="kas-title" className="space-y-6 font-sans text-dd-ink">
      <header>
        <h1
          id="kas-title"
          className="m-0 text-[28px] font-semibold tracking-[-0.02em] sm:text-[32px]"
        >
          Jurnal kas
        </h1>
        <p className="m-0 mt-1 text-[17px] text-dd-muted">
          Uang masuk dari paket yang lunas dan uang keluar yang dicatat staf
          {branch ? ` di ${branch.name}` : ' di semua cabang'}.
        </p>
      </header>

      {bisaCatat && branchId && branch && (
        <FormPengeluaran
          client={client}
          branchId={branchId}
          branchName={branch.name}
          now={now}
          onSaved={() => void muat()}
        />
      )}
      {bisaCatat && !branchId && (
        <Feedback kind="info">Pilih cabang di bagian atas untuk mencatat pengeluaran.</Feedback>
      )}

      <div role="group" aria-label="Pilih bulan" className="flex flex-wrap gap-2">
        {bulan.map((p) => (
          <button
            key={p}
            type="button"
            aria-pressed={periode === p}
            onClick={() => setPeriode(p)}
            className={`min-h-11 rounded-dd-lg px-4 text-[15px] transition ${
              periode === p
                ? 'bg-dd-forest font-semibold text-white'
                : 'border border-dd-border-interactive bg-white text-dd-ink hover:border-dd-forest'
            }`}
          >
            {namaBulan(p)}
          </button>
        ))}
      </div>

      {gagal && <Feedback kind="error">{gagal}</Feedback>}
      {!jurnal && !gagal && <Skeleton label="Memuat jurnal kas" />}

      {jurnal && (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-dd-lg border border-dd-line bg-white p-5">
              <p className="m-0 text-sm font-medium text-dd-muted">Uang masuk</p>
              <p className="m-0 mt-1 text-[26px] font-semibold tabular-nums text-dd-forest">
                {rp(jurnal.masukRp)}
              </p>
            </div>
            <div className="rounded-dd-lg border border-dd-line bg-white p-5">
              <p className="m-0 text-sm font-medium text-dd-muted">Uang keluar</p>
              <p className="m-0 mt-1 text-[26px] font-semibold tabular-nums text-dd-ink">
                {rp(jurnal.keluarRp)}
              </p>
            </div>
            <div className="rounded-dd-lg border border-dd-line bg-white p-5">
              <p className="m-0 text-sm font-medium text-dd-muted">Selisih</p>
              <p
                className={`m-0 mt-1 text-[26px] font-semibold tabular-nums ${jurnal.selisihRp < 0 ? 'text-dd-danger' : 'text-dd-ink'}`}
              >
                {rp(jurnal.selisihRp)}
              </p>
            </div>
          </div>
          <p className="m-0 text-sm text-dd-muted">
            Honor instruktur tidak masuk jurnal ini; payroll tampil di beranda Owner.
          </p>

          {jurnal.rows.length === 0 ? (
            <p className="m-0 rounded-dd-lg border border-dd-line bg-white p-5 text-[15px] text-dd-muted">
              Belum ada uang masuk atau keluar pada {namaBulan(periode)}.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-dd-lg border border-dd-line bg-white px-5">
              <table className="w-full min-w-[640px] text-[15px]">
                <caption className="sr-only">Jurnal kas {namaBulan(periode)}</caption>
                <thead className="text-sm text-dd-muted">
                  <tr className="border-b border-dd-line">
                    <th scope="col" className="py-3 pr-4 text-left font-medium">
                      Tanggal
                    </th>
                    <th scope="col" className="py-3 pr-4 text-left font-medium">
                      Keterangan
                    </th>
                    <th scope="col" className="py-3 pr-4 text-right font-medium">
                      Masuk
                    </th>
                    <th scope="col" className="py-3 text-right font-medium">
                      Keluar
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-dd-line/70">
                  {jurnal.rows.map((r) => (
                    <tr key={r.id} className="align-top">
                      <td className="whitespace-nowrap py-3 pr-4 text-dd-muted">
                        {tanggalPendek(r.tanggal)}
                      </td>
                      <td className="py-3 pr-4">
                        <span className="block text-dd-ink">{r.keterangan}</span>
                        <span className="block text-sm text-dd-muted">
                          {labelKategori(r.kategori)}
                          {lintasCabang && namaCabang(r.branchId)
                            ? ` · ${namaCabang(r.branchId)}`
                            : ''}
                          {r.dicatatOleh ? ` · ${r.dicatatOleh}` : ''}
                        </span>
                        {r.dibayarOleh && (
                          <span className="block text-sm font-medium text-dd-warning">
                            Dibayar {r.dibayarOleh}, diganti saat settlement
                          </span>
                        )}
                      </td>
                      <td className="whitespace-nowrap py-3 pr-4 text-right tabular-nums text-dd-forest">
                        {r.arah === 'MASUK' ? rp(r.amountRp) : ''}
                      </td>
                      <td className="whitespace-nowrap py-3 text-right tabular-nums">
                        {r.arah === 'KELUAR' ? rp(r.amountRp) : ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {bisaSettlement && (
        <SettlementOwnerSection
          client={
            client as Required<
              Pick<KeuanganClient, 'settlementOwner' | 'porsiOwner' | 'simpanPorsi'>
            >
          }
          periode={periode}
          namaBulan={namaBulan(periode)}
        />
      )}
    </section>
  );
}
