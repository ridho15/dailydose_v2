'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { verificationClient } from '@/api-clients/identity-verification-client';
import { AmbilSelfie } from '../../components/ambil-selfie';
import { useSessionContext } from '../../session-context';
import { Feedback, Skeleton } from '../../ui';
import {
  clearVerificationContinuation,
  rememberVerificationContinuation,
  storedVerificationContinuation,
} from './verification-continuation';

type Ringkasan = { status: string; rejectionReason?: string | null };

/**
 * Verifikasi member: cukup foto selfie, tanpa KTP. Begitu foto tersimpan, member bisa membeli
 * paket dan booking; staf mengenalinya dari foto ini di meja check-in.
 */
export function VerificationView({
  client = verificationClient,
}: {
  client?: Pick<typeof verificationClient, 'mine' | 'submit'>;
} = {}) {
  const router = useRouter();
  const params = useSearchParams();
  const context = useSessionContext();
  const [ringkasan, setRingkasan] = useState<Ringkasan | null>(null);
  const [gagal, setGagal] = useState(false);
  const [ganti, setGanti] = useState(false);
  const [baruTersimpan, setBaruTersimpan] = useState(false);

  useEffect(() => {
    rememberVerificationContinuation(params?.get('returnTo') ?? null);
  }, [params]);

  const muat = useCallback(async () => {
    try {
      setRingkasan((await client.mine()) as Ringkasan);
      setGagal(false);
    } catch {
      setGagal(true);
    }
  }, [client]);

  useEffect(() => {
    void muat();
  }, [muat]);

  const tersimpan = async () => {
    setBaruTersimpan(true);
    setGanti(false);
    await context?.refresh?.({ quiet: true });
    await muat();
    const lanjut = storedVerificationContinuation();
    if (lanjut) {
      clearVerificationContinuation();
      router.push(lanjut);
    }
  };

  const kirim = (file: File) => client.submit({ selfie: file });
  const sudahAda = ringkasan?.status === 'APPROVED';

  return (
    <section aria-labelledby="verifikasi-title" className="mx-auto max-w-xl space-y-5 font-sans">
      <header>
        <h1
          id="verifikasi-title"
          className="m-0 text-[26px] font-semibold tracking-[-0.02em] text-dd-ink"
        >
          Foto selfie
        </h1>
        <p className="m-0 mt-1 text-[15px] text-dd-muted">
          Satu foto wajah, tanpa KTP. Wajib sebelum membeli paket dan booking kelas.
        </p>
      </header>

      {gagal && (
        <Feedback kind="error">Status foto belum dapat dimuat. Coba muat ulang halaman.</Feedback>
      )}
      {!ringkasan && !gagal && <Skeleton label="Memuat status foto" />}

      {ringkasan && ringkasan.status === 'REJECTED' && (
        <Feedback kind="warning">
          Foto sebelumnya belum bisa dipakai
          {ringkasan.rejectionReason ? ` (${ringkasan.rejectionReason})` : ''}. Ambil foto baru di
          bawah.
        </Feedback>
      )}

      {ringkasan && sudahAda && !ganti && (
        <div className="space-y-3 rounded-dd-xl border border-dd-line bg-white p-5">
          <p className="m-0 flex items-center gap-2 text-lg font-semibold text-dd-forest">
            <CheckCircle2 className="size-5" aria-hidden="true" />
            {baruTersimpan ? 'Foto selfie tersimpan' : 'Foto selfie sudah ada'}
          </p>
          <p className="m-0 text-[15px] text-dd-muted">
            Anda sudah bisa membeli paket dan booking kelas.
          </p>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/classes"
              className="inline-flex min-h-11 items-center rounded-dd-lg bg-dd-forest px-4 text-[15px] font-semibold text-white no-underline"
            >
              Lihat jadwal kelas
            </Link>
            <button
              type="button"
              onClick={() => setGanti(true)}
              className="min-h-11 rounded-dd-lg border border-dd-border-interactive bg-white px-4 text-[15px] font-semibold text-dd-ink"
            >
              Ganti foto
            </button>
          </div>
        </div>
      )}

      {ringkasan && (!sudahAda || ganti) && (
        <div className="rounded-dd-xl border border-dd-line bg-white p-5">
          <AmbilSelfie kirim={kirim} onTersimpan={() => void tersimpan()} />
        </div>
      )}
    </section>
  );
}
