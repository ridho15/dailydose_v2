import type { Metadata } from 'next';
import { DaftarPembatalanView } from './daftar-pembatalan-view';

export const metadata: Metadata = { title: 'Pengajuan batal < 12 jam' };

export default function DaftarPembatalanPage() {
  return <DaftarPembatalanView />;
}
