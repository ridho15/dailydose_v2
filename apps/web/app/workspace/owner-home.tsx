'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import {
  browserKeuanganClient,
  type AngkaCabang,
  type KeuanganClient,
  type RingkasanBulanan,
} from '@/api-clients/keuangan-client';
import { browserWorkQueueClient, type WorkQueueClient } from '@/api-clients/work-queue-client';
import type { OwnerReportClient } from '@/api-clients/owner-report-client';
import type { ClassSlotClient } from '@/api-clients/class-slot-client';
import { EmptyWeeksNotice } from './empty-weeks-notice';
import { labelKategori } from '../lib/kategori-pengeluaran';
import { useSessionContext } from '../session-context';
import { Feedback, Skeleton } from '../ui';
import { ActionInbox } from './action-inbox';
import { AwalBulanCards } from './awal-bulan-cards';
import { OwnerExceptionsPanel } from './owner-exceptions-panel';
import { catatanKasPayroll, KasPayrollSimpananTabel } from './kas-payroll-simpanan';

const rp = (n: number) => `${n < 0 ? '−' : ''}Rp ${Math.abs(n).toLocaleString('id-ID')}`;

/** `YYYY-MM` bulan berjalan dan dua bulan sebelumnya, menurut jam Jakarta. */
export function tigaBulan(now: number): string[] {
  const [y, m] = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
  })
    .format(new Date(now))
    .split('-')
    .map(Number);
  return [0, 1, 2].map((mundur) => {
    const d = new Date(Date.UTC(y!, m! - 1 - mundur, 1));
    return d.toISOString().slice(0, 7);
  });
}

function namaBulan(period: string) {
  const [y, m] = period.split('-').map(Number);
  return new Intl.DateTimeFormat('id-ID', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(y!, m! - 1, 1)));
}

