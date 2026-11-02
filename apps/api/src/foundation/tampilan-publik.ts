/**
 * Bentuk ringkas instruktur dan cabang untuk respons yang dibaca member (jadwal, booking).
 * Query memakai `include` sehingga baris utuh tersedia; yang dikirim hanya kolom yang dipakai layar.
 */
type BarisInstruktur = { id: string; displayName: string } | null | undefined;
type BarisCabang = {
  id: string;
  code?: string | null;
  name?: string | null;
  address?: string | null;
  timezone?: string | null;
  supportWhatsappE164?: string | null;
  active?: boolean;
} | null | undefined;

export function instrukturPublik(instructor: BarisInstruktur) {
  return instructor ? { id: instructor.id, displayName: instructor.displayName } : null;
}

export function cabangPublik(branch: BarisCabang) {
  if (!branch) return null;
  return {
    id: branch.id,
    code: branch.code ?? null,
    name: branch.name ?? null,
    address: branch.address ?? null,
    timezone: branch.timezone ?? 'Asia/Jakarta',
    supportWhatsappE164: branch.supportWhatsappE164 ?? null,
    active: branch.active ?? true,
  };
}
