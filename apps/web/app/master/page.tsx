'use client';

import { useSearchParams } from 'next/navigation';
import { useEffect } from 'react';
import { MasterView } from './master-view';
import type { MasterTab } from './master-view';
import { useTrackedRouter } from '../components/app-loading';
import { useSessionContext } from '../session-context';

const VALID_MASTER_TABS: MasterTab[] = [
  'classTypes',
  'capacity',
  'fees',
  'modal',
];

export default function MasterPage() {
  const params = useSearchParams();
  const router = useTrackedRouter();
  const session = useSessionContext();
  const setActiveBranchId = session?.setActiveBranchId;
  const requestedTab = params.get('tab');
  const requestedBranch = params.get('branch');

  // Graceful redirect for legacy master tabs to their canonical domain pages
  useEffect(() => {
    if (!requestedTab) return;
    if (requestedTab === 'branches') {
      router.replace('/workspace/branches');
    } else if (requestedTab === 'packages') {
      router.replace('/workspace/packages');
    } else if (requestedTab === 'vouchers') {
      router.replace('/workspace/vouchers');
    } else if (requestedTab === 'projection') {
      // Fitur proyeksi dihapus; tautan lama kembali ke Data Master.
      router.replace('/master');
    } else if (['venues', 'accounts', 'publicProfiles'].includes(requestedTab)) {
      if (requestedBranch) {
        router.replace(`/workspace/branches/${requestedBranch.toLowerCase()}`);
      } else {
        router.replace('/workspace/branches');
      }
    }
  }, [requestedTab, requestedBranch, router]);

  useEffect(() => {
    if (requestedBranch) setActiveBranchId?.(requestedBranch);
  }, [requestedBranch, setActiveBranchId]);

  const activeTab: MasterTab =
    requestedTab && VALID_MASTER_TABS.includes(requestedTab as MasterTab)
      ? (requestedTab as MasterTab)
      : 'classTypes';

  const setActiveTab = (tab: MasterTab) => {
    const next = new URLSearchParams(params.toString());
    if (tab === 'classTypes') next.delete('tab');
    else next.set('tab', tab);
    router.replace(`/master${next.size ? `?${next}` : ''}`);
  };

  return <MasterView activeTab={activeTab} onTabChange={setActiveTab} />;
}
