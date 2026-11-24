import { HttpStatus } from '@nestjs/common';
import type { PrivateFileStorage } from '../identity/private-file-storage';
import { ApiProblem } from '../identity/security';
import { JENIS_BUKTI, kenaliBukti, kunciBukti } from '../packages/penyesuaian-bukti.service';

/**
 * Bukti pendukung pengajuan batal kurang dari 12 jam (keputusan pemilik 24 November 2026):
 * wajib bila admin yang mengajukan, tidak wajib bagi member. Disimpan di penyimpanan privat dengan
 * kunci dari id pengajuan (`session_adjust_request`), sama seperti bukti Penyesuaian Sesi, sehingga
 * dibuka lewat GET /session-adjustments/:id/evidence dan tidak butuh kolom atau tabel baru.
 */
export const MAKS_BUKTI_PENGAJUAN_BYTE = 8_000_000;

export type BerkasUnggahan = { buffer?: Buffer; size?: number } | undefined;

export function buktiWajibAda(): ApiProblem {
  return new ApiProblem('EVIDENCE_REQUIRED', HttpStatus.UNPROCESSABLE_ENTITY, false, [
    { field: 'evidence', issue: 'REQUIRED' },
  ]);
}

/** Memeriksa berkas unggahan; null bila tidak ada berkas. Jenis dikenali dari byte awalnya. */
export function periksaBuktiPengajuan(berkas: BerkasUnggahan) {
  if (!berkas?.buffer || berkas.buffer.length === 0) return null;
  if (berkas.buffer.length > MAKS_BUKTI_PENGAJUAN_BYTE)
    throw new ApiProblem('UPLOAD_REJECTED', HttpStatus.PAYLOAD_TOO_LARGE, false, [
      { field: 'evidence', issue: 'TOO_LARGE' },
    ]);
  const jenis = kenaliBukti(berkas.buffer);
  if (!jenis)
    throw new ApiProblem('UPLOAD_REJECTED', HttpStatus.UNPROCESSABLE_ENTITY, false, [
      { field: 'evidence', issue: 'UNSUPPORTED_TYPE' },
    ]);
  return { buffer: berkas.buffer, jenis };
}

/** Menyimpan bukti lebih dulu; kembalikan fungsi hapus untuk dipanggil bila pengajuan gagal dibuat. */
export async function simpanBuktiPengajuan(
  storage: PrivateFileStorage | undefined,
  id: string,
  bukti: NonNullable<ReturnType<typeof periksaBuktiPengajuan>>,
): Promise<() => Promise<void>> {
  if (!storage) throw new ApiProblem('STORAGE_UNAVAILABLE', HttpStatus.SERVICE_UNAVAILABLE, true);
  const kunci = kunciBukti(id, bukti.jenis.ext);
  await storage.put({ key: kunci, content: bukti.buffer });
  return () => storage.delete(kunci).catch(() => undefined);
}

/** Alamat bukti pengajuan bila ada; null bila tanpa bukti atau penyimpanan tidak tersedia. */
export async function alamatBuktiPengajuan(
  storage: PrivateFileStorage | undefined,
  id: string,
): Promise<string | null> {
  if (!storage) return null;
  for (const jenis of JENIS_BUKTI)
    if (await storage.exists(kunciBukti(id, jenis.ext)).catch(() => false))
      return `/api/v1/session-adjustments/${id}/evidence`;
  return null;
}
