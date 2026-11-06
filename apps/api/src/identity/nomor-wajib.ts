/**
 * Apakah member wajib mengisi nomor WhatsApp setelah login. Bawaannya TIDAK: nomor sering bermasalah
 * (sudah dipakai akun lama, format ditolak) dan memblok seluruh aplikasi mengganggu operasional.
 * Untuk mewajibkannya lagi, set PHONE_REQUIRED=true dan buat ulang container API.
 */
export const nomorWajib = (env: Record<string, string | undefined> = process.env) =>
  env.PHONE_REQUIRED === 'true';

export const perluLengkapiNomor = (
  phone: string | null | undefined,
  env: Record<string, string | undefined> = process.env,
) => nomorWajib(env) && !phone;
