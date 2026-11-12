import type { Metadata } from 'next';
import { Suspense } from 'react';
import { RefundBaruView } from './refund-baru-view';

export const metadata: Metadata = { title: 'Refund paket' };

export default function RefundBaruPage() {
  return (
    <Suspense>
      <RefundBaruView />
    </Suspense>
  );
}
