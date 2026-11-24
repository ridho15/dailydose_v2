'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../../lib/api-client';
import { Button } from '../../components/actions';
import { Feedback, Skeleton } from '../../ui';
import { AssistedSaleDrawer } from '../../purchases/assisted-sale-drawer';
import { useSessionContext } from '../../session-context';

/** Sama dengan JENDELA_PERPANJANGAN_HARI di API: paket perpanjangan baru bisa dibeli 14 hari sebelum berakhir. */
export const JENDELA_HARI = 14;

export interface BarisHampirBerakhir {
  id: string;
  packageName: string;
  branchName: string;
  expiryAt: string;
  ledgerBalance: number;
  customer: { id: string; displayName: string; phoneMasked?: string | null };
}

type Halaman = { items: BarisHampirBerakhir[]; page: { nextCursor?: string | null } };

export type MuatHampirBerakhir = (input: { branchId?: string; cursor?: string }) => Promise<Halaman>;

const muatBawaan: MuatHampirBerakhir = ({ branchId, cursor }) => {
  const qs = new URLSearchParams({
    expiringWithinDays: String(JENDELA_HARI),
    pageSize: '50',
    ...(branchId ? { branchId } : {}),
    ...(cursor ? { cursor } : {}),
  });
  return apiFetch<Halaman>(`/customer-packages?${qs}`, { label: 'Memuat paket yang hampir berakhir…' });
};

const tanggalWib = (iso: string) =>
  new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Jakarta' }).format(
    new Date(iso),
  );

export function sisaHari(iso: string, now = Date.now()) {
  return Math.max(0, Math.ceil((new Date(iso).getTime() - now) / 86_400_000));
}

/**
 * Member yang masih punya sesi tetapi paketnya berakhir dalam 14 hari. Admin bisa langsung menjual
 * paket perpanjangan masa aktif dari sini supaya sesi tersisa tidak hangus.
 */
export function PerpanjanganView({ muat = muatBawaan }: { muat?: MuatHampirBerakhir }) {
  const ctx = useSessionContext();
  const session = ctx?.session;
  const branchId = ctx?.activeBranchId || undefined;
  const saleBranch =
    ctx?.activeBranch ?? (session?.branches?.[0] ? { id: session.branches[0].id, name: session.branches[0].name } : null);
  const saleBranches = (session?.branches ?? []).map((b) => ({ id: b.id, name: b.name }));
  const bisaJual = Boolean(ctx?.hasCapability?.('purchase:record'));

  const [items, setItems] = useState<BarisHampirBerakhir[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [memuat, setMemuat] = useState(true);
  const [galat, setGalat] = useState('');
  const [jualKe, setJualKe] = useState<BarisHampirBerakhir | null>(null);
  const [berhasil, setBerhasil] = useState('');

  const ambil = useCallback(
    async (lanjut?: string) => {
      setMemuat(true);
      setGalat('');
      try {
        const hasil = await muat({ branchId, cursor: lanjut });
        setItems((lama) => (lanjut ? [...lama, ...hasil.items] : hasil.items));
        setCursor(hasil.page?.nextCursor ?? null);
      } catch {
        setGalat('Daftar paket yang hampir berakhir belum dapat dimuat. Periksa koneksi lalu muat ulang halaman.');
      } finally {
        setMemuat(false);
      }
    },
    [branchId, muat],
  );

  useEffect(() => void ambil(), [ambil]);

  return (
    <main className="mx-auto grid max-w-4xl gap-4 p-4">
      <header>
        <h1 className="m-0 text-2xl font-semibold text-dd-ink">Paket hampir berakhir</h1>
        <p className="m-0 mt-1 text-[15px] text-dd-muted">
          Member yang masih punya sesi dan paketnya berakhir dalam {JENDELA_HARI} hari. Tawarkan paket perpanjangan
          masa aktif supaya sesinya tidak hangus.
        </p>
      </header>
      {berhasil && <Feedback kind="status">{berhasil}</Feedback>}
      {galat && <Feedback kind="error">{galat}</Feedback>}
      {memuat && items.length === 0 && <Skeleton label="Memuat paket yang hampir berakhir" />}
      {!memuat && !galat && items.length === 0 && (
        <p className="m-0 rounded-dd-lg border border-dd-line bg-white p-4 text-[15px] text-dd-muted">
          Tidak ada member dengan sisa sesi yang paketnya berakhir dalam {JENDELA_HARI} hari.
        </p>
      )}
      {items.length > 0 && (
        <ul className="m-0 grid list-none gap-0 rounded-dd-lg border border-dd-line bg-white p-0">
          {items.map((r) => {
            const hari = sisaHari(r.expiryAt);
            return (
              <li
                key={r.id}
                className="flex flex-wrap items-center justify-between gap-3 border-b border-dd-line px-4 py-3 last:border-b-0"
              >
                <div className="grid gap-0.5">
                  <Link
                    href={`/ledger/${r.id}`}
                    className="text-[15px] font-semibold text-dd-ink underline-offset-2 hover:underline"
                  >
                    {r.customer.displayName}
                  </Link>
                  <span className="text-sm text-dd-muted">
                    {r.packageName} · sisa {r.ledgerBalance} sesi · berakhir {tanggalWib(r.expiryAt)} (
                    {hari === 0 ? 'hari ini' : `${hari} hari lagi`})
                  </span>
                </div>
                {bisaJual && (
                  <Button variant="secondary" onClick={() => setJualKe(r)}>
                    Jual perpanjangan
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {cursor && (
        <Button variant="ghost" disabled={memuat} onClick={() => void ambil(cursor)}>
          Tampilkan lebih banyak
        </Button>
      )}
      {bisaJual && jualKe && saleBranches.length > 0 && (
        <AssistedSaleDrawer
          open
          branch={saleBranch}
          branches={saleBranches}
          customer={{ id: jualKe.customer.id, name: jualKe.customer.displayName }}
          onClose={() => setJualKe(null)}
          onRecorded={() => {
            setBerhasil(`Penjualan untuk ${jualKe.customer.displayName} tercatat.`);
            setJualKe(null);
            void ambil();
          }}
        />
      )}
    </main>
  );
}
