'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Calendar, RefreshCw } from 'lucide-react';
import { AdminPageHeader } from '../../components/admin/admin-page-header';
import { Badge, DataTable, Panel, StatCard } from '../../components/admin/admin-ui';
import { Button } from '../../components/actions';
import { SearchSelect } from '../../components/forms';
import { useSessionContext } from '../../session-context';
import { formatRupiah } from '../../lib/formatters';
import { presetRange, RANGE_PRESETS, rangeProblem } from '../../finance/report-range';

interface InstructorBreakdown {
  instructorId: string;
  instructorName: string;
  groupHours: number;
  groupFeeRp: number;
  semiPrivateHours: number;
  semiPrivateFeeRp: number;
  privateHours: number;
  privateFeeRp: number;
  totalHours: number;
  totalFeeRp: number;
  unverifiedClassCount: number;
  unconfiguredFeeClassCount?: number;
}

interface PerformanceData {
  branch: {
    id: string;
    code: string;
    name: string;
  };
  period: string;
  from?: string;
  until?: string;
  omsetRp: number;
  otherCostRp: number;
  totalInstructorFeeRp: number;
  totalUnverifiedFeeRp: number;
  unverifiedClassCount: number;
  unconfiguredClassCount?: number;
  instructorFeeMissing?: boolean;
  /** Sesi terjual x modal per sesi; dasar profit. */
  modalSesiRp?: number;
  sesiTerjual?: number;
  sesiTanpaModal?: number;
  estimatedProfitRp: number;
  instructorCount: number;
  totalClassHours: number;
  instructors: InstructorBreakdown[];
}

