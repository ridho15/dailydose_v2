import type { Metadata } from 'next';
import { PetugasCheckinView } from './petugas-checkin-view';

export const metadata: Metadata = { title: 'Petugas Check-in' };

export default function PetugasCheckinPage() {
  return <PetugasCheckinView />;
}
