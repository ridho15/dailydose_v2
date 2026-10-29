'use client';

import { useEffect, useState } from 'react';
import { Star } from 'lucide-react';
import {
  browserUlasanInstrukturClient,
  type LaporanUlasan,
  type UlasanInstrukturClient,
} from '@/api-clients/ulasan-instruktur-client';
import { useSessionContext } from '../../session-context';
import { Feedback, Skeleton } from '../../ui';

const RENTANG = [
  { hari: 30, label: '30 hari' },
  { hari: 90, label: '90 hari' },
  { hari: 365, label: '12 bulan' },
] as const;

function Bintang({ nilai, ukuran = 'size-4' }: { nilai: number; ukuran?: string }) {
  return (
    <span className="inline-flex items-center gap-0.5" aria-hidden="true">
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          className={`${ukuran} ${n <= Math.round(nilai) ? 'fill-dd-brass text-dd-brass' : 'text-dd-line'}`}
          strokeWidth={1.5}
        />
      ))}
    </span>
  );
}

const tanggal = (iso: string, tz: string) => {
  try {
    return new Intl.DateTimeFormat('id-ID', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
      timeZone: tz,
    }).format(new Date(iso));
  } catch {
    return '';
  }
};

/** Laporan internal: rata-rata bintang per instruktur dan catatan member terbaru. */
export function UlasanView({
  client = browserUlasanInstrukturClient,
  now = Date.now(),
}: {
  client?: Pick<UlasanInstrukturClient, 'laporan'>;
  now?: number;
}) {
  const context = useSessionContext();
  const branch = context?.activeBranch;
  const tz = branch?.timezone ?? 'Asia/Jakarta';
  const [hari, setHari] = useState<number>(90);
  const [data, setData] = useState<LaporanUlasan | null>(null);
  const [galat, setGalat] = useState('');
  const [pilihan, setPilihan] = useState<string | null>(null);

  useEffect(() => {
    let batal = false;
    setData(null);
    setGalat('');
    setPilihan(null);
    Promise.resolve()
      .then(() =>
        client.laporan({
          branchId: branch?.id,
          from: new Date(now - hari * 86_400_000).toISOString(),
          until: new Date(now).toISOString(),
        }),
      )
      .then((hasil) => !batal && setData(hasil))
      .catch(() => !batal && setGalat('Ulasan belum dapat dimuat. Coba muat ulang halaman.'));
    return () => {
      batal = true;
    };
  }, [client, branch?.id, hari, now]);

  const ulasan = data?.ulasan.filter((u) => !pilihan || u.instructorId === pilihan);
  const namaPilihan = data?.instruktur.find((i) => i.instructorId === pilihan)?.namaInstruktur;

  return (
    <section aria-labelledby="ulasan-title" className="space-y-6 font-sans text-dd-ink">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1
            id="ulasan-title"
            className="m-0 text-[28px] font-semibold tracking-[-0.02em] sm:text-[32px]"
          >
            Ulasan instruktur
          </h1>
          <p className="m-0 mt-1 max-w-[62ch] text-[17px] text-dd-muted">
            Member menilai instruktur setelah kelas yang mereka hadiri. Hanya untuk tim studio,
            tidak tampil di situs.
            {branch?.name ? ` Cabang ${branch.name}.` : ''}
          </p>
        </div>
        <div
          role="group"
          aria-label="Rentang waktu"
          className="flex gap-1 rounded-dd-lg border border-dd-line bg-white p-1"
        >
          {RENTANG.map((r) => (
            <button
              key={r.hari}
              type="button"
              aria-pressed={hari === r.hari}
              onClick={() => setHari(r.hari)}
              className={`min-h-9 rounded-dd-md px-3 text-sm font-semibold ${
                hari === r.hari ? 'bg-dd-forest text-white' : 'text-dd-muted hover:text-dd-ink'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </header>

      {galat && <Feedback kind="error">{galat}</Feedback>}
      {!data && !galat && <Skeleton label="Memuat ulasan" />}

      {data && data.instruktur.length === 0 && (
        <p className="m-0 rounded-dd-lg border border-dd-line bg-white p-5 text-dd-muted">
          Belum ada ulasan pada rentang ini. Member diminta menilai instruktur di beranda mereka
          setelah kelas selesai dan sebelum booking kelas berikutnya.
        </p>
      )}

      {data && data.instruktur.length > 0 && (
        <>
          <div className="overflow-x-auto rounded-dd-lg border border-dd-line bg-white">
            <table className="w-full min-w-[560px] border-collapse text-left text-sm">
              <caption className="sr-only">Rata-rata bintang per instruktur</caption>
              <thead className="text-dd-muted">
                <tr className="border-b border-dd-line">
                  <th scope="col" className="px-4 py-3 font-semibold">
                    Instruktur
                  </th>
                  <th scope="col" className="px-4 py-3 font-semibold">
                    Rata-rata
                  </th>
                  <th scope="col" className="px-4 py-3 font-semibold">
                    Ulasan
                  </th>
                  <th scope="col" className="px-4 py-3 font-semibold">
                    Sebaran 1 sampai 5 bintang
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.instruktur.map((i) => {
                  const maks = Math.max(...i.sebaran, 1);
                  const aktif = pilihan === i.instructorId;
                  return (
                    <tr
                      key={i.instructorId}
                      className={`border-b border-dd-line/50 last:border-0 ${aktif ? 'bg-dd-success-soft' : ''}`}
                    >
                      <th scope="row" className="px-4 py-3 font-semibold">
                        <button
                          type="button"
                          aria-pressed={aktif}
                          onClick={() => setPilihan(aktif ? null : i.instructorId)}
                          className="text-left text-dd-forest underline-offset-2 hover:underline"
                        >
                          {i.namaInstruktur}
                        </button>
                      </th>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-2">
                          <Bintang nilai={i.rataRata} />
                          <span className="font-semibold tabular-nums">
                            {i.rataRata.toLocaleString('id-ID', { minimumFractionDigits: 1 })}
                          </span>
                        </span>
                      </td>
                      <td className="px-4 py-3 tabular-nums">{i.jumlahUlasan}</td>
                      <td className="px-4 py-3">
                        <span
                          className="flex h-6 items-end gap-1"
                          role="img"
                          aria-label={i.sebaran.map((n, k) => `${k + 1} bintang: ${n}`).join(', ')}
                        >
                          {i.sebaran.map((n, k) => (
                            <span
                              key={k}
                              className="w-4 rounded-t-sm bg-dd-forest/80"
                              style={{
                                height: `${Math.max(8, (n / maks) * 100)}%`,
                                opacity: n ? 1 : 0.2,
                              }}
                            />
                          ))}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <section aria-labelledby="catatan-title" className="space-y-3">
            <h2 id="catatan-title" className="m-0 text-xl font-semibold">
              {namaPilihan ? `Ulasan untuk ${namaPilihan}` : 'Ulasan terbaru'}
            </h2>
            <ul className="m-0 grid list-none gap-2 p-0">
              {ulasan?.map((u) => (
                <li key={u.id} className="rounded-dd-lg border border-dd-line bg-white p-4">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <Bintang nilai={u.rating} />
                    <span className="sr-only">{u.rating} dari 5 bintang</span>
                    <strong className="text-[15px]">{u.namaInstruktur}</strong>
                    <span className="text-sm text-dd-muted">
                      {u.namaKelas} · {tanggal(u.kelasMulai, tz)}
                      {u.namaCabang ? ` · ${u.namaCabang}` : ''}
                    </span>
                  </div>
                  {u.comment && (
                    <p className="mt-2 mb-0 text-[15px] leading-relaxed">{u.comment}</p>
                  )}
                  <p className="mt-1 mb-0 text-xs text-dd-muted">Dari {u.namaMember}</p>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </section>
  );
}
