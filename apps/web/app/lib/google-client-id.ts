/**
 * Client ID OAuth Google untuk tombol "Lanjutkan dengan Google". Nilai ini publik (ikut tampil di
 * halaman login), jadi aman disimpan di kode sebagai bawaan; `NEXT_PUBLIC_GOOGLE_CLIENT_ID` saat build
 * tetap didahulukan. Client secret tidak dipakai dan tidak boleh disimpan di sini.
 */
export const GOOGLE_CLIENT_ID_BAWAAN =
  '223751724199-nhdfh02bnie3fjfm61ss0emknabqrbqf.apps.googleusercontent.com';

export function googleClientId(): string {
  return process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID?.trim() || GOOGLE_CLIENT_ID_BAWAAN;
}
