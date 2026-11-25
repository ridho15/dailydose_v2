import type { Metadata } from 'next';
import { StokMinumanView } from './stok-minuman-view';

export const metadata: Metadata = { title: 'Stok Minuman' };

export default function StokMinumanPage() {
  return <StokMinumanView />;
}
