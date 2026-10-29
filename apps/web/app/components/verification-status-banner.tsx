'use client';

import { ButtonLink } from './actions';

export interface VerificationStatusBannerProps {
  status?: string | null;
  rejectionReason?: string | null;
  returnTo?: string;
  className?: string;
}

export function VerificationStatusBanner({
  status,
  rejectionReason,
  returnTo,
  className = '',
}: VerificationStatusBannerProps) {
  if (status === 'APPROVED' || status === 'NOT_REQUIRED') {
    return null;
  }

  const returnParam = returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : '';

  if (status === 'PENDING' || status === 'IN_REVIEW') {
    return (
      <aside
        className={`rounded-none border-l-4 border-[#8a5b17] bg-[#fff4da] p-5 text-[#5c3c0a] sm:p-6 ${className}`}
        role="status"
        aria-label="Status verifikasi identitas sedang diperiksa"
      >
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <h2 className="text-lg font-bold text-ed-ink">Data kamu sedang diperiksa</h2>
            <p className="text-base leading-relaxed text-ed-muted">
              Data kamu sedang diperiksa tim studio. Kami kabari lewat WhatsApp kalau sudah selesai.
            </p>
          </div>
          <ButtonLink
            href={`/account/verification${returnParam}`}
            variant="secondary"
            className="w-full sm:w-auto min-h-[44px] shrink-0 border-ui"
          >
            Lihat status verifikasi
          </ButtonLink>
        </div>
      </aside>
    );
  }

  if (status === 'REJECTED') {
    return (
      <aside
        className={`rounded-none border-l-4 border-[#a83232] bg-[#faeceb] p-5 text-[#6d1b1b] sm:p-6 ${className}`}
        role="alert"
        aria-label="Status verifikasi identitas ditolak"
      >
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <h2 className="text-lg font-bold text-ed-ink">Foto selfie perlu diambil ulang</h2>
            <p className="text-base leading-relaxed text-ed-muted">
              {rejectionReason
                ? `Foto sebelumnya belum bisa dipakai (${rejectionReason}). Ambil foto baru untuk lanjut.`
                : 'Foto sebelumnya belum bisa dipakai. Ambil foto baru untuk lanjut.'}
            </p>
          </div>
          <ButtonLink
            href={`/account/verification${returnParam}`}
            className="w-full sm:w-auto min-h-[44px] shrink-0"
          >
            Ambil foto baru
          </ButtonLink>
        </div>
      </aside>
    );
  }

  // Default: Belum verifikasi (ACTION_REQUIRED, UNVERIFIED, CUSTOMER_VERIFICATION_REQUIRED, dll)
  return (
    <aside
      className={`rounded-none border-l-4 border-[#27607c] bg-[#e8f3f8] p-5 text-[#1c4456] sm:p-6 ${className}`}
      role="region"
      aria-label="Pemberitahuan verifikasi identitas"
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <h2 className="text-lg font-bold text-ed-ink">Ambil foto selfie dulu</h2>
          <p className="text-base leading-relaxed text-ed-muted">
            Satu foto wajah, tanpa KTP. Wajib sebelum membeli paket dan booking kelas.
          </p>
        </div>
        <ButtonLink
          href={`/account/verification${returnParam}`}
          className="w-full sm:w-auto min-h-[44px] shrink-0"
        >
          Ambil foto selfie
        </ButtonLink>
      </div>
    </aside>
  );
}
