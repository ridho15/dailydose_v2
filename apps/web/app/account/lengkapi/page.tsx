import type { Metadata } from 'next';
import { LengkapiAkunView } from './lengkapi-akun-view';

export const metadata: Metadata = { title: 'Lengkapi akun' };

export default function LengkapiAkunPage() {
  return <LengkapiAkunView />;
}
