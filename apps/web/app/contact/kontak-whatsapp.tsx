'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, MessageCircle } from 'lucide-react';
import { useStudioPreference } from '../components/public/public-experience';

const NOMOR_RESMI = process.env.NEXT_PUBLIC_OFFICIAL_WHATSAPP || '62895329736127';
const TAUTAN_RESMI = `https://wa.me/${NOMOR_RESMI}?text=${encodeURIComponent(
  'Halo Daily Dose Pilates, saya ingin bertanya seputar kelas dan paket studio',
)}`;

/**
 * Baris "Bantuan & Kontak": tombol Chat WhatsApp CS membuka pilihan cabang tepat di bawahnya,
 * tanpa pindah halaman. Bila daftar cabang belum tersedia, tombol langsung membuka nomor resmi.
 */
export function KontakWhatsapp() {
  const cabang = useStudioPreference()?.whatsappStudios ?? [];
  const [buka, setBuka] = useState(false);
  const tombolRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!buka) return;
    const tekan = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setBuka(false);
        tombolRef.current?.focus();
      }
    };
    document.addEventListener('keydown', tekan);
    return () => document.removeEventListener('keydown', tekan);
  }, [buka]);

  const tombolIsi = (
    <>
      <MessageCircle aria-hidden="true" className="mr-2 size-4" />
      <span>Chat WhatsApp CS</span>
    </>
  );

  return (
    <li className="grid gap-x-8 gap-y-3 border-b border-ed-line py-8 transition-colors duration-200 hover:bg-ed-tint md:grid-cols-[48px_minmax(0,0.9fr)_minmax(0,1.3fr)_auto] md:items-center">
      <span className="text-xs font-bold text-ed-green">03</span>
      <h3 className="m-0 text-[clamp(24px,2.4vw,34px)] leading-[1.1] font-medium tracking-[-0.05em]">
        Bantuan &amp; Kontak
      </h3>
      <p className="m-0 text-[15px] leading-[1.65] text-ed-muted">
        Hubungi kami langsung melalui WhatsApp studio atau kanal kontak resmi Daily Dose Pilates.
      </p>
      <div className="flex flex-col items-start gap-5 md:items-end">
        {cabang.length > 1 ? (
          <button
            ref={tombolRef}
            type="button"
            className="ed-button"
            aria-expanded={buka}
            aria-controls="kontak-wa-cabang"
            onClick={() => setBuka((b) => !b)}
          >
            {tombolIsi}
          </button>
        ) : (
          <a
            className="ed-button"
            href={cabang[0]?.href ?? TAUTAN_RESMI}
            target="_blank"
            rel="noopener noreferrer"
          >
            {tombolIsi}
          </a>
        )}
        <Link className="ed-link text-ed-green" href="/locations">
          <span>Lihat kontak per studio</span>
          <ArrowRight aria-hidden="true" className="size-4" />
        </Link>
      </div>

      {buka && cabang.length > 1 && (
        <div
          id="kontak-wa-cabang"
          role="region"
          aria-labelledby="kontak-wa-judul"
          className="mt-3 md:col-span-4"
        >
          <p id="kontak-wa-judul" className="m-0 text-[15px] font-semibold text-ed-ink">
            Pilih studio yang ingin dihubungi
          </p>
          <p className="m-0 mt-1 text-sm text-ed-muted">
            WhatsApp terbuka di tab baru dengan pesan yang siap dikirim.
          </p>
          <ul className="m-0 mt-4 grid list-none gap-2 p-0 sm:grid-cols-2 lg:grid-cols-3">
            {cabang.map((studio) => (
              <li key={studio.id}>
                <a
                  href={studio.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex min-h-14 items-center gap-3 rounded-dd-md border border-ed-line bg-white px-4 py-3 no-underline transition-colors hover:border-[#1f8f5f] hover:bg-ed-tint focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ed-forest"
                >
                  <MessageCircle className="size-5 shrink-0 text-[#1f8f5f]" aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold text-ed-ink">{studio.nama}</span>
                    {studio.area && (
                      <span className="block text-sm text-ed-muted">{studio.area}</span>
                    )}
                  </span>
                  {studio.studioSaya && (
                    <span className="shrink-0 text-xs font-semibold text-ed-forest">
                      Studio Anda
                    </span>
                  )}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </li>
  );
}
