'use client';

import { Upload } from 'lucide-react';
import { useId } from 'react';

export const TIPE_BUKTI = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
export const MAKS_BUKTI_BYTE = 8_000_000;

/** Pesan bila berkas tidak bisa dipakai; null bila boleh. Server tetap memeriksa ulang dari isi berkas. */
export function masalahBukti(berkas: File | null): string | null {
  if (!berkas) return null;
  if (!TIPE_BUKTI.includes(berkas.type)) return 'Bukti harus foto (JPG, PNG, WEBP) atau PDF.';
  if (berkas.size > MAKS_BUKTI_BYTE) return 'Bukti paling besar 8 MB. Kecilkan foto lalu pilih lagi.';
  return null;
}

/**
 * Pemilih satu berkas bukti pendukung (tangkapan layar chat, surat dokter). `wajib` hanya mengubah
 * label; syarat wajibnya ditegakkan di server.
 */
export function PilihBukti({
  berkas,
  onChange,
  wajib,
  petunjuk = 'Tangkapan layar percakapan atau surat dokter',
}: {
  berkas: File | null;
  onChange: (berkas: File | null) => void;
  wajib: boolean;
  petunjuk?: string;
}) {
  const id = useId();
  const masalah = masalahBukti(berkas);
  return (
    <div>
      <p id={`${id}-judul`} className="m-0 mb-2 text-[15px] font-semibold text-dd-ink">
        Bukti pendukung, {wajib ? 'wajib' : 'tidak wajib'}
      </p>
      <div className="flex flex-wrap items-center gap-3 rounded-dd-sm border border-dashed border-dd-border-interactive p-3">
        <Upload className="size-5 shrink-0 text-dd-muted" aria-hidden="true" />
        <p className="m-0 min-w-0 flex-1 break-words text-sm text-dd-ink">{berkas ? berkas.name : petunjuk}</p>
        <label className="inline-flex min-h-11 cursor-pointer items-center rounded-dd-sm border border-dd-border-interactive bg-white px-4 text-[15px] font-semibold text-dd-forest focus-within:outline focus-within:outline-3 focus-within:outline-offset-2 focus-within:outline-[#09371f]">
          {berkas ? 'Ganti berkas' : 'Pilih berkas'}
          <input
            type="file"
            accept={TIPE_BUKTI.join(',')}
            className="sr-only"
            aria-labelledby={`${id}-judul`}
            onChange={(e) => onChange(e.target.files?.[0] ?? null)}
          />
        </label>
      </div>
      <p className={`m-0 mt-1 text-sm ${masalah ? 'text-dd-danger' : 'text-dd-muted'}`} role={masalah ? 'alert' : undefined}>
        {masalah ?? 'Foto atau PDF, paling besar 8 MB.'}
      </p>
    </div>
  );
}
