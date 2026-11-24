import type { Metadata } from 'next';
import { PerpanjanganView } from './perpanjangan-view';

export const metadata: Metadata = { title: 'Paket hampir berakhir' };

export default function PerpanjanganPage() {
  return <PerpanjanganView />;
}
