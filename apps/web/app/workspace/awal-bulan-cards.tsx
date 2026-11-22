'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import {
  browserKeuanganClient,
  keuanganFailure,
  type KeuanganClient,
  type RingkasanTransfer,
  type SettlementOwner,
} from '@/api-clients/keuangan-client';
import { Button } from '../components/actions';
import { useSessionContext } from '../session-context';
import { Feedback } from '../ui';
import { simpanBerkas } from './kas/transfer-honor';

const rp = (n: number) => `${n < 0 ? '−' : ''}Rp ${Math.abs(n).toLocaleString('id-ID')}`;

/** Tanggal (1-31) dan periode bulan lalu (`YYYY-MM`) menurut jam Jakarta. */
export function awalBulan(now: number): { tanggal: number; bulanLalu: string } {
  const [y, m, d] = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
    .format(new Date(now))
    .split('-')
    .map(Number);
  const lalu = new Date(Date.UTC(y!, m! - 2, 1));
  return { tanggal: d!, bulanLalu: lalu.toISOString().slice(0, 7) };
}

/** Kartu awal bulan tampil tanggal 1 sampai 5: masa transfer honor dan settlement. */
export const HARI_AWAL_BULAN = 5;

/**
 * Pekerjaan rutin awal bulan di Beranda Owner, supaya tidak perlu mencari menunya: unduh berkas
 * transfer honor KlikBCA (pada tanggal 1 berisi honor bulan lalu penuh) dan ringkasan settlement
 * bulan lalu. Masing-masing hanya untuk pemegang izinnya.
 */
export function AwalBulanCards({
  client = browserKeuanganClient,
  now = Date.now(),
}: {
  client?: KeuanganClient;
  now?: number;
}) {
  const context = useSessionContext();
  const { tanggal, bulanLalu } = awalBulan(now);
  const aktif = tanggal <= HARI_AWAL_BULAN;
  const bisaTransfer = Boolean(
    context?.hasCapability?.('finance:export') && client.transferHonor && client.unduhTransferHonor,
  );
  const bisaSettlement = Boolean(
    context?.hasCapability?.('owner-settlement:manage') && client.settlementOwner,
  );
  const [transfer, setTransfer] = useState<RingkasanTransfer | null>(null);
  const [settlement, setSettlement] = useState<SettlementOwner | null>(null);
  const [galat, setGalat] = useState('');
  const [pesan, setPesan] = useState('');
  const [sibuk, setSibuk] = useState(false);

  useEffect(() => {
    if (!aktif || !bisaTransfer) return;
    let batal = false;
    client.transferHonor!()
      .then((r) => !batal && setTransfer(r))
      .catch((e) => !batal && setGalat(keuanganFailure(e, 'Ringkasan honor belum dapat dimuat.')));
    return () => {
      batal = true;
    };
  }, [aktif, bisaTransfer, client]);

  useEffect(() => {
    if (!aktif || !bisaSettlement) return;
    let batal = false;
    client.settlementOwner!(bulanLalu)
      .then((r) => !batal && setSettlement(r))
      .catch((e) => !batal && setGalat(keuanganFailure(e, 'Settlement belum dapat dimuat.')));
    return () => {
      batal = true;
    };
  }, [aktif, bisaSettlement, bulanLalu, client]);

  if (!aktif || (!bisaTransfer && !bisaSettlement)) return null;

  const unduh = async () => {
    setSibuk(true);
    setGalat('');
    setPesan('');
    try {
      const berkas = await client.unduhTransferHonor!();
      simpanBerkas(berkas.fileName, berkas.base64);
      setPesan(`${berkas.fileName} terunduh: ${berkas.jumlahBaris} instruktur, ${rp(berkas.totalRp)}.`);
    } catch (e) {
      setGalat(keuanganFailure(e, 'Berkas belum dapat dibuat.'));
    } finally {
      setSibuk(false);
    }
  };

  return (
    <section aria-labelledby="awal-bulan-title" className="space-y-3">
      <h2 id="awal-bulan-title" className="m-0 text-xl font-semibold">
        Awal bulan
      </h2>
      {galat && (
        <Feedback kind="error" onDismiss={() => setGalat('')}>
          {galat}
        </Feedback>
      )}
      <div className="grid gap-3 md:grid-cols-2">
        {bisaTransfer && (
          <article className="rounded-dd-lg border border-dd-line bg-white p-5">
            <h3 className="m-0 text-[17px] font-semibold text-dd-ink">Transfer honor instruktur</h3>
            {transfer ? (
              <>
                <p className="m-0 mt-1 text-[26px] font-semibold tabular-nums text-dd-ink">
                  {rp(transfer.siapRp)}
                </p>
                <p className="m-0 mt-1 text-[15px] text-dd-muted">
                  {transfer.jumlahSiap} instruktur siap ditransfer
                  {transfer.tanpaRekening > 0
                    ? ` · ${transfer.tanpaRekening} belum punya rekening`
                    : ''}
                </p>
              </>
            ) : (
              <p className="m-0 mt-1 text-[15px] text-dd-muted">Menghitung honor…</p>
            )}
            <div className="mt-4 flex flex-wrap gap-2">
              <Button
                loading={sibuk}
                disabled={!transfer || transfer.jumlahSiap === 0}
                leadingIcon={<Download className="size-4" aria-hidden="true" />}
                onClick={() => void unduh()}
              >
                Unduh Excel KlikBCA
              </Button>
              {transfer && transfer.tanpaRekening > 0 && (
                <Link
                  href="/workspace/kas#transfer-title"
                  className="inline-flex min-h-11 items-center rounded-dd-md border border-dd-border-interactive bg-white px-4 text-[15px] font-semibold text-dd-ink no-underline hover:border-dd-forest"
                >
                  Lengkapi rekening
                </Link>
              )}
            </div>
            {pesan && <p className="m-0 mt-3 text-[15px] text-dd-forest">{pesan}</p>}
          </article>
        )}
        {bisaSettlement && (
          <article className="rounded-dd-lg border border-dd-line bg-white p-5">
            <h3 className="m-0 text-[17px] font-semibold text-dd-ink">Settlement bulan lalu</h3>
            {settlement ? (
              <ul className="m-0 mt-2 list-none space-y-1 p-0">
                {settlement.owners.map((o) => (
                  <li key={o.id} className="flex justify-between gap-3 text-[15px]">
                    <span className="text-dd-ink">{o.nama}</span>
                    <span className="font-semibold tabular-nums">{rp(o.totalRp)}</span>
                  </li>
                ))}
                {settlement.labaBelumDibagiRp !== 0 && (
                  <li className="text-sm text-dd-warning">
                    {rp(settlement.labaBelumDibagiRp)} laba belum dibagi karena porsi cabang belum
                    lengkap.
                  </li>
                )}
              </ul>
            ) : (
              <p className="m-0 mt-1 text-[15px] text-dd-muted">Menghitung settlement…</p>
            )}
            <Link
              href="/workspace/kas#settlement-title"
              className="mt-4 inline-flex min-h-11 items-center rounded-dd-md border border-dd-border-interactive bg-white px-4 text-[15px] font-semibold text-dd-ink no-underline hover:border-dd-forest"
            >
              Lihat rincian
            </Link>
          </article>
        )}
      </div>
    </section>
  );
}
