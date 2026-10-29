import type { Metadata } from 'next';
import { UlasanView } from './ulasan-view';

export const metadata: Metadata = { title: 'Ulasan instruktur' };

export default function UlasanPage() {
  return <UlasanView />;
}
