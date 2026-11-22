import type { Metadata } from 'next';
import { JadwalSesuaiPeran } from './jadwal-sesuai-peran';

export const metadata: Metadata = {
  title: 'Timetable Kelas',
};

export default function WorkspaceClassesPage() {
  return <JadwalSesuaiPeran />;
}
