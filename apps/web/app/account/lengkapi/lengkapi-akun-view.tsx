'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { verificationClient } from '@/api-clients/identity-verification-client';
import { ApiError, apiFetch } from '../../lib/api-client';
import { AmbilSelfie } from '../../components/ambil-selfie';
import { Button } from '../../components/actions';
import { CheckboxInput, TextInput } from '../../components/forms';
import { PASAL_SYARAT, VERSI_SYARAT } from '../../lib/syarat-ketentuan';
import { useTrackedRouter } from '../../components/app-loading';
import { useSessionContext } from '../../session-context';
import { Skeleton } from '../../ui';

export interface LengkapiAkunClient {
  setujuiSyarat(): Promise<unknown>;
  simpanNomor(phone: string): Promise<unknown>;
  kirimSelfie(file: File): Promise<unknown>;
}

const browserClient: LengkapiAkunClient = {
  setujuiSyarat: () =>
    apiFetch('/me/terms-consent', {
      method: 'POST',
      body: JSON.stringify({ setuju: true }),
      label: 'Menyimpan persetujuan…',
    }),
  simpanNomor: (phone) =>
    apiFetch('/me/phone', {
      method: 'POST',
      body: JSON.stringify({ phone }),
      label: 'Menyimpan nomor WhatsApp…',
    }),
  kirimSelfie: (file) => verificationClient.submit({ selfie: file }),
};

function pesanGalat(error: unknown) {
  const code =
    error instanceof ApiError
      ? [
          error.code,
          (error.data as { code?: string; error?: { code?: string }; title?: string } | null)?.code,
          (error.data as { code?: string; error?: { code?: string }; title?: string } | null)?.error?.code,
          (error.data as { code?: string; title?: string } | null)?.title,
          error.message,
        ]
          .filter(Boolean)
          .join(' ')
      : '';
  if (/PHONE_ALREADY_REGISTERED/.test(code))
    return 'Nomor ini sudah dipakai akun lain. Masuk dengan nomor itu, atau hubungi studio.';
  if (/PHONE_ALREADY_SET/.test(code))
    return 'Nomor WhatsApp sudah tersimpan sebelumnya. Silakan segarkan halaman.';
  if (/VALIDATION/.test(code)) return 'Nomor WhatsApp tidak valid. Contoh: 0812 3456 7890.';
  return 'Nomor belum tersimpan. Coba lagi sebentar.';
}

/**
 * Akun yang mendaftar lewat Google belum punya nomor WhatsApp dan foto selfie. Keduanya diminta di
 * sini, berurutan: nomor dipakai untuk mengirim QR dan pengingat kelas, selfie dicocokkan staf saat
 * check-in. Setelah lengkap, member kembali ke berandanya.
 */
