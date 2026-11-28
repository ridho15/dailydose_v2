'use client';

import { useCallback, useEffect, useState } from 'react';
import { Check, MessageCircle } from 'lucide-react';
import {
  browserPembelianBaruClient,
  type PembelianBaru,
  type PembelianBaruClient,
} from '../api-clients/pembelian-baru-client';
import { ringkasanPembelian } from '../lib/syarat-ketentuan';
import { Feedback } from '../ui';
import { nomorWhatsApp } from './renewal/renewal-view';

export const TAUTAN_SYARAT = 'https://dailydosepilates.com/terms';
const TAMPIL_AWAL = 5;

/** Pesan terima kasih + persetujuan Syarat & Ketentuan untuk member yang baru membeli paket. */
export function pesanSyarat(p: Pick<PembelianBaru, 'namaMember' | 'namaPaket' | 'masaBerlakuHari' | 'perpanjangan'>) {
  const poin = ringkasanPembelian({
    masaBerlakuHari: p.masaBerlakuHari,
    perpanjangan: p.perpanjangan,
    hariPerpanjangan: p.perpanjangan ? p.masaBerlakuHari : null,
  });
  return [
    `Halo ${p.namaMember}, terima kasih telah membeli paket ${p.namaPaket} di Daily Dose Pilates.`,
    '',
    'Dengan membeli dan memakai paket ini, Anda telah menyetujui Syarat & Ketentuan Daily Dose Pilates, antara lain:',
    ...poin.map((t) => `- ${t}`),
    '',
    `Syarat & Ketentuan lengkap: ${TAUTAN_SYARAT}`,
    '',
    'Sampai jumpa di studio.',
  ].join('\n');
}

function waktuBayar(iso: string, now: number) {
  const hari = Math.floor((now - new Date(iso).getTime()) / 86_400_000);
  if (hari <= 0) return 'hari ini';
  if (hari === 1) return 'kemarin';
  return `${hari} hari lalu`;
}

/**
 * Pembelian baru di halaman Hari ini: tampil 7 hari sejak lunas, dan tetap tampil selama pesan
 * Syarat & Ketentuan belum dikirim lewat WhatsApp. Klik tombol WhatsApp membuka chat member dengan
 * pesan siap kirim dan mencatat bahwa pesannya sudah dikirim.
 */
export function PembelianBaruCard({
  branchId,
  now,
  client = browserPembelianBaruClient,
}: {
  branchId: string;
  now: number;
  client?: PembelianBaruClient;
}) {
  const [items, setItems] = useState<PembelianBaru[] | null>(null);
  const [siap, setSiap] = useState(true);
  const [galat, setGalat] = useState('');
  const [semua, setSemua] = useState(false);

  const muat = useCallback(async () => {
    try {
      const hasil = await client.daftar(branchId);
      setItems(hasil.items);
      setSiap(hasil.siap);
      setGalat('');
    } catch {
      setItems([]);
      setGalat('Daftar pembelian baru gagal dimuat. Muat ulang halaman; bila masih gagal, hubungi pengembang.');
    }
  }, [branchId, client]);

  useEffect(() => {
    void muat();
  }, [muat]);

  const tandai = async (p: PembelianBaru) => {
    if (!siap) return;
    try {
      const { terkirimPada } = await client.tandaiTerkirim(p.id);
      setItems((lama) => lama?.map((i) => (i.id === p.id ? { ...i, terkirimPada } : i)) ?? lama);
    } catch {
      setGalat(`Chat WhatsApp untuk ${p.namaMember} terbuka, tetapi tanda "terkirim" gagal disimpan. Klik tombolnya lagi setelah mengirim.`);
    }
  };

  if (items === null || (items.length === 0 && !galat)) return null;
  const belum = items.filter((i) => !i.terkirimPada).length;
  const tampil = semua ? items : items.slice(0, TAMPIL_AWAL);

  return (
    <section aria-labelledby="pembelian-baru-title" className="space-y-3 rounded-dd-lg border border-dd-line bg-white p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="pembelian-baru-title" className="m-0 text-xl font-semibold text-dd-ink">
          Pembelian baru
        </h2>
        <p className="m-0 text-sm text-dd-muted">
          {belum > 0 ? `${belum} belum dikirimi Syarat & Ketentuan` : 'Semua sudah dikirimi Syarat & Ketentuan'}
        </p>
      </div>
      {galat && (
        <Feedback kind="error" onDismiss={() => setGalat('')}>
          {galat}
        </Feedback>
      )}
      {!siap && (
        <p className="m-0 text-sm text-dd-muted">
          Tanda &quot;sudah dikirim&quot; belum aktif di server (tabel syarat_terkirim_wa belum dibuat), jadi daftar ini belum berkurang.
        </p>
      )}
      <ul className="m-0 list-none divide-y divide-dd-line/70 p-0">
        {tampil.map((p) => {
          const wa = nomorWhatsApp(p.telepon);
          return (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="m-0 font-semibold text-dd-ink">{p.namaMember}</p>
                <p className="m-0 text-sm text-dd-muted">
                  {p.namaPaket} · dibayar {waktuBayar(p.dibayarPada, now)}
                </p>
              </div>
              <div className="flex items-center gap-3">
                {p.terkirimPada && (
                  <span className="inline-flex items-center gap-1 text-sm font-semibold text-dd-forest">
                    <Check className="size-4" aria-hidden="true" />
                    Terkirim
                  </span>
                )}
                {wa ? (
                  <a
                    href={`https://wa.me/${wa}?text=${encodeURIComponent(pesanSyarat(p))}`}
                    target="_blank"
                    rel="noreferrer"
                    onClick={() => void tandai(p)}
                    className={`inline-flex min-h-11 items-center gap-2 rounded-dd-sm px-4 text-[15px] font-bold no-underline ${
                      p.terkirimPada
                        ? 'border border-dd-border-interactive bg-white text-dd-forest hover:border-dd-forest'
                        : 'bg-dd-forest text-white hover:bg-dd-forest-dark'
                    }`}
                  >
                    <MessageCircle className="size-4" aria-hidden="true" />
                    {p.terkirimPada ? 'Kirim ulang' : 'Kirim S&K lewat WhatsApp'}
                  </a>
                ) : (
                  <span className="text-sm text-dd-muted">Nomor WhatsApp belum ada</span>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {items.length > TAMPIL_AWAL && (
        <button
          type="button"
          onClick={() => setSemua((s) => !s)}
          className="min-h-11 text-[15px] font-semibold text-dd-forest underline-offset-4 hover:underline"
        >
          {semua ? 'Tampilkan lebih sedikit' : `Tampilkan semua (${items.length})`}
        </button>
      )}
    </section>
  );
}
