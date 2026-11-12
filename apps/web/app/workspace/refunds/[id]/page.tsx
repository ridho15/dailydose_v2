import type { Metadata } from 'next';
import { SuratRefundView } from './surat-refund-view';

export const metadata: Metadata = { title: 'Konfirmasi refund' };

export default async function SuratRefundPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <SuratRefundView id={id} />;
}