export function LengkapiAkunView({ client = browserClient }: { client?: LengkapiAkunClient }) {
  const context = useSessionContext();
  const router = useTrackedRouter();
  const session = context?.session;
  const [nomor, setNomor] = useState('');
  const [sibuk, setSibuk] = useState(false);
  const [galat, setGalat] = useState('');

  const perluSyarat = Boolean(session?.termsRequired);
  const perluNomor = Boolean(session?.phoneRequired);
  const perluSelfie = session?.identityVerificationStatus !== 'APPROVED';
  const [centang, setCentang] = useState(false);

  useEffect(() => {
    if (session && !perluSyarat && !perluNomor && !perluSelfie) router.replace('/account');
  }, [session, perluSyarat, perluNomor, perluSelfie, router]);

  if (!session) return <Skeleton label="Menyiapkan akun" />;

  const simpanNomor = async (event: FormEvent) => {
    event.preventDefault();
    setSibuk(true);
    setGalat('');
    try {
      await client.simpanNomor(nomor.trim());
      await context?.refresh?.({ quiet: true });
    } catch (error) {
      setGalat(pesanGalat(error));
    } finally {
      setSibuk(false);
    }
  };

  const setujui = async () => {
    if (!centang) return;
    setSibuk(true);
    setGalat('');
    try {
      await client.setujuiSyarat();
      await context?.refresh?.({ quiet: true });
    } catch {
      setGalat('Persetujuan belum tersimpan. Periksa koneksi lalu coba lagi.');
    } finally {
      setSibuk(false);
    }
  };

  // Urutan: syarat, nomor WhatsApp, selfie. Nomor dan selfie selalu dihitung dua langkah (selfie
  // tetap "langkah 2 dari 2" setelah nomor tersimpan); syarat menambah satu langkah di depan.
  const aktif = perluSyarat ? 'syarat' : perluNomor ? 'nomor' : 'selfie';
  const hanyaSyarat = perluSyarat && !perluNomor && !perluSelfie;
  const total = hanyaSyarat ? 1 : perluSyarat ? 3 : 2;
  const langkah = aktif === 'syarat' ? 1 : aktif === 'nomor' ? total - 1 : total;

  return (
    <main
      aria-labelledby="lengkapi-title"
      className="mx-auto max-w-xl space-y-6 font-sans text-dd-ink"
    >
      <header>
        <p className="m-0 text-sm font-semibold text-dd-forest">
          Langkah {langkah} dari {total}
        </p>
        <h1 id="lengkapi-title" className="m-0 mt-1 text-[28px] font-semibold tracking-[-0.02em]">
          Lengkapi akun Anda
        </h1>
        <p className="m-0 mt-2 text-[17px] text-dd-muted">
          {perluSyarat && !perluNomor && !perluSelfie
            ? `Halo ${session.displayName.split(/\s+/)[0]}, Syarat & Ketentuan Daily Dose diperbarui. Setujui dulu untuk melanjutkan membeli paket dan booking kelas.`
            : `Halo ${session.displayName.split(/\s+/)[0]}, sebelum membeli paket dan booking kelas, lengkapi dulu akun Anda.`}
        </p>
      </header>

      {aktif === 'syarat' ? (
        <section aria-labelledby="syarat-title" className="space-y-4 rounded-dd-xl border border-dd-line bg-white p-5">
          <h2 id="syarat-title" className="m-0 text-lg font-semibold">
            Syarat &amp; Ketentuan
          </h2>
          <ul className="m-0 list-disc space-y-1.5 pl-5 text-[15px] text-dd-muted">
            <li>Masa berlaku sesuai paket yang dibeli. Lewat masa berlaku, paket dan sisa sesinya hangus otomatis.</li>
            <li>Perpanjangan berbayar, lamanya sesuai paket perpanjangan yang dibeli, dan maksimal 3 kali per paket.</li>
            <li>Batal, ganti jadwal, atau pindah sesi paling lambat 12 jam sebelum kelas dan tergantung kondisi di lapangan. Lewat dari itu atau tidak hadir, sesi tetap terpotong.</li>
            <li>Pembayaran final dan tidak dapat dikembalikan.</li>
            <li>Studio berhak memotong, membekukan, atau membatalkan paket sesuai Syarat &amp; Ketentuan.</li>
          </ul>
          <details className="rounded-dd-md border border-dd-line">
            <summary className="flex min-h-11 cursor-pointer items-center px-3 text-[15px] font-semibold text-dd-forest">
              Baca selengkapnya ({PASAL_SYARAT.length} pasal)
            </summary>
            <div className="max-h-80 space-y-4 overflow-y-auto border-t border-dd-line p-3 text-sm text-dd-muted">
              {PASAL_SYARAT.map((p) => (
                <section key={p.id}>
                  <h3 className="m-0 text-sm font-semibold text-dd-ink">{p.judul}</h3>
                  <ol className="m-0 mt-1 list-decimal space-y-1 pl-5">
                    {p.butir.map((b) => (
                      <li key={b}>{b}</li>
                    ))}
                  </ol>
                </section>
              ))}
            </div>
          </details>
          <CheckboxInput
            label={
              <>
                Saya telah membaca dan menyetujui{' '}
                <a href="/terms" target="_blank" rel="noreferrer" className="font-semibold text-dd-forest underline">
                  Syarat &amp; Ketentuan
                </a>{' '}
                (versi {VERSI_SYARAT}) dan{' '}
                <a href="/privacy" target="_blank" rel="noreferrer" className="font-semibold text-dd-forest underline">
                  Kebijakan Privasi
                </a>
                .
              </>
            }
            checked={centang}
            disabled={sibuk}
            onChange={(e) => setCentang(e.target.checked)}
          />
          {galat && (
            <p role="alert" className="m-0 text-sm font-medium text-dd-danger">
              {galat}
            </p>
          )}
          <Button disabled={!centang} loading={sibuk} onClick={() => void setujui()} className="w-full sm:w-auto">
            Setuju dan lanjut
          </Button>
        </section>
      ) : perluNomor ? (
        <form
          onSubmit={simpanNomor}
          aria-label="Langkah 1, nomor WhatsApp"
          className="space-y-4 rounded-dd-xl border border-dd-line bg-white p-5"
        >
          <TextInput
            label="Nomor WhatsApp"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="0812 3456 7890"
            required
            value={nomor}
            disabled={sibuk}
            onChange={(e) => setNomor(e.target.value)}
            description="QR kehadiran dan pengingat kelas dikirim ke nomor ini."
            error={galat || undefined}
          />
          {galat && galat.includes("sudah dipakai akun lain") && (
            <div className="rounded-dd-sm border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 space-y-1.5">
              <p className="font-semibold">Akun lama Anda sudah terdaftar dengan nomor ini:</p>
              <p>
                Jika Anda sebelumnya sudah terdaftar (misalnya lewat nomor HP atau email lain), silakan keluar lalu masuk menggunakan nomor tersebut.
              </p>
              <div className="flex flex-wrap items-center gap-2 pt-1 font-semibold text-dd-forest">
                <a href="/sign-in" className="underline hover:text-dd-forest/80">
                  Masuk ke Akun Lama
                </a>
                <span>·</span>
                <a href="/forgot-password" className="underline hover:text-dd-forest/80">
                  Lupa Kata Sandi
                </a>
              </div>
            </div>
          )}
          <Button type="submit" disabled={sibuk || nomor.trim().length < 9}>
            {sibuk ? 'Menyimpan…' : 'Simpan dan lanjut'}
          </Button>
        </form>
      ) : (
        <section
          aria-labelledby="selfie-title"
          className="space-y-3 rounded-dd-xl border border-dd-line bg-white p-5"
        >
          <h2 id="selfie-title" className="m-0 text-lg font-semibold">
            Foto selfie
          </h2>
          <p className="m-0 text-[15px] text-dd-muted">
            Staf mencocokkan wajah Anda dengan foto ini saat check-in, supaya paket tidak dipakai
            orang lain. Pastikan wajah terlihat jelas dan tidak gelap.
          </p>
          <AmbilSelfie
            kirim={client.kirimSelfie}
            onTersimpan={() => {
              void context?.refresh?.({ quiet: true }).then(() => router.replace('/account'));
            }}
          />
        </section>
      )}
    </main>
  );
}
