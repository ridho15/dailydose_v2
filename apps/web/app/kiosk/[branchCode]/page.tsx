import { redirect } from 'next/navigation';

/** Alamat lama: pemindaian sekarang dilakukan staf di halaman Check-in, tanpa tablet ber-PIN. */
export default function AlamatLama() {
  redirect('/workspace/check-in');
}
