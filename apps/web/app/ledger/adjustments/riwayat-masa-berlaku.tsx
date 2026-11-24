'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../../lib/api-client';
import { Button } from '../../components/actions';
import { SearchInput } from '../../components/forms';
import { Feedback, Skeleton } from '../../ui';

export type JenisMasaBerlaku = 'PERPANJANG' | 'FREEZE' | 'UNFREEZE' | 'PERPANJANGAN_BERBAYAR';

export interface BarisMasaBerlaku {
  id: string;
  jenis: JenisMasaBerlaku;
  catatan: string;
  waktu: string;
  oleh: string | null;
  customerPackageId: string;
  customer: { id: string; displayName: string };
  packageName: string;
  berlakuSampai: string;
}

type Halaman = { items: BarisMasaBerlaku[]; page: { hasMore: boolean; nextCursor: string | null } };

export type MuatRiwayat = (input: { q?: string; cursor?: string }) => Promise<Halaman>;

const muatBawaan: MuatRiwayat = ({ q, cursor }) => {
  const qs = new URLSearchParams({ ...(q ? { q } : {}), ...(cursor ? { cursor } : {}) });
  return apiFetch<Halaman>(`/package-validity-changes${qs.size ? `?${qs}` : ''}`, {
    label: 'Memuat riwayat masa berlaku…',
  });
};

export const LABEL_JENIS: Record<JenisMasaBerlaku, string> = {
  PERPANJANG: 'Perpanjang / ubah tanggal',
  FREEZE: 'Dibekukan',
  UNFREEZE: 'Dibuka kembali',
  PERPANJANGAN_BERBAYAR: 'Perpanjangan berbayar',
};

const waktuWib = (iso: string) =>
  new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Jakarta' }).format(
    new Date(iso),
  );

/**
 * Log terpusat perubahan masa berlaku paket (perpanjang, bekukan, buka kembali, perpanjangan berbayar)
 * untuk audit; sebelumnya hanya ada di riwayat masing-masing paket.
 */
export function RiwayatMasaBerlaku({ muat = muatBawaan }: { muat?: MuatRiwayat }) {
  const [q, setQ] = useState('');
  const [cari, setCari] = useState('');
  const [items, setItems] = useState<BarisMasaBerlaku[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [memuat, setMemuat] = useState(true);
  const [galat, setGalat] = useState('');

  const ambil = useCallback(
    async (lanjut?: string) => {
      setMemuat(true);
      setGalat('');
      try {
        const hasil = await muat({ q: cari || undefined, cursor: lanjut });
        setItems((lama) => (lanjut ? [...lama, ...hasil.items] : hasil.items));
        setCursor(hasil.page.hasMore ? hasil.page.nextCursor : null);
      } catch {
        setGalat('Riwayat masa berlaku belum dapat dimuat. Coba lagi beberapa saat lagi.');
      } finally {
        setMemuat(false);
      }
    },
    [cari, muat],
  );

  useEffect(() => void ambil(), [ambil]);

  return (
    <section aria-labelledby="riwayat-masa-berlaku" className="space-y-3">
      <div>
        <h2 id="riwayat-masa-berlaku" className="m-0 text-xl font-semibold text-dd-ink">
          Riwayat masa berlaku paket
        </h2>
        <p className="m-0 mt-1 text-[15px] text-dd-muted">
          Semua perpanjangan, freeze, dan buka freeze dari semua member, beserta siapa yang mengubah.
        </p>
      </div>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          setCari(q.trim());
        }}
      >
        <SearchInput
          wrapperClassName="min-w-64 flex-1"
          label="Cari member atau paket"
          value={q}
          onChange={(event) => setQ(event.target.value)}
        />
        <Button type="submit" variant="secondary">
          Cari
        </Button>
      </form>
      {galat && <Feedback kind="error">{galat}</Feedback>}
      {memuat && items.length === 0 && <Skeleton label="Memuat riwayat masa berlaku" />}
      {!memuat && !galat && items.length === 0 && (
        <p className="m-0 rounded-dd-lg border border-dd-line bg-white p-4 text-[15px] text-dd-muted">
          Belum ada perubahan masa berlaku{cari ? ` untuk "${cari}"` : ''}.
        </p>
      )}
      {items.length > 0 && (
        <ul className="m-0 grid list-none gap-0 rounded-dd-lg border border-dd-line bg-white p-0">
          {items.map((r) => (
            <li key={r.id} className="grid gap-1 border-b border-dd-line px-4 py-3 last:border-b-0">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <Link
                  href={`/ledger/${r.customerPackageId}`}
                  className="text-[15px] font-semibold text-dd-ink underline-offset-2 hover:underline"
                >
                  {r.customer.displayName} · {r.packageName}
                </Link>
                <time className="text-sm text-dd-muted" dateTime={r.waktu}>
                  {waktuWib(r.waktu)}
                </time>
              </div>
              <p className="m-0 text-[15px] text-dd-ink">
                <span className="font-semibold">{LABEL_JENIS[r.jenis]}</span>: {r.catatan}
              </p>
              <p className="m-0 text-sm text-dd-muted">Oleh {r.oleh ?? 'sistem (pembayaran otomatis)'}</p>
            </li>
          ))}
        </ul>
      )}
      {cursor && (
        <Button variant="ghost" disabled={memuat} onClick={() => void ambil(cursor)}>
          Tampilkan lebih banyak
        </Button>
      )}
    </section>
  );
}