function rentangLabel(from: string, until: string) {
  const f = new Date(`${from}T00:00:00Z`);
  const u = new Date(`${until}T00:00:00Z`);
  const bulan = new Intl.DateTimeFormat('id-ID', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
  return `${f.getUTCDate()} sampai ${u.getUTCDate()} ${bulan.format(u)}`;
}

/** Persentase target; null bila target belum dipasang. */
export function capaianTarget(omsetRp: number, targetRp: number | null): number | null {
  if (!targetRp) return null;
  return Math.round((omsetRp / targetRp) * 100);
}

/**
 * Aturan modal bulan itu: paket terjual mulai November 2026, sesi terpakai sebelumnya. API lama yang
 * belum mengirim `metodeModal` ditentukan dari periodenya.
 */
export function pakaiSesiTerpakai(r: Pick<RingkasanBulanan, 'metodeModal' | 'period'>): boolean {
  return (r.metodeModal ?? (r.period < '2026-11' ? 'PEMAKAIAN' : 'PAKET_TERJUAL')) === 'PEMAKAIAN';
}

export function labelModal(r: Pick<RingkasanBulanan, 'metodeModal' | 'period'>): string {
  return pakaiSesiTerpakai(r) ? 'Modal sesi' : 'Modal paket terjual';
}

export function catatanModal(r: RingkasanBulanan): string {
  const t = r.total;
  if (pakaiSesiTerpakai(r)) return `${t.sesiTerpakai ?? 0} sesi terpakai x modal per sesi`;
  const dasar = `${t.sesiTerjual ?? 0} sesi terjual x modal per sesi`;
  return t.modalBalikRp ? `${dasar} · dikurangi pembatalan/refund ${rp(t.modalBalikRp)}` : dasar;
}

function KartuAngka({ label, nilai, catatan }: { label: string; nilai: number; catatan?: string }) {
  return (
    <div className="rounded-dd-lg border border-dd-line bg-white p-5">
      <p className="m-0 text-sm font-medium text-dd-muted">{label}</p>
      <p className="m-0 mt-1 text-[26px] font-semibold tabular-nums tracking-[-0.01em] text-dd-ink">
        {rp(nilai)}
      </p>
      {catatan && <p className="m-0 mt-1 text-sm text-dd-muted">{catatan}</p>}
    </div>
  );
}

function BarisCabang({ c, tebal = false }: { c: Omit<AngkaCabang, 'branchId'>; tebal?: boolean }) {
  const capaian = capaianTarget(c.omsetRp, c.targetRp);
  return (
    <tr className={tebal ? 'border-t-2 border-dd-line font-semibold' : ''}>
      <th scope="row" className="py-3 pr-4 text-left font-semibold text-dd-ink">
        {c.branchName}
        {capaian !== null && (
          <span className="block text-xs font-medium text-dd-muted">{capaian}% dari target</span>
        )}
      </th>
      <td className="py-3 pr-4 text-right tabular-nums">{rp(c.omsetRp)}</td>
      <td className="py-3 pr-4 text-right tabular-nums">{rp(c.modalSesiRp ?? 0)}</td>
      <td className="py-3 pr-4 text-right tabular-nums">{rp(c.pengeluaranRp)}</td>
      <td
        className={`py-3 text-right font-semibold tabular-nums ${c.profitRp < 0 ? 'text-dd-danger' : 'text-dd-forest'}`}
      >
        {rp(c.profitRp)}
      </td>
    </tr>
  );
}

/**
 * Beranda Owner dan Super Owner: yang perlu diputuskan lebih dulu, lalu angka satu bulan.
 * Laba = omzet − modal paket terjual − pengeluaran, total dan per cabang (bulan sebelum November
 * 2026: modal sesi terpakai). Payroll instruktur dibayar dari kas payroll simpanan dan tidak
 * mengurangi laba.
 */
export function OwnerHome({
  client = browserKeuanganClient,
  queueClient = browserWorkQueueClient,
  ownerReportClient,
  slotClient,
  now = Date.now(),
}: {
  client?: KeuanganClient;
  queueClient?: WorkQueueClient;
  ownerReportClient?: OwnerReportClient;
  slotClient?: ClassSlotClient;
  now?: number;
}) {
  const context = useSessionContext();
  const session = context?.session;
  const bulan = useMemo(() => tigaBulan(now), [now]);
  const [periode, setPeriode] = useState(bulan[0]!);
  const [ringkasan, setRingkasan] = useState<RingkasanBulanan | null>(null);
  const [gagal, setGagal] = useState(false);

  useEffect(() => {
    let batal = false;
    setRingkasan(null);
    setGagal(false);
    client
      .ringkasanBulanan(periode)
      .then((r) => !batal && setRingkasan(r))
      .catch(() => !batal && setGagal(true));
    return () => {
      batal = true;
    };
  }, [client, periode]);


  if (!session) return null;
  const namaDepan = session.displayName.trim().split(/\s+/)[0] ?? session.displayName;
  const tanggal = new Intl.DateTimeFormat('id-ID', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Asia/Jakarta',
  }).format(new Date(now));
  const bisaLaporan = Boolean(context?.hasCapability?.('finance:reconcile'));
  // Tautan langsung ke tab Data Master hanya untuk yang boleh mengubahnya (Rules 2).
  const bisaMaster = Boolean(context?.hasCapability?.('master:manage'));
  const bisaJurnal = Boolean(
    context?.hasCapability?.('finance:read') || context?.hasCapability?.('expense:create'),
  );

  return (
    <div className="space-y-8 font-sans text-dd-ink">
      <header>
        <p className="m-0 text-sm font-semibold text-dd-forest">{tanggal}</p>
        <h1 className="m-0 mt-1 text-[28px] font-semibold tracking-[-0.02em] sm:text-[32px]">
          Halo, {namaDepan}
        </h1>
      </header>

      <ActionInbox
        branchId={context?.activeBranchId || undefined}
        queueClient={queueClient}
        now={now}
        tampilan="ringkas"
        emptyMessage="Tidak ada keputusan yang menunggu."
      />

      <AwalBulanCards client={client} now={now} />

      {/* Minggu tanpa kelas: hanya untuk cabang yang dipilih, supaya tidak berulang lima kali. */}
      {context?.activeBranch && (
        <EmptyWeeksNotice
          branchId={context.activeBranch.id}
          timezone={context.activeBranch.timezone}
          client={slotClient}
          canFill={Boolean(context.hasCapability?.('class-slot:manage'))}
        />
      )}

      <section aria-labelledby="keuangan-title" className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 id="keuangan-title" className="m-0 text-xl font-semibold">
            Keuangan,{' '}
            {ringkasan ? rentangLabel(ringkasan.from, ringkasan.until) : namaBulan(periode)}
          </h2>
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
        </div>

        {gagal && (
          <Feedback kind="error">
            Angka keuangan belum dapat dimuat. Coba muat ulang halaman.
          </Feedback>
        )}
        {!ringkasan && !gagal && <Skeleton label="Memuat angka keuangan" />}

        {ringkasan && (
          <>
            {(ringkasan.total.sesiTanpaModal ?? 0) > 0 && (
              <Feedback kind="warning">
                {ringkasan.total.sesiTanpaModal}{' '}
                {pakaiSesiTerpakai(ringkasan) ? 'sesi terpakai' : 'sesi terjual'} belum punya modal per sesi dan
                dihitung Rp0, jadi laba terlihat lebih besar.{' '}
                {bisaMaster ? (
                  <Link href="/master?tab=modal" className="font-semibold text-dd-ink underline">
                    Atur modal per sesi
                  </Link>
                ) : (
                  'Minta Super Owner mengaturnya di Data Master, tab Modal per Sesi.'
                )}
              </Feedback>
            )}
            {ringkasan.tarifBelumDipasang > 0 && (
              <Feedback kind="warning">
                {ringkasan.tarifBelumDipasang} kelas selesai belum punya tarif honor instruktur dan
                dihitung dengan tarif bawaan.{' '}
                {bisaMaster ? (
                  <Link href="/master?tab=fees" className="font-semibold text-dd-ink underline">
                    Pasang tarif honor
                  </Link>
                ) : (
                  'Minta Super Owner memasangnya di Data Master supaya payroll tepat.'
                )}
              </Feedback>
            )}
            {/* Laba ditulis sebagai rumus supaya asal angkanya terbaca dalam satu baris. */}
            <div
              className={`grid gap-6 rounded-dd-xl p-6 text-white lg:grid-cols-[1fr_1.4fr] lg:items-center ${
                ringkasan.total.profitRp < 0 ? 'bg-dd-danger' : 'bg-dd-forest'
              }`}
            >
              <div>
                <p className="m-0 text-[15px] font-medium text-white/85">Laba sebelum pajak</p>
                <p className="m-0 mt-2 text-[40px] font-semibold leading-none tracking-[-0.02em] tabular-nums sm:text-[48px]">
                  {rp(ringkasan.total.profitRp)}
                </p>
              </div>
              <dl className={`m-0 grid gap-3 ${(ringkasan.total.penjualanMinumanRp ?? 0) > 0 ? 'sm:grid-cols-2' : 'sm:grid-cols-3'}`}>
                {[
                  {
                    tanda: '',
                    label: 'Omzet',
                    nilai: ringkasan.total.omsetRp,
                    catatan: (() => {
                      const capaian = capaianTarget(ringkasan.total.omsetRp, ringkasan.total.targetRp);
                      const transaksi = `${ringkasan.total.transaksi} pembayaran lunas`;
                      return capaian === null ? transaksi : `${transaksi} · ${capaian}% dari target`;
                    })(),
                  },
                  ...((ringkasan.total.penjualanMinumanRp ?? 0) > 0
                    ? [{ tanda: '+', label: 'Penjualan minuman', nilai: ringkasan.total.penjualanMinumanRp ?? 0, catatan: 'Stok minuman yang dijual' }]
                    : []),
                  { tanda: '−', label: labelModal(ringkasan), nilai: ringkasan.total.modalSesiRp ?? 0, catatan: catatanModal(ringkasan) },
                  { tanda: '−', label: 'Pengeluaran', nilai: ringkasan.total.pengeluaranRp, catatan: 'Biaya cabang bulan ini' },
                ].map((b) => (
                  <div key={b.label} className="rounded-dd-lg bg-white/10 p-3">
                    <p className="m-0 text-sm font-medium text-white/85">
                      {b.tanda && <span aria-hidden="true">{b.tanda} </span>}
                      {b.label}
                    </p>
                    <p className="m-0 mt-1 text-[19px] font-semibold tabular-nums">{rp(b.nilai)}</p>
                    <p className="m-0 mt-1 text-[13px] leading-snug text-white/80">{b.catatan}</p>
                  </div>
                ))}
              </dl>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <KartuAngka
                label="Payroll instruktur (dibayar)"
                nilai={ringkasan.total.payrollRp}
                catatan={`${
                  ringkasan.kasPayroll?.berlaku
                    ? 'Dibayar dari kas payroll simpanan · tidak mengurangi laba'
                    : 'Tidak mengurangi laba'
                } · ${ringkasan.total.kelasSelesai} kelas selesai${
                  ringkasan.total.koreksiPayrollRp
                    ? ` · termasuk koreksi jam ${rp(ringkasan.total.koreksiPayrollRp)}`
                    : ''
                }`}
              />
              {ringkasan.kasPayroll?.berlaku && (
                <KartuAngka
                  label="Kas payroll simpanan"
                  nilai={ringkasan.kasPayroll.total.saldoAkhirRp}
                  catatan={catatanKasPayroll(ringkasan.kasPayroll)}
                />
              )}
            </div>

            <section aria-labelledby="per-cabang-title" className="space-y-2">
              <h3 id="per-cabang-title" className="m-0 text-lg font-semibold">
                Per cabang
              </h3>
              <div className="overflow-x-auto rounded-dd-lg border border-dd-line bg-white px-5">
                <table className="w-full min-w-[640px] text-[15px]">
                  <thead className="text-sm text-dd-muted">
                    <tr className="border-b border-dd-line">
                      <th scope="col" className="py-3 pr-4 text-left font-medium">
                        Cabang
                      </th>
                      <th scope="col" className="py-3 pr-4 text-right font-medium">
                        Omzet
                      </th>
                      <th scope="col" className="py-3 pr-4 text-right font-medium">
                        {labelModal(ringkasan)}
                      </th>
                      <th scope="col" className="py-3 pr-4 text-right font-medium">
                        Pengeluaran
                      </th>
                      <th scope="col" className="py-3 text-right font-medium">
                        Laba
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-dd-line/70">
                    {ringkasan.cabang.map((c) => (
                      <BarisCabang key={c.branchId} c={c} />
                    ))}
                    {ringkasan.cabang.length > 1 && (
                      <BarisCabang c={{ ...ringkasan.total, branchName: 'Total' }} tebal />
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            {ringkasan.kasPayroll && <KasPayrollSimpananTabel kas={ringkasan.kasPayroll} />}

            {ringkasan.total.pengeluaranPerKategori.length > 0 && (
              <section aria-labelledby="kategori-title" className="space-y-2">
                <h3 id="kategori-title" className="m-0 text-lg font-semibold">
                  Pengeluaran per kategori
                </h3>
                <ul className="m-0 list-none divide-y divide-dd-line/70 rounded-dd-lg border border-dd-line bg-white px-5 py-1">
                  {ringkasan.total.pengeluaranPerKategori.map((k) => (
                    <li key={k.category} className="flex justify-between gap-4 py-3 text-[15px]">
                      <span>{labelKategori(k.category)}</span>
                      <span className="font-semibold tabular-nums">{rp(k.amountRp)}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <div className="flex flex-wrap gap-x-6 gap-y-2 text-[15px] font-semibold">
              {bisaJurnal && (
                <Link href="/workspace/kas" className="text-dd-forest">
                  Jurnal kas per cabang
                </Link>
              )}
              {bisaLaporan && (
                <Link href="/finance" className="text-dd-forest">
                  Laporan keuangan lengkap
                </Link>
              )}
            </div>
          </>
        )}
      </section>

      {ringkasan && (
        <OwnerExceptionsPanel
          from={ringkasan.from}
          until={ringkasan.until}
          branchId={context?.activeBranchId || undefined}
          client={ownerReportClient}
        />
      )}
    </div>
  );
}
