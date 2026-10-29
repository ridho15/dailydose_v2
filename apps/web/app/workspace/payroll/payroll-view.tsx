'use client';

import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Clock3 } from 'lucide-react';
import {
  browserPayrollClient,
  type BarisPayroll,
  type PayrollClient,
  type PayrollSaya,
} from '@/api-clients/payroll-client';
import { Feedback, Skeleton } from '../../ui';
import { tigaBulan } from '../owner-home';

const rp = (n: number) => `${n < 0 ? '−' : ''}Rp ${Math.abs(n).toLocaleString('id-ID')}`;

function namaBulan(period: string) {
  const [y, m] = period.split('-').map(Number);
  return new Intl.DateTimeFormat('id-ID', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(y!, m! - 1, 1)));
}

function waktuKelas(iso: string) {
  return new Intl.DateTimeFormat('id-ID', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Jakarta',
  }).format(new Date(iso));
}

const jamTeks = (jam: number) => `${jam.toLocaleString('id-ID')} jam`;

function KartuKelas({ baris }: { baris: BarisPayroll }) {
  return (
    <li className="flex items-start justify-between gap-3 rounded-dd-lg border border-dd-line bg-white px-4 py-3">
      <div className="min-w-0">
        <p className="m-0 font-semibold text-dd-ink">{baris.namaKelas}</p>
        <p className="m-0 text-sm text-dd-muted">
          {waktuKelas(baris.mulai)}
          {baris.namaCabang ? ` · ${baris.namaCabang}` : ''} · {jamTeks(baris.jam)}
        </p>
        {baris.terverifikasi ? (
          <p className="m-0 mt-1 flex items-center gap-1 text-[13px] font-semibold text-dd-forest">
            <CheckCircle2 className="size-3.5" aria-hidden="true" />
            Check-in terverifikasi
          </p>
        ) : (
          <p className="m-0 mt-1 flex items-center gap-1 text-[13px] font-semibold text-dd-warning">
            <Clock3 className="size-3.5" aria-hidden="true" />
            Belum ada check-in, minta koreksi ke manager
          </p>
        )}
      </div>
      <p
        className={`m-0 shrink-0 font-semibold tabular-nums ${baris.terverifikasi ? 'text-dd-ink' : 'text-dd-muted line-through'}`}
      >
        {rp(baris.honorRp)}
      </p>
    </li>
  );
}

/**
 * Payroll instruktur: akumulasi honor dari kelas yang check-in instrukturnya terverifikasi, ditambah
 * koreksi jam dari manager. Kelas tanpa check-in tetap ditampilkan agar bisa diminta koreksinya.
 */
