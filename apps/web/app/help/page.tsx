import type { Metadata } from 'next';
import { Suspense } from 'react';
import { HelpView } from './help-view';

export const metadata: Metadata = {
  title: 'Pusat Bantuan & Panduan Terpusat',
  description:
    'Panduan resmi penggunaan aplikasi Daily Dose Pilates untuk Pelanggan/Member, Admin Meja Depan, dan Super Owner. Mencakup alur pemesanan, presensi QR, verifikasi pembayaran, angka batas sistem, dan kontak eskalasi cabang.',
};

export default function HelpPage() {
  return (
    <Suspense
      fallback={
        <div className="grid min-h-[60vh] place-items-center bg-[#FBF9F5] p-8 text-center text-sm font-medium text-dd-muted">
          Memuat Pusat Bantuan &amp; Panduan Daily Dose…
        </div>
      }
    >
      <HelpView />
    </Suspense>
  );
}