export function OwnerBranchPerformanceView() {
  const searchParams = useSearchParams();
  const urlBranch = searchParams?.get('branch') || searchParams?.get('branchId') || '';
  const context = useSessionContext();
  const session = context?.session;
  const branches = session?.branches ?? [];

  // Cabang mengikuti query URL ?branch=; bila tidak ada, pemilih "Cabang aktif" di topbar; bila "Semua cabang", tampilkan cabang pertama.
  const activeBranchId = context?.activeBranchId ?? '';
  const [selectedBranchId, setSelectedBranchId] = useState<string>(
    () => urlBranch || activeBranchId || branches[0]?.id || '',
  );

  useEffect(() => {
    if (!selectedBranchId && (urlBranch || activeBranchId || branches[0]?.id)) {
      setSelectedBranchId(urlBranch || activeBranchId || branches[0]?.id || '');
    }
  }, [urlBranch, activeBranchId, branches, selectedBranchId]);

  const [range, setRange] = useState(() => presetRange('THIS_MONTH'));
  const [data, setData] = useState<PerformanceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    if (!selectedBranchId) return;
    const problem = rangeProblem(range);
    if (problem) {
      setError(problem);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const query = new URLSearchParams({
        branchId: selectedBranchId,
        from: range.from,
        until: range.until,
      });
      const res = await fetch(`/api/v1/finance/owner-branch-performance?${query.toString()}`, {
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) {
        if (res.status === 403) {
          throw new Error('403 Forbidden: Anda tidak memiliki wewenang untuk mengakses cabang ini.');
        }
        throw new Error('Gagal memuat data performa cabang.');
      }
      const json = await res.json();
      setData(json);
    } catch (err: any) {
      setError(err.message || 'Terjadi kesalahan sistem.');
    } finally {
      setLoading(false);
    }
  }, [selectedBranchId, range]);

  useEffect(() => {
    if (selectedBranchId) {
      void loadData();
    }
  }, [selectedBranchId, loadData]);

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Performa Cabang Privat"
        description="Laporan Omset, Estimasi Profit, dan Rincian Biaya Mengajar Instruktur untuk Owner Cabang"
        actions={
          <Button
            variant="secondary"
            leadingIcon={<RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />}
            onClick={loadData}
            disabled={loading}
          >
            Perbarui
          </Button>
        }
      />

      {/* Filter Cabang & Periode */}
      <div className="flex flex-wrap items-center gap-6 rounded-dd-lg border border-dd-line bg-dd-surface p-4">
        {branches.length > 0 && (
          <div className="w-72">
            <SearchSelect
              label="Cabang Studio"
              value={selectedBranchId}
              onChange={(val) => {
                if (val) setSelectedBranchId(val);
              }}
              options={branches.map((b) => ({
                id: b.id,
                label: `${b.name} (${b.code})`,
              }))}
              placeholder="Pilih Cabang..."
              clearable={false}
              compact
            />
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <label htmlFor="range-from" className="text-xs font-semibold text-dd-muted flex items-center gap-1.5">
            <Calendar className="size-3.5 text-dd-muted" /> Dari tanggal:
          </label>
          <input
            id="range-from"
            type="date"
            value={range.from}
            max={range.until || undefined}
            onChange={(e) => setRange((current) => ({ ...current, from: e.target.value }))}
            className="rounded-dd-sm border border-dd-line bg-dd-surface px-3 py-1.5 text-sm font-medium text-dd-ink focus:outline-none focus:ring-2 focus:ring-dd-forest"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="range-until" className="text-xs font-semibold text-dd-muted">
            Sampai tanggal:
          </label>
          <input
            id="range-until"
            type="date"
            value={range.until}
            min={range.from || undefined}
            onChange={(e) => setRange((current) => ({ ...current, until: e.target.value }))}
            className="rounded-dd-sm border border-dd-line bg-dd-surface px-3 py-1.5 text-sm font-medium text-dd-ink focus:outline-none focus:ring-2 focus:ring-dd-forest"
          />
        </div>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Rentang cepat">
          {RANGE_PRESETS.map((preset) => (
            <Button key={preset.id} variant="secondary" onClick={() => setRange(presetRange(preset.id))}>
              {preset.label}
            </Button>
          ))}
        </div>
      </div>

      {error && (
        <div className="rounded-dd-lg border border-dd-danger/30 bg-dd-danger-soft p-4 text-sm font-medium text-dd-danger">
          {error}
        </div>
      )}

      {data?.instructorFeeMissing && (
        <div className="rounded-dd-lg border border-dd-brass/40 bg-dd-warning-soft/80 p-4 text-sm font-medium text-dd-ink">
          <div className="flex items-center gap-2">
            <span className="font-bold text-dd-forest">Perhatian Operasional:</span>
            <span className="text-dd-ink">Sebagian atau seluruh tarif honor instruktur belum dikonfigurasi di Master Data ({data.unconfiguredClassCount ?? 0} kelas).</span>
          </div>
          <p className="mt-1 text-xs text-dd-muted">
            Biaya instruktur menggunakan estimasi tarif standar. Mohon lengkapi data tarif pada menu Master Data agar angka pengeluaran dan estimasi profit akurat.
          </p>
        </div>
      )}

      {/* Ringkasan Finansial */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard
          label="Omset Cabang"
          value={formatRupiah(data?.omsetRp ?? 0)}
          tone="success"
        />
        <StatCard
          label="Modal Sesi Terjual"
          value={formatRupiah(data?.modalSesiRp ?? 0)}
          helper={
            data && (data.sesiTanpaModal ?? 0) > 0
              ? `${data.sesiTanpaModal} sesi belum punya modal per sesi (dihitung Rp0)`
              : `${data?.sesiTerjual ?? 0} sesi x modal per sesi`
          }
          tone={data && (data.sesiTanpaModal ?? 0) > 0 ? 'warning' : 'neutral'}
        />
        <StatCard
          label="Honor Instruktur (dibayar)"
          value={formatRupiah(data?.totalInstructorFeeRp ?? 0)}
          helper={
            data?.instructorFeeMissing
              ? `Tarif belum diset (${data.unconfiguredClassCount ?? 0} kelas butuh konfigurasi)`
              : data && data.unverifiedClassCount > 0
                ? `${data.unverifiedClassCount} kelas (${formatRupiah(data.totalUnverifiedFeeRp)}) belum terverifikasi presensi`
                : undefined
          }
          tone={data?.instructorFeeMissing ? 'warning' : data && data.unverifiedClassCount > 0 ? 'warning' : 'neutral'}
        />
        <StatCard
          label="Biaya Operasional Lain"
          value={formatRupiah(data?.otherCostRp ?? 0)}
          tone="warning"
        />
        <StatCard
          label="Estimasi Profit"
          value={formatRupiah(data?.estimatedProfitRp ?? 0)}
          helper="Omset − modal sesi − biaya operasional"
          tone={(data?.estimatedProfitRp ?? 0) >= 0 ? 'success' : 'danger'}
        />
      </div>

      {/* Tabel Rincian Biaya Mengajar Instruktur */}
      <Panel>
        <div className="border-b border-dd-line p-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-base font-bold text-dd-ink">
                Detail Biaya Mengajar Instruktur
              </h3>
              <p className="text-xs text-dd-muted">
                Daftar jam mengajar dan akumulasi honor instruktur per tipe kelas di cabang ini.
              </p>
            </div>
            <Badge tone="info">
              {data?.instructorCount ?? 0} Instruktur • {data?.totalClassHours ?? 0} Jam
            </Badge>
          </div>
        </div>

        <DataTable
          columns={[
            {
              id: 'instructorName',
              header: 'Nama Instruktur',
              cell: (item: InstructorBreakdown) => (
                <div className="font-semibold text-dd-ink">{item.instructorName}</div>
              ),
            },
            {
              id: 'groupClass',
              header: 'Group Class',
              cell: (item: InstructorBreakdown) => (
                <div>
                  <span className="font-medium">{item.groupHours} jam</span>
                  <div className="text-xs text-dd-muted">{formatRupiah(item.groupFeeRp)}</div>
                </div>
              ),
            },
            {
              id: 'semiPrivate',
              header: 'Semi Private',
              cell: (item: InstructorBreakdown) => (
                <div>
                  <span className="font-medium">{item.semiPrivateHours} jam</span>
                  <div className="text-xs text-dd-muted">{formatRupiah(item.semiPrivateFeeRp)}</div>
                </div>
              ),
            },
            {
              id: 'private',
              header: 'Private',
              cell: (item: InstructorBreakdown) => (
                <div>
                  <span className="font-medium">{item.privateHours} jam</span>
                  <div className="text-xs text-dd-muted">{formatRupiah(item.privateFeeRp)}</div>
                </div>
              ),
            },
            {
              id: 'totalHours',
              header: 'Total Jam',
              cell: (item: InstructorBreakdown) => (
                <div className="font-bold text-dd-ink">{item.totalHours} jam</div>
              ),
            },
            {
              id: 'totalFee',
              header: 'Total Honor (Rp)',
              cell: (item: InstructorBreakdown) => (
                <div>
                  <div className="font-bold text-dd-forest">{formatRupiah(item.totalFeeRp)}</div>
                  {item.unconfiguredFeeClassCount && item.unconfiguredFeeClassCount > 0 ? (
                    <div className="text-xs font-semibold text-dd-brass">
                      {item.unconfiguredFeeClassCount} kelas tarif belum diset
                    </div>
                  ) : null}
                  {item.unverifiedClassCount > 0 && (
                    <div className="text-xs font-semibold text-dd-warning">
                      {item.unverifiedClassCount} kelas belum terverifikasi
                    </div>
                  )}
                </div>
              ),
            },
          ]}
          items={data?.instructors ?? []}
          rowKey={(item) => item.instructorId}
          emptyTitle="Belum ada catatan mengajar"
          emptyDescription="Belum ada catatan kelas mengajar instruktur pada rentang tanggal ini."
          mobileCard={(item: InstructorBreakdown) => (
            <div className="space-y-1.5 text-xs">
              <div className="flex items-center justify-between">
                <strong className="text-sm font-bold text-dd-ink">{item.instructorName}</strong>
                <strong className="text-sm font-bold text-dd-forest">{formatRupiah(item.totalFeeRp)}</strong>
              </div>
              <div className="grid grid-cols-3 gap-1 py-1 text-[11px] text-dd-muted border-y border-dd-line/40">
                <div>Group: {item.groupHours}j ({formatRupiah(item.groupFeeRp)})</div>
                <div>Semi: {item.semiPrivateHours}j ({formatRupiah(item.semiPrivateFeeRp)})</div>
                <div>Priv: {item.privateHours}j ({formatRupiah(item.privateFeeRp)})</div>
              </div>
              <div className="flex items-center justify-between text-dd-muted">
                <span>Total: <strong>{item.totalHours} jam</strong></span>
                {item.unconfiguredFeeClassCount && item.unconfiguredFeeClassCount > 0 ? (
                  <span className="text-xs font-semibold text-dd-brass">
                    {item.unconfiguredFeeClassCount} kelas pakai estimasi
                  </span>
                ) : item.unverifiedClassCount > 0 ? (
                  <span className="text-xs font-semibold text-dd-warning">
                    {item.unverifiedClassCount} kelas belum verifikasi
                  </span>
                ) : null}
              </div>
            </div>
          )}
        />
      </Panel>
    </div>
  );
}
