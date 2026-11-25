import type { Metadata } from 'next';
import Link from 'next/link';
import { PublicFooter } from '../components/public/public-footer';
import { PublicHeader } from '../components/public/public-header';
import { PublicPageHero } from '../components/public/public-page';
import { BERLAKU_SEJAK, PASAL_SYARAT, VERSI_SYARAT } from '../lib/syarat-ketentuan';

export const metadata: Metadata = {
  title: 'Syarat & Ketentuan Layanan',
  description:
    'Syarat dan Ketentuan akun member, pembelian paket, masa berlaku, perpanjangan, pembatalan, dan penggunaan studio Daily Dose Pilates.',
};

/** Pasal yang paling sering ditanyakan; ditebalkan di daftar isi supaya mudah ditemukan. */
const PENTING = new Set(['masa-berlaku', 'perpanjangan', 'hak-studio', 'pembatalan', 'refund']);

export default function TermsPage() {
  return (
    <div className="ed-scope min-w-0 overflow-x-clip bg-ed-cream text-ed-ink">
      <a className="skip-link" href="#terms-main">
        Langsung ke isi syarat &amp; ketentuan
      </a>
      <PublicHeader variant="editorial" />
      <main id="terms-main">
        <PublicPageHero
          eyebrow="Ketentuan Keanggotaan &amp; Layanan"
          title="Syarat &amp; Ketentuan Studio"
          description="Berlaku untuk pendaftaran akun, pembelian paket, perpanjangan, pemesanan kelas, dan penggunaan studio Daily Dose Pilates."
        />

        <section className="py-[clamp(48px,7vw,104px)]">
          <div className="ed-wrap">
            <div className="mx-auto grid max-w-3xl gap-8">
              <p className="m-0 text-sm text-ed-muted">
                Versi {VERSI_SYARAT} · berlaku sejak {BERLAKU_SEJAK}
              </p>

              <div className="border border-ed-line bg-white p-5 text-[15px] leading-[1.7] text-ed-ink">
                <p className="m-0 font-semibold">Yang paling penting:</p>
                <ul className="m-0 mt-2 list-disc space-y-1 pl-5 text-ed-muted">
                  <li>Paket yang lewat masa berlaku hangus otomatis, termasuk sisa sesinya.</li>
                  <li>Perpanjangan masa berlaku berbayar dan maksimal 3 kali per paket.</li>
                  <li>Batal kurang dari 12 jam atau tidak hadir, sesi tetap terpotong.</li>
                  <li>Pembayaran final dan tidak dapat dikembalikan.</li>
                  <li>Studio berhak memotong, membekukan, atau membatalkan paket sesuai Pasal 7.</li>
                </ul>
              </div>

              <nav aria-labelledby="daftar-isi" className="border-t border-ed-line pt-6">
                <h2 id="daftar-isi" className="m-0 text-lg font-medium text-ed-ink">
                  Daftar isi
                </h2>
                <ol className="m-0 mt-3 grid list-none gap-1 p-0 text-[15px] sm:grid-cols-2">
                  {PASAL_SYARAT.map((p) => (
                    <li key={p.id}>
                      <a
                        href={`#${p.id}`}
                        className={`inline-flex min-h-11 items-center text-ed-green underline-offset-4 hover:underline ${PENTING.has(p.id) ? 'font-semibold' : ''}`}
                      >
                        {p.judul}
                      </a>
                    </li>
                  ))}
                </ol>
              </nav>

              {PASAL_SYARAT.map((p) => (
                <article key={p.id} id={p.id} className="scroll-mt-24 space-y-3 border-t border-ed-line pt-6">
                  <h2 className="m-0 text-xl font-medium tracking-[-0.03em] text-ed-ink">{p.judul}</h2>
                  <ol className="m-0 list-decimal space-y-2 pl-5 text-[15px] leading-[1.7] text-ed-muted marker:text-ed-ink">
                    {p.butir.map((b) => (
                      <li key={b}>{b}</li>
                    ))}
                  </ol>
                </article>
              ))}

              <article className="space-y-3 border-t border-ed-line pt-6">
                <h2 className="m-0 text-xl font-medium tracking-[-0.03em] text-ed-ink">Pertanyaan</h2>
                <p className="m-0 text-[15px] leading-[1.7] text-ed-muted">
                  Hubungi WhatsApp studio atau front desk cabang terdekat. Baca juga{' '}
                  <Link href="/privacy" className="text-ed-green underline underline-offset-4">
                    Kebijakan Privasi
                  </Link>
                  .
                </p>
                <div className="flex flex-wrap gap-3 pt-1">
                  <Link
                    href="/contact"
                    className="inline-flex min-h-11 items-center bg-ed-green px-4 text-sm font-semibold text-white no-underline transition hover:bg-ed-forest"
                  >
                    Hubungi Kami
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
