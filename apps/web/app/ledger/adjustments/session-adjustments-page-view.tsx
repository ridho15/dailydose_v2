'use client';

import { useSearchParams } from 'next/navigation';
import { useTrackedRouter } from '../../components/app-loading';
import { LedgerView } from '../ledger-view';
import { useSessionContext } from '../../session-context';
import { PenyesuaianForm } from './penyesuaian-form';
import { RiwayatMasaBerlaku } from './riwayat-masa-berlaku';

export function SessionAdjustmentsPageView() {
  const params = useSearchParams();
  const router = useTrackedRouter();
  const initialMode = params.get('status') === 'HISTORY' ? 'HISTORY' : 'PENDING';
  // Penyesuaian langsung dengan bukti hanya untuk Super Owner dan Studio Manager.
  const bisaLangsung = useSessionContext()?.hasCapability('ledger:adjust:decide') ?? false;
  const sesiAwal = Number(params.get('sesi'));
  const replaceFilters = (updates: Record<string, string>) => {
    const query = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(updates)) {
      if (value) query.set(key, value);
      else query.delete(key);
    }
    router.replace(`/ledger/adjustments${query.size ? `?${query.toString()}` : ''}`, {
      scroll: false,
    });
  };
  const daftar = (
    <LedgerView
      initialWorkspaceTab="adjustments"
      initialAdjustmentMode={initialMode}
      adjustmentsOnly
      asSection={bisaLangsung}
      customerUserId={params.get('customerUserId') ?? undefined}
      initialAdjustmentSearch={params.get('q') ?? ''}
      initialAdjustmentFrom={params.get('from') ?? ''}
      initialAdjustmentUntil={params.get('until') ?? ''}
      initialAdjustmentCursor={params.get('cursor') ?? ''}
      initialAdjustmentPage={params.get('page') ? Math.max(1, Number(params.get('page'))) : 1}
      onAdjustmentModeChange={(mode) => {
        const query = new URLSearchParams(params.toString());
        query.set('status', mode);
        query.delete('cursor');
        query.delete('page');
        router.replace(`/ledger/adjustments?${query.toString()}`, { scroll: false });
      }}
      onAdjustmentFiltersChange={(filters) => {
        const updates: Record<string, string> = {
          q: filters.q,
          from: filters.from,
          until: filters.until,
          cursor: filters.cursor,
        };
        if (filters.page && filters.page > 1) {
          updates.page = String(filters.page);
        } else {
          updates.page = '';
        }
        replaceFilters(updates);
      }}
      onAdjustmentPageNumberChange={(page) => {
        const query = new URLSearchParams(params.toString());
        if (page > 1) query.set('page', String(page));
        else query.delete('page');
        query.delete('cursor');
        router.replace(`/ledger/adjustments${query.size ? `?${query.toString()}` : ''}`, {
          scroll: false,
        });
      }}
    />
  );
  if (!bisaLangsung)
    return (
      <div className="space-y-8">
        {daftar}
        <RiwayatMasaBerlaku />
      </div>
    );
  return (
    <div className="space-y-8">
      <header>
        <h1 className="m-0 text-[28px] font-semibold tracking-[-0.02em] text-dd-ink sm:text-[32px]">
          Penyesuaian sesi
        </h1>
        <p className="m-0 mt-1 text-[17px] text-dd-muted">
          Hanya Super Owner dan Studio Manager. Setiap perubahan tercatat permanen beserta alasan
          dan buktinya.
        </p>
      </header>
      <PenyesuaianForm
        awal={{
          memberId: params.get('member') ?? undefined,
          bookingId: params.get('booking') ?? undefined,
          sesi: Number.isInteger(sesiAwal) && sesiAwal !== 0 ? sesiAwal : undefined,
        }}
      />
      {daftar}
      <RiwayatMasaBerlaku />
    </div>
  );
}
