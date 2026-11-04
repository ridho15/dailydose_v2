import type { Metadata } from 'next';
import { ClassHistoryView } from './class-history-view';

export const metadata: Metadata = {
  title: 'Riwayat Kelas',
};

export default function ClassHistoryPage() {
  return <ClassHistoryView />;
}
