'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { verificationClient } from '@/api-clients/identity-verification-client';
import { ApiError, apiFetch } from '../../lib/api-client';
import { AmbilSelfie } from '../../components/ambil-selfie';
import { Button } from '../../components/actions';
import { TextInput } from '../../components/forms';
import { useTrackedRouter } from '../../components/app-loading';
import { useSessionContext } from '../../session-context';
import { Skeleton } from '../../ui';

export interface LengkapiAkunClient {
  simpanNomor(phone: string): Promise<unknown>;
  kirimSelfie(file: File): Promise<unknown>;
}

const browserClient: LengkapiAkunClient = {
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
          (error.data as { code?: string; title?: string } | null)?.code,
          (error.data as { code?: string; title?: string } | null)?.title,
          error.message,
        ].join(' ')
      : '';
  if (/PHONE_ALREADY_REGISTERED/.test(code))
    return 'Nomor ini sudah dipakai akun lain. Masuk dengan nomor itu, atau hubungi studio.';
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

  const perluNomor = Boolean(session?.phoneRequired);
  const perluSelfie = session?.identityVerificationStatus !== 'APPROVED';

  useEffect(() => {
    if (session && !perluNomor && !perluSelfie) router.replace('/account');
  }, [session, perluNomor, perluSelfie, router]);

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

  const langkah = perluNomor ? 1 : 2;

  return (
    <main
      aria-labelledby="lengkapi-title"
      className="mx-auto max-w-xl space-y-6 font-sans text-dd-ink"
    >
      <header>
        <p className="m-0 text-sm font-semibold text-dd-forest">Langkah {langkah} dari 2</p>
        <h1 id="lengkapi-title" className="m-0 mt-1 text-[28px] font-semibold tracking-[-0.02em]">
          Lengkapi akun Anda
        </h1>
        <p className="m-0 mt-2 text-[17px] text-dd-muted">
          Halo {session.displayName.split(/\s+/)[0]}, akun Google Anda sudah tersambung. Sebelum
          membeli paket dan booking kelas, kami perlu nomor WhatsApp dan satu foto selfie.
        </p>
      </header>

      {perluNomor ? (
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
