import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Skeleton } from '../../ui';
import { PaketMemberView } from './paket-member-view';

export const metadata: Metadata = { title: 'Paket member' };

export default function PaketMemberPage() {
  return (
    <Suspense fallback={<Skeleton label="Memuat paket member" />}>
      <PaketMemberView />
    </Suspense>
  );
}