export function PayrollView({
  client = browserPayrollClient,
  now = Date.now(),
}: {
  client?: PayrollClient;
  now?: number;
}) {
  const bulan = useMemo(() => tigaBulan(now), [now]);
  const [period, setPeriod] = useState(bulan[0]!);
  const [data, setData] = useState<PayrollSaya | null>(null);
  const [gagal, setGagal] = useState(false);

  useEffect(() => {
    let aktif = true;
    setData(null);
    setGagal(false);
    client.milikSaya(period).then(
      (hasil) => aktif && setData(hasil),
      () => aktif && setGagal(true),
    );
    return () => {
      aktif = false;
    };
  }, [client, period]);

  const belum = data?.kelas.filter((k) => !k.terverifikasi) ?? [];
  const sudah = data?.kelas.filter((k) => k.terverifikasi) ?? [];

  return (
    <section aria-labelledby="payroll-title" className="mx-auto max-w-2xl space-y-5 font-sans">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1
            id="payroll-title"
            className="m-0 text-[26px] font-semibold tracking-[-0.02em] text-dd-ink"
          >
            Payroll
          </h1>
          <p className="m-0 mt-1 text-[15px] text-dd-muted">
            Dihitung dari kelas yang check-in Anda terverifikasi di meja depan.
          </p>
        </div>
        <label className="flex flex-col gap-1 text-sm font-semibold text-dd-ink">
          Bulan
          <select
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
            className="min-h-11 rounded-dd-md border border-dd-border-interactive bg-white px-3 text-[15px]"
          >
            {bulan.map((b) => (
              <option key={b} value={b}>
                {namaBulan(b)}
              </option>
            ))}
          </select>
        </label>
      </header>

      {gagal && (
        <Feedback kind="error">Payroll belum dapat dimuat. Coba muat ulang halaman.</Feedback>
      )}
      {!data && !gagal && <Skeleton label="Memuat payroll" />}

      {data && (
        <>
          <div className="rounded-dd-xl bg-dd-forest p-5 text-white">
            <p className="m-0 text-sm font-semibold opacity-80">Total {namaBulan(data.period)}</p>
            <p className="m-0 mt-1 text-[32px] font-semibold tabular-nums">{rp(data.totalRp)}</p>
            <dl className="m-0 mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
              <div>
                <dt className="opacity-80">Kelas terverifikasi</dt>
                <dd className="m-0 font-semibold">
                  {data.kelasTerverifikasi} kelas · {jamTeks(data.jamTerverifikasi)}
                </dd>
              </div>
              <div>
                <dt className="opacity-80">Honor kelas</dt>
                <dd className="m-0 font-semibold tabular-nums">{rp(data.terverifikasiRp)}</dd>
              </div>
              <div>
                <dt className="opacity-80">Koreksi jam</dt>
                <dd className="m-0 font-semibold tabular-nums">{rp(data.koreksiRp)}</dd>
              </div>
            </dl>
          </div>

          {belum.length > 0 && (
            <Feedback kind="warning">
              {belum.length} kelas selesai belum ada check-in Anda ({rp(data.belumTerverifikasiRp)}
              ), belum masuk total. Minta manager mencatat koreksi jam dengan bukti.
            </Feedback>
          )}

          <section aria-labelledby="riwayat-title" className="space-y-2">
            <h2 id="riwayat-title" className="m-0 text-lg font-semibold text-dd-ink">
              Riwayat kelas
            </h2>
            {data.kelas.length === 0 ? (
              <p className="m-0 text-[15px] text-dd-muted">
                Belum ada kelas selesai di {namaBulan(data.period)}.
              </p>
            ) : (
              <ul className="m-0 list-none space-y-2 p-0">
                {[...belum, ...sudah]
                  .sort((a, b) => b.mulai.localeCompare(a.mulai))
                  .map((k) => (
                    <KartuKelas key={k.classSlotId} baris={k} />
                  ))}
              </ul>
            )}
          </section>

          {data.koreksi.length > 0 && (
            <section aria-labelledby="koreksi-title" className="space-y-2">
              <h2 id="koreksi-title" className="m-0 text-lg font-semibold text-dd-ink">
                Koreksi jam
              </h2>
              <ul className="m-0 list-none space-y-2 p-0">
                {data.koreksi.map((k) => (
                  <li
                    key={k.id}
                    className="flex items-start justify-between gap-3 rounded-dd-lg border border-dd-line bg-white px-4 py-3"
                  >
                    <div className="min-w-0">
                      <p className="m-0 font-semibold text-dd-ink">
                        {k.kelasMulai ? `Kelas ${waktuKelas(k.kelasMulai)}` : 'Koreksi jam'} ·{' '}
                        {k.jam > 0 ? '+' : ''}
                        {jamTeks(k.jam)}
                      </p>
                      {k.alasan && <p className="m-0 text-sm text-dd-muted">{k.alasan}</p>}
                    </div>
                    <p className="m-0 shrink-0 font-semibold tabular-nums text-dd-ink">
                      {k.nilaiRp > 0 ? '+' : ''}
                      {rp(k.nilaiRp)}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </section>
  );
}
