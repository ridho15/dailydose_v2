import type { Metadata } from 'next';
import Link from 'next/link';
import { Eye, FileCheck, Lock, ShieldCheck, UserCheck } from 'lucide-react';
import { PublicFooter } from '../components/public/public-footer';
import { PublicHeader } from '../components/public/public-header';
import { PublicPageHero } from '../components/public/public-page';

export const metadata: Metadata = {
  title: 'Kebijakan Privasi',
  description:
    'Kebijakan privasi perlindungan data pribadi, dokumen identitas, dan transaksi member Daily Dose Pilates.',
};

export default function PrivacyPage() {
  return (
    <div className="ed-scope min-w-0 overflow-x-clip bg-ed-cream text-ed-ink">
      <a className="skip-link" href="#privacy-main">
        Langsung ke isi kebijakan privasi
      </a>
      <PublicHeader variant="editorial" />
      <main id="privacy-main">
        <PublicPageHero
          eyebrow="Perlindungan Data Pribadi"
          title="Kebijakan Privasi"
          description="Komitmen Daily Dose Pilates dalam melindungi data pribadi, privasi akun, dan keamanan dokumen identitas Anda."
        />

        <section className="py-[clamp(64px,8vw,120px)]">
          <div className="ed-wrap">
            <div className="mx-auto max-w-3xl">
              {/* Seksi 1: Data yang Dikumpulkan */}
              <article className="space-y-4 border-t border-ed-line py-8">
                <div className="flex items-center gap-3 text-xl font-medium tracking-[-0.03em] text-ed-ink [&>svg]:size-5 [&>svg]:text-ed-green">
                  <UserCheck className="size-4" />
                  <h2>1. Data Pribadi yang Kami Kumpulkan</h2>
                </div>
                <div className="space-y-3 text-[15px] leading-[1.7] text-ed-muted">
                  <p>
                    Saat Anda mendaftar atau berinteraksi dengan layanan kami, kami mengumpulkan informasi yang Anda berikan secara sukarela, meliputi:
                  </p>
                  <ul className="list-disc list-inside space-y-1.5 pl-2">
                    <li>Nama lengkap dan informasi kontak (nomor WhatsApp dan alamat email).</li>
                    <li>Riwayat transaksi, bukti pembayaran, dan paket sesi yang dibeli.</li>
                    <li>Foto selfie yang Anda unggah semata-mata dipakai staf untuk mengenali Anda saat datang ke studio. Kami tidak meminta KTP.</li>
                    <li>Catatan kehadiran sesi kelas di studio Daily Dose Pilates.</li>
                  </ul>
                </div>
              </article>

              {/* Seksi 2: Penggunaan Data */}
              <article className="space-y-4 border-t border-ed-line py-8">
                <div className="flex items-center gap-3 text-xl font-medium tracking-[-0.03em] text-ed-ink [&>svg]:size-5 [&>svg]:text-ed-green">
                  <Eye className="size-4" />
                  <h2>2. Bagaimana Kami Menggunakan Data Anda</h2>
                </div>
                <div className="space-y-3 text-[15px] leading-[1.7] text-ed-muted">
                  <p>
                    Informasi pribadi Anda digunakan untuk:
                  </p>
                  <ul className="list-disc list-inside space-y-1.5 pl-2">
                    <li>Memverifikasi akun dan memfasilitasi reservasi kelas latihan.</li>
                    <li>Mengirimkan pengingat jadwal kelas dan pembaruan penting via WhatsApp atau email.</li>
                    <li>Memproses konfirmasi pembayaran paket dan mencatat saldo sesi aktif Anda.</li>
                    <li>Memastikan keselamatan latihan dan identifikasi member resmi di studio.</li>
                  </ul>
                </div>
              </article>

              {/* Seksi 3: Keamanan foto selfie */}
              <article className="space-y-4 border-t border-ed-line py-8">
                <div className="flex items-center gap-3 text-xl font-medium tracking-[-0.03em] text-ed-ink [&>svg]:size-5 [&>svg]:text-ed-green">
                  <Lock className="size-4" />
                  <h2>3. Keamanan &amp; Penyimpanan Foto Selfie</h2>
                </div>
                <div className="space-y-3 text-[15px] leading-[1.7] text-ed-muted">
                  <p>
                    Foto selfie disimpan pada media penyimpanan privat yang terenkripsi dan <strong>tidak pernah dipublikasikan atau dibagikan ke pihak ketiga</strong>.
                  </p>
                  <p>
                    Akses ke dokumen identitas dibatasi secara ketat hanya untuk staf kepatuhan dan manajemen resmi yang memiliki wewenang verifikasi keanggotaan.
                  </p>
                </div>
              </article>

              {/* Seksi 4: Hak Anda */}
              <article className="space-y-4 border-t border-ed-line py-8">
                <div className="flex items-center gap-3 text-xl font-medium tracking-[-0.03em] text-ed-ink [&>svg]:size-5 [&>svg]:text-ed-green">
                  <FileCheck className="size-4" />
                  <h2>4. Hak Anda atas Data Pribadi</h2>
                </div>
                <div className="space-y-3 text-[15px] leading-[1.7] text-ed-muted">
                  <p>
                    Anda berhak untuk memperbarui data profil Anda, memeriksa riwayat penggunaan sesi, atau mengajukan permohonan pembaruan informasi dengan menghubungi admin studio.
                  </p>
                  <p>
                    Kami berkomitmen mematuhi standar perlindungan data pribadi yang berlaku di Indonesia.
                  </p>
                </div>
              </article>

              {/* Seksi 5: Hubungi Kami */}
              <article className="space-y-4 border-t border-ed-line py-8">
                <div className="flex items-center gap-3 text-xl font-medium tracking-[-0.03em] text-ed-ink [&>svg]:size-5 [&>svg]:text-ed-green">
                  <ShieldCheck className="size-4" />
                  <h2>5. Kontak Perlindungan Privasi</h2>
                </div>
                <p className="text-sm leading-relaxed text-ed-muted">
                  Jika Anda memiliki pertanyaan seputar privasi data Anda di Daily Dose Pilates, silakan hubungi tim kami melalui WhatsApp atau formulir kontak resmi.
                </p>
                <div className="pt-2">
                  <Link
                    href="/contact"
                    className="inline-flex items-center gap-2 rounded-none bg-ed-green px-4 py-2 text-sm font-semibold text-white no-underline transition hover:bg-ed-forest"
                  >
                    <span>Hubungi Kami</span>
                  </Link>
                </div>
              </article>
            </div>
          </div>
        </section>
      </main>
      <PublicFooter variant="editorial" />
    </div>
  );
}
