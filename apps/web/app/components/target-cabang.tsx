'use client';

import { useEffect, useState } from 'react';
import { Target } from 'lucide-react';
import { apiFetch } from '../lib/api-client';

export interface PaceCabang {
  branchName: string | null;
  pace: {
    targetRp: number;
    tercapaiRp: number;
    sisaRp: number;
    tercapaiPersen: number;
    hariTersisa: number;
    lajuDibutuhkanRp: number | null;
    status: 'DI_JALUR' | 'PERLU_NAIK' | 'TERCAPAI' | 'PERIODE_HABIS';
  } | null;
  ringkasan: string;
}

export const ambilTargetCabang = (branchId: string) =>
  apiFetch<PaceCabang>(`/targets/pace?${new URLSearchParams({ branchId })}`, {
    label: 'Memuat target cabang…',
  });

const rp = (n: number) => `Rp ${n.toLocaleString('id-ID')}`;

const NADA: Record<string, { label: string; kelas: string }> = {
  DI_JALUR: { label: 'Di jalur', kelas: 'bg-dd-success-soft text-dd-forest' },
  TERCAPAI: { label: 'Tercapai', kelas: 'bg-dd-success-soft text-dd-forest' },
  PERLU_NAIK: { label: 'Perlu dikejar', kelas: 'bg-dd-warning-soft text-dd-warning' },
  PERIODE_HABIS: { label: 'Tidak tercapai', kelas: 'bg-dd-danger-soft text-dd-danger' },
};

/**
 * Target omzet bulan ini yang dipasang pusat untuk cabang aktif, dengan laju harian yang masih
 * dibutuhkan. Disembunyikan bila akun tidak berhak atau target belum bisa dimuat.
 */
export function TargetCabang({
  branchId,
  muat = ambilTargetCabang,
}: {
  branchId: string | null | undefined;
  muat?: (branchId: string) => Promise<PaceCabang>;
}) {
  const [data, setData] = useState<PaceCabang | null>(null);

  useEffect(() => {
    if (!branchId) return;
    let aktif = true;
    muat(branchId).then(
      (hasil) => aktif && setData(hasil),
      () => aktif && setData(null),
    );
    return () => {
      aktif = false;
    };
  }, [branchId, muat]);

  if (!data) return null;
  const pace = data.pace;
  const nada = pace ? NADA[pace.status] : null;

  return (
    <section
      aria-labelledby="target-cabang-title"
      className="rounded-dd-lg border border-dd-line bg-white p-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2
          id="target-cabang-title"
          className="m-0 flex items-center gap-2 text-lg font-semibold text-dd-ink"
        >
          <Target className="size-5 text-dd-forest" aria-hidden="true" />
          Target cabang bulan ini
        </h2>
        {nada && (
          <span className={`rounded-full px-3 py-1 text-sm font-semibold ${nada.kelas}`}>
            {nada.label}
          </span>
        )}
      </div>
      {pace ? (
        <>
          <p className="m-0 mt-3 text-[15px] text-dd-muted">
            <strong className="text-[22px] font-semibold text-dd-ink tabular-nums">
              {rp(pace.tercapaiRp)}
            </strong>{' '}
            dari target {rp(pace.targetRp)}
          </p>
          <div
            className="mt-2 h-2.5 overflow-hidden rounded-full bg-dd-line"
            role="progressbar"
            aria-label="Capaian target"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.min(100, Math.round(pace.tercapaiPersen))}
          >
            <div
              className="h-full rounded-full bg-dd-forest"
              style={{ width: `${Math.min(100, pace.tercapaiPersen)}%` }}
            />
          </div>
          <p className="m-0 mt-2 text-sm text-dd-muted">
            {pace.tercapaiPersen.toLocaleString('id-ID')}% tercapai
            {pace.sisaRp > 0 && pace.lajuDibutuhkanRp !== null
              ? ` · kurang ${rp(pace.sisaRp)}, perlu ${rp(pace.lajuDibutuhkanRp)} per hari selama ${pace.hariTersisa} hari lagi`
              : ''}
          </p>
        </>
      ) : (
        <p className="m-0 mt-2 text-[15px] text-dd-muted">{data.ringkasan}</p>
      )}
    </section>
  );
}
