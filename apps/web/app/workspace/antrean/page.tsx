import { redirect } from 'next/navigation';

/** Alamat lama: antrean kini menjadi kotak masuk "Perlu tindakan" di beranda. */
export default function AlamatLama() {
  redirect('/workspace#perlu-tindakan');
}
