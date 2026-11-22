'use client';

import { useEffect, useState } from 'react';
import { browserWorkQueueClient } from '@/api-clients/work-queue-client';
import { useSessionContext } from '../session-context';

export type QueueCounts = Record<string, number>;

/**
 * Jumlah keputusan yang menunggu pengguna ini (kotak masuk "Perlu tindakan"), untuk badge menu
 * Beranda. `tindakan` adalah totalnya; tiap jenis (TRANSFER, RESCHEDULE, …) juga tersedia.
 * Dipakai sekali di shell dan diteruskan ke sidebar serta navigasi bawah ponsel.
 */
export function useQueueCounts(enabled: boolean): QueueCounts {
  const context = useSessionContext();
  const session = context?.session;
  const activeBranchId = context?.activeBranchId;
  const [counts, setCounts] = useState<QueueCounts>({});

  useEffect(() => {
    if (!enabled || !session || !browserWorkQueueClient.tindakan) return;
    let active = true;
    browserWorkQueueClient
      .tindakan({ branchId: activeBranchId || undefined })
      .then((kotak) => {
        if (!active) return;
        const hasil: QueueCounts = Object.fromEntries(kotak.ringkasan.map((r) => [r.jenis, r.jumlah]));
        hasil.tindakan = kotak.ringkasan.reduce((sum, r) => sum + r.jumlah, 0);
        setCounts(hasil);
      })
      .catch(() => {
        if (active) setCounts({});
      });
    return () => {
      active = false;
    };
  }, [activeBranchId, enabled, session]);

  return enabled ? counts : {};
}
