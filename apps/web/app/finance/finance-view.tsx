'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  AlertTriangle,
  DollarSign,
  Download,
  FileSpreadsheet,
  PieChart,
  RefreshCw,
  Scale,
  Trash2,
  TrendingUp,
  Users,
} from 'lucide-react';
import { useSessionContext } from '../session-context';
import { Feedback } from '../ui';
import { AdminPageHeader } from '../components/admin/admin-page-header';
import { ReasonDialog } from '../components/admin/reason-dialog';
import {
  AdminEmptyState,
  Badge,
  DataTable,
  FilterBar,
  Pagination,
  Panel,
  StatCard,
} from '../components/admin/admin-ui';
import { Button } from '../components/actions';
import { useAppFeedback } from '../components/app-feedback';
import { SearchSelect } from '../components/forms';
import {
  browserFinanceClient,
  financeFailureMessage,
  type FinanceClient,
  type FinanceData,
  type OmsetReportData,
  type OmsetTransaction,
  type InstructorCostRealtimeData,
  type InstructorCostBreakdown,
  type InstructorSessionItem,
  type OtherCostReportData,
  type OtherCostItem,
  type ProfitData,
} from './finance-client';
import { OtherCostEditDialog } from './other-cost-edit-dialog';
import { OtherCostForm } from './other-cost-form';
import { formatDay, presetRange, RANGE_PRESETS, rangeProblem } from './report-range';
import { formatRupiah, formatTanggalSingkat } from '../lib/formatters';
import { pageOffset } from '../lib/pagination';
import { formatAnomalyType, formatSeverity, formatStudioName } from '../lib/system-dictionary';

const date = (value: Date) => value.toISOString().slice(0, 10);

type MainTab = 'FINANCIAL_REPORTS' | 'RECONCILIATION';
type ReportSubTab =
  | 'PROFIT'
  | 'OMSET'
  | 'INSTRUCTOR_REALTIME'
  | 'OTHER_COST';

export function FinanceView({
  client = browserFinanceClient,
  initialTab,
}: {
  client?: FinanceClient;
  initialTab?: MainTab;
}) {
  const context = useSessionContext();
  const searchParams = useSearchParams();
  const session = context?.session;
  const branches = session?.branches ?? [];
  const feedback = useAppFeedback();

  const queryTab = searchParams?.get('tab')?.toUpperCase();
  const defaultTab: MainTab =
    queryTab === 'RECONCILIATION'
      ? 'RECONCILIATION'
      : (initialTab || 'FINANCIAL_REPORTS');
  const [mainTab, setMainTab] = useState<MainTab>(defaultTab);
  const [reportTab, setReportTab] = useState<ReportSubTab>('PROFIT');
  const [instructorViewMode, setInstructorViewMode] = useState<'SUMMARY' | 'SESSIONS'>('SUMMARY');

  // Filter states
  const [reportRange, setReportRange] = useState(() => presetRange('THIS_MONTH'));
  const [selectedBranchId, setSelectedBranchId] = useState<string>('');

  // Reconciliation / Legacy states
  const [from, setFrom] = useState(() => date(new Date(Date.now() - 29 * 86_400_000)));
  const [until, setUntil] = useState(() => date(new Date()));
  const [reconData, setReconData] = useState<FinanceData>();
  const [reconLoading, setReconLoading] = useState(false);
  const [reconFailed, setReconFailed] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [anomalyCursor, setAnomalyCursor] = useState<string>();
  const [anomalyCursorHistory, setAnomalyCursorHistory] = useState<string[]>([]);
  const [legacyCursor, setLegacyCursor] = useState<string>();
  const [legacyCursorHistory, setLegacyCursorHistory] = useState<string[]>([]);

  // 5 Laporan Finansial states
  const [profitData, setProfitData] = useState<ProfitData | null>(null);
  const [omsetData, setOmsetData] = useState<OmsetReportData | null>(null);
  const [instructorRealtimeData, setInstructorRealtimeData] =
    useState<InstructorCostRealtimeData | null>(null);
  const [otherCostData, setOtherCostData] = useState<OtherCostReportData | null>(null);
  const [editingCost, setEditingCost] = useState<OtherCostItem | null>(null);
  const [costToDelete, setCostToDelete] = useState<OtherCostItem | null>(null);
  const canManageCosts = Boolean(context?.hasCapability('finance:manage'));
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);

  const allowed = context?.hasCapability('finance:reconcile');

  // Inisialisasi cabang
  useEffect(() => {
    if (branches.length > 0 && !selectedBranchId) {
      const active = branches.find((b) => b.id === context?.activeBranchId) || branches[0];
      if (active) setSelectedBranchId(active.id);
    }
  }, [branches, context?.activeBranchId, selectedBranchId]);

  // Load Rekonsiliasi data
  const loadReconciliation = useCallback(async () => {
    if (!allowed) return;
    setReconLoading(true);
    setReconFailed(false);
    try {
      const input = { branchId: context?.activeBranchId || undefined, from, until };
      const [overview, anomalies, legacyCashflow] = await Promise.all([
        client.overview(input),
        client.anomalies(input),
        client.legacyCashflow(input),
      ]);
      setReconData({ overview, anomalies, legacyCashflow });
      setAnomalyCursor(undefined);
      setAnomalyCursorHistory([]);
      setLegacyCursor(undefined);
      setLegacyCursorHistory([]);
    } catch {
      setReconFailed(true);
    } finally {
      setReconLoading(false);
    }
  }, [allowed, client, context?.activeBranchId, from, until]);

  // Load Laporan Finansial
  const loadReports = useCallback(async () => {
    if (
      !selectedBranchId ||
      !client.getProfit ||
      !client.getOmsetReport ||
      !client.getInstructorCostRealtime ||
      !client.getOtherCostReport
    )
      return;
    const problem = rangeProblem(reportRange);
    if (problem) {
      setReportError(problem);
      return;
    }
    setReportLoading(true);
    setReportError(null);
    try {
      const [profit, omset, realtime, other] = await Promise.all([
        client.getProfit(selectedBranchId, reportRange),
        client.getOmsetReport(selectedBranchId, reportRange),
        client.getInstructorCostRealtime(selectedBranchId, reportRange),
        client.getOtherCostReport(selectedBranchId, reportRange),
      ]);
      setProfitData(profit);
      setOmsetData(omset);
      setInstructorRealtimeData(realtime);
      setOtherCostData(other);
    } catch (err: any) {
      setReportError(financeFailureMessage(err));
    } finally {
      setReportLoading(false);
    }
  }, [client, selectedBranchId, reportRange]);

  useEffect(() => {
    void loadReconciliation();
  }, [loadReconciliation]);

  useEffect(() => {
    if (selectedBranchId) {
      void loadReports();
    }
  }, [selectedBranchId, loadReports]);

  const loadAnomalyPage = async (cursor?: string) => {
    if (!allowed || !reconData) return false;
    setReconLoading(true);
    setReconFailed(false);
    try {
      const anomalies = await client.anomalies(
        { branchId: context?.activeBranchId || undefined, from, until },
        cursor,
      );
      setReconData({ ...reconData, anomalies });
      setAnomalyCursor(cursor);
      return true;
    } catch {
      setReconFailed(true);
      return false;
    } finally {
      setReconLoading(false);
    }
  };

  const loadLegacyPage = async (cursor?: string) => {
    if (!allowed || !reconData) return false;
    setReconLoading(true);
    setReconFailed(false);
    try {
      const legacyCashflow = await client.legacyCashflow(
        { branchId: context?.activeBranchId || undefined, from, until },
        cursor,
      );
      setReconData({ ...reconData, legacyCashflow });
      setLegacyCursor(cursor);
      return true;
    } catch {
      setReconFailed(true);
      return false;
    } finally {
      setReconLoading(false);
    }
  };

  const exportCsv = async () => {
    if (!reconData || !client.exportReport || !context?.hasCapability('finance:export')) return;
    setExporting(true);
    setReconFailed(false);
    try {
      const result = await client.exportReport({
        branchId: context.activeBranchId || undefined,
        from,
        until,
      });
      const blob = new Blob([result.content], { type: String(result.mimeType) });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = result.fileName;
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      setReconFailed(true);
    } finally {
      setExporting(false);
    }
  };

  if (!allowed)
    return (
      <Feedback kind="error">
        Anda tidak memiliki izin finance:reconcile untuk membuka modul finansial.
      </Feedback>
    );

  const metrics = reconData?.overview.metrics;

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Keuangan"
        description="Omzet, honor instruktur aktual, biaya lain, dan laba bersih untuk rentang tanggal yang Anda pilih, serta rekonsiliasi transaksi."
        actions={
          <div className="flex gap-2">
            {context?.hasCapability('finance:export') && (
              <Button
                variant="secondary"
                leadingIcon={<Download className="h-4 w-4" />}
                disabled={exporting || !reconData || !client.exportReport}
                onClick={() => void exportCsv()}
              >
                {exporting ? 'Mengekspor…' : 'Ekspor CSV'}
              </Button>
            )}
            <Button
              variant="secondary"
              leadingIcon={
                <RefreshCw
                  className={`h-4 w-4 ${reconLoading || reportLoading ? 'animate-spin' : ''}`}
                />
              }
              disabled={reconLoading || reportLoading}
              onClick={() => {
                void loadReconciliation();
                void loadReports();
              }}
            >
              Segarkan
            </Button>
          </div>
        }
      />

      {reportError && <Feedback kind="error">{reportError}</Feedback>}
      {reconFailed && (
        <Feedback kind="error">
          Gagal memuat atau mengekspor data finansial server. Silakan coba kembali.
        </Feedback>
      )}

      {/* TABS UTAMA: LAPORAN KEUANGAN vs REKONSILIASI */}
      <div className="flex gap-6 border-b border-dd-line">
        <button
          type="button"
          onClick={() => setMainTab('FINANCIAL_REPORTS')}
          className={`-mb-px flex items-center gap-2 pb-3 text-sm sm:text-base font-semibold transition-colors ${
            mainTab === 'FINANCIAL_REPORTS'
              ? 'border-b-2 border-dd-forest text-dd-forest'
              : 'border-b-2 border-transparent text-dd-muted hover:text-dd-ink'
          }`}
        >
          <PieChart className="h-5 w-5" />
          Laporan Keuangan & Honor Instruktur
        </button>

        <button
          type="button"
          onClick={() => setMainTab('RECONCILIATION')}
          className={`-mb-px flex items-center gap-2 pb-3 text-sm sm:text-base font-semibold transition-colors ${
            mainTab === 'RECONCILIATION'
              ? 'border-b-2 border-dd-forest text-dd-forest'
              : 'border-b-2 border-transparent text-dd-muted hover:text-dd-ink'
          }`}
        >
          <Scale className="h-5 w-5" />
          Rekonsiliasi Transaksi & Anomali (Opsional)
        </button>
      </div>

      {/* ========================================================================= */}
      {/* SECTION: LAPORAN KEUANGAN MENURUT RENTANG TANGGAL                        */}
      {/* ========================================================================= */}
      {mainTab === 'FINANCIAL_REPORTS' && (
        <div className="space-y-6">
          {/* FILTER: CABANG & RENTANG TANGGAL */}
          <Panel className="flex flex-wrap items-end gap-4 p-4">
            <div className="w-64">
              <SearchSelect
                label="Cabang Studio"
                value={selectedBranchId}
                onChange={(val) => setSelectedBranchId(val)}
                options={branches.map((b) => ({ id: b.id, label: `${b.code} - ${b.name}` }))}
                placeholder="Pilih Cabang..."
              />
            </div>

            <label className="grid gap-1 text-[13px] font-bold text-dd-muted">
              Dari tanggal
              <input
                type="date"
                value={reportRange.from}
                max={reportRange.until || undefined}
                onChange={(e) => setReportRange((range) => ({ ...range, from: e.target.value }))}
                className="rounded-dd-sm border border-dd-line bg-dd-surface px-3 py-2 text-sm text-dd-ink outline-none transition focus:border-dd-forest focus:ring-2 focus:ring-dd-forest/15"
              />
            </label>
            <label className="grid gap-1 text-[13px] font-bold text-dd-muted">
              Sampai tanggal
              <input
                type="date"
                value={reportRange.until}
                min={reportRange.from || undefined}
                onChange={(e) => setReportRange((range) => ({ ...range, until: e.target.value }))}
                className="rounded-dd-sm border border-dd-line bg-dd-surface px-3 py-2 text-sm text-dd-ink outline-none transition focus:border-dd-forest focus:ring-2 focus:ring-dd-forest/15"
              />
            </label>

            <div className="flex flex-wrap gap-2" role="group" aria-label="Rentang cepat">
              {RANGE_PRESETS.map((preset) => (
                <Button
                  key={preset.id}
                  variant="secondary"
                  onClick={() => setReportRange(presetRange(preset.id))}
                >
                  {preset.label}
                </Button>
              ))}
            </div>
          </Panel>

          {/* SUB-TABS 5 LAPORAN */}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setReportTab('PROFIT')}
              className={`flex items-center gap-2 rounded-dd-sm px-4 py-2 text-sm font-semibold transition-colors ${
                reportTab === 'PROFIT'
                  ? 'bg-dd-forest text-white shadow-dd-soft'
                  : 'text-dd-muted hover:bg-dd-surface-muted hover:text-dd-ink'
              }`}
            >
              <PieChart className="h-4 w-4" />
              1. Laba Bersih
            </button>

            <button
              type="button"
              onClick={() => setReportTab('OMSET')}
              className={`flex items-center gap-2 rounded-dd-sm px-4 py-2 text-sm font-semibold transition-colors ${
                reportTab === 'OMSET'
                  ? 'bg-dd-forest text-white shadow-dd-soft'
                  : 'text-dd-muted hover:bg-dd-surface-muted hover:text-dd-ink'
              }`}
            >
              <TrendingUp className="h-4 w-4" />
              2. Omset Penjualan
            </button>

            <button
              type="button"
              onClick={() => setReportTab('INSTRUCTOR_REALTIME')}
              className={`flex items-center gap-2 rounded-dd-sm px-4 py-2 text-sm font-semibold transition-colors ${
                reportTab === 'INSTRUCTOR_REALTIME'
                  ? 'bg-dd-forest text-white shadow-dd-soft'
                  : 'text-dd-muted hover:bg-dd-surface-muted hover:text-dd-ink'
              }`}
            >
              <Users className="h-4 w-4" />
              3. Biaya Instruktur Aktual
            </button>

            <button
              type="button"
              onClick={() => setReportTab('OTHER_COST')}
              className={`flex items-center gap-2 rounded-dd-sm px-4 py-2 text-sm font-semibold transition-colors ${
                reportTab === 'OTHER_COST'
                  ? 'bg-dd-forest text-white shadow-dd-soft'
                  : 'text-dd-muted hover:bg-dd-surface-muted hover:text-dd-ink'
              }`}
            >
              <DollarSign className="h-4 w-4" />
              4. Biaya Operasional Lain
            </button>
          </div>

          {/* TAB 1: LABA BERSIH */}
          {reportTab === 'PROFIT' && profitData && (
            <div className="space-y-6">
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <StatCard
                  label="Total Omset Penjualan"
                  value={formatRupiah(profitData.omsetRp)}
                  tone="success"
                />
                <StatCard
                  label="Modal Sesi Terjual"
                  value={formatRupiah(profitData.modalSesiRp ?? 0)}
                  helper={`${profitData.sesiTerjual ?? 0} sesi x modal per sesi`}
                  tone="neutral"
                />
                <StatCard
                  label="Laba Kotor (Gross Profit)"
                  value={formatRupiah(profitData.grossProfitRp)}
                  helper={`Margin ${profitData.grossMarginPercent ?? 0}%`}
                  tone="success"
                />
                <StatCard
                  label="Laba Bersih Aktual"
                  value={formatRupiah(profitData.netProfitRealtimeRp)}
                  helper={`Margin ${profitData.netMarginPercent ?? (profitData.omsetRp > 0 ? Math.round((profitData.netProfitRealtimeRp / profitData.omsetRp) * 1000) / 10 : 0)}%`}
                  tone={profitData.netProfitRealtimeRp >= 0 ? 'success' : 'danger'}
                />
              </div>

              <div className="grid gap-6">
                <Panel className="space-y-4 p-5">
                  <div className="flex items-center justify-between border-b border-dd-line/60 pb-3">
                    <h3 className="text-base font-semibold">Laporan Laba Rugi Berjenjang (P&L)</h3>
                    <Badge tone={profitData.netProfitRealtimeRp >= 0 ? 'success' : 'danger'}>
                      Margin Bersih: {profitData.netMarginPercent ?? 0}%
                    </Badge>
                  </div>
                  <div className="space-y-3 divide-y divide-dd-line text-sm">
                    <div className="flex justify-between pt-2">
                      <span className="text-dd-muted">Omzet Penjualan Bersih ({formatDay(profitData.from)} – {formatDay(profitData.until)}):</span>
                      <span className="font-semibold">{formatRupiah(profitData.omsetRp)}</span>
                    </div>
                    <div className="flex justify-between pt-2 text-dd-warning">
                      <span>(-) Modal Sesi ({profitData.sesiTerjual ?? 0} sesi terjual x modal per sesi):</span>
                      <span className="font-semibold">
                        - {formatRupiah(profitData.modalSesiRp ?? 0)}
                      </span>
                    </div>
                    <div className="flex justify-between pt-2 font-medium bg-dd-forest/5 px-2 py-1.5 rounded-dd-sm">
                      <span className="text-dd-forest">(=) Laba Kotor (Gross Profit):</span>
                      <span className="font-bold text-dd-forest">
                        {formatRupiah(profitData.grossProfitRp)}
                        <span className="ml-1.5 text-xs text-dd-forest/80">({profitData.grossMarginPercent ?? 0}%)</span>
                      </span>
                    </div>
                    <div className="flex justify-between pt-2 text-dd-danger">
                      <span>(-) Beban Operasional Lain:</span>
                      <span className="font-semibold">
                        - {formatRupiah(profitData.otherCostRp)}
                      </span>
                    </div>
                    <div className="flex justify-between pt-2 font-medium bg-dd-surface-muted/50 px-2 py-1.5 rounded-dd-sm">
                      <span className="text-dd-ink">(=) Laba Bersih Operasional:</span>
                      <span className="font-bold text-dd-forest">
                        {formatRupiah(profitData.netProfitRealtimeRp)}
                        <span className="ml-1.5 text-xs text-dd-muted">({profitData.netMarginPercent ?? 0}%)</span>
                      </span>
                    </div>
                    <p className="m-0 pt-3 text-dd-muted">
                      Honor instruktur yang dibayar periode ini {formatRupiah(profitData.costRealtimeRp)}{' '}
                      (kelas ter-scan QR, tab 3) tidak mengurangi laba di atas.
                      {(profitData.sesiTanpaModal ?? 0) > 0 &&
                        ` ${profitData.sesiTanpaModal} sesi belum punya modal per sesi dan dihitung Rp0; atur di Master Data.`}
                    </p>
                  </div>
                </Panel>
              </div>
            </div>
          )}

          {/* TAB 2: OMSET */}
          {reportTab === 'OMSET' && omsetData && (
            <div className="space-y-6">
              <div className="grid gap-4 sm:grid-cols-3">
                <StatCard
                  label="Total Omset Paket PAID"
                  value={formatRupiah(omsetData.totalOmsetRp)}
                  tone="success"
                />
                <StatCard
                  label="Jumlah Transaksi Terbayar"
                  value={`${omsetData.totalTransactionCount} Transaksi`}
                  tone="neutral"
                />
                <StatCard
                  label="Rata-rata Transaksi"
                  value={
                    omsetData.totalTransactionCount > 0
                      ? formatRupiah(
                          Math.round(omsetData.totalOmsetRp / omsetData.totalTransactionCount),
                        )
                      : 'Rp 0'
                  }
                  tone="neutral"
                />
              </div>

              <Panel className="p-5 space-y-4">
                <h3 className="text-sm font-bold text-dd-muted">
                  Distribusi Metode Pembayaran
                </h3>
                <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-4">
                  {Object.entries(omsetData.byPaymentMethod).map(([method, val]) => (
                    <div key={method} className="rounded-dd-md border border-dd-line p-3">
                      <span className="text-[13px] font-bold text-dd-muted">{method}</span>
                      <p className="mt-1 text-base font-semibold">{formatRupiah(val.amountRp)}</p>
                      <p className="text-xs text-dd-muted">{val.count} pembayaran</p>
                    </div>
                  ))}
                </div>
              </Panel>

              <Panel className="space-y-4 p-5">
                <h3 className="text-base font-semibold">Daftar Transaksi Pembelian Paket</h3>
                {omsetData.transactions.length === 0 ? (
                  <AdminEmptyState
                    title="Tidak Ada Transaksi"
                    description="Belum ada transaksi paket terbayar (PAID) pada rentang tanggal ini."
                  />
                ) : (
                  <DataTable<OmsetTransaction>
                    items={omsetData.transactions}
                    rowKey={(t) => t.id}
                    mobileCard={(t) => (
                      <div className="space-y-1 text-xs">
                        <div className="flex items-center justify-between">
                          <span className="font-mono text-dd-muted">{t.orderNumber}</span>
                          <span className="font-semibold text-dd-success">{formatRupiah(t.totalAmountRp)}</span>
                        </div>
                        <div className="font-medium text-dd-ink text-sm">{t.customerName}</div>
                        <div className="text-dd-muted">{t.packageName} · {t.paymentMethod}</div>
                        <div className="text-[11px] text-dd-muted">{new Date(t.paidAt).toLocaleDateString('id-ID')}</div>
                      </div>
                    )}
                    columns={[
                      { id: 'orderNumber', header: 'Nomor Invoice', cell: (t) => t.orderNumber },
                      { id: 'customerName', header: 'Pelanggan', cell: (t) => t.customerName },
                      { id: 'packageName', header: 'Paket', cell: (t) => t.packageName },
                      {
                        id: 'totalAmountRp',
                        header: 'Total Nominal',
                        cell: (t) => (
                          <span className="font-semibold text-dd-success">
                            {formatRupiah(t.totalAmountRp)}
                          </span>
                        ),
                      },
                      { id: 'paymentMethod', header: 'Metode', cell: (t) => t.paymentMethod },
                      {
                        id: 'paidAt',
                        header: 'Waktu Bayar',
                        cell: (t) => new Date(t.paidAt).toLocaleDateString('id-ID'),
                      },
                    ]}
                  />
                )}
              </Panel>
            </div>
          )}

          {/* TAB 3: COST INSTRUKTUR REALTIME */}
          {reportTab === 'INSTRUCTOR_REALTIME' && instructorRealtimeData && (
            <div className="space-y-6">
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <StatCard
                  label="Total Beban Instruktur Aktual"
                  value={formatRupiah(instructorRealtimeData.totalInstructorCostRp)}
                  tone="success"
                />
                <StatCard
                  label="Belum Terverifikasi Presensi"
                  value={formatRupiah(instructorRealtimeData.totalUnverifiedFeeRp)}
                  helper={`${instructorRealtimeData.unverifiedClassCount} kelas`}
                  tone={instructorRealtimeData.unverifiedClassCount > 0 ? 'warning' : 'neutral'}
                />
                <StatCard
                  label="Total Jam Mengajar Aktual"
                  value={`${instructorRealtimeData.totalTeachingHours} Jam`}
                  tone="neutral"
                />
                <StatCard
                  label="Jumlah Instruktur Aktif"
                  value={`${instructorRealtimeData.instructorCount} Orang`}
                  tone="neutral"
                />
              </div>

              <Panel className="space-y-4 p-5">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-dd-line/60 pb-3">
                  <div>
                    <h3 className="text-base font-semibold">
                      {instructorViewMode === 'SUMMARY'
                        ? 'Rekapitulasi Biaya per Instruktur'
                        : 'Audit Detail Presensi & Honor per Sesi Kelas'}
                    </h3>
                    <p className="text-xs text-dd-muted">
                      {instructorViewMode === 'SUMMARY'
                        ? 'Ringkasan jam mengajar, tarif kategori, dan status verifikasi presensi per instruktur.'
                        : 'Daftar audit seluruh kelas selesai dengan verifikasi QR, lokasi geofence/GPS, dan honor modal.'}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 rounded-dd-md border border-dd-line bg-dd-surface-muted/40 p-1">
                    <button
                      type="button"
                      onClick={() => setInstructorViewMode('SUMMARY')}
                      className={`rounded-dd-sm px-3 py-1.5 text-xs font-semibold transition ${
                        instructorViewMode === 'SUMMARY'
                          ? 'bg-white text-dd-forest shadow-xs'
                          : 'text-dd-muted hover:text-dd-ink'
                      }`}
                    >
                      Rekap Instruktur ({instructorRealtimeData.instructors.length})
                    </button>
                    <button
                      type="button"
                      onClick={() => setInstructorViewMode('SESSIONS')}
                      className={`rounded-dd-sm px-3 py-1.5 text-xs font-semibold transition ${
                        instructorViewMode === 'SESSIONS'
                          ? 'bg-white text-dd-forest shadow-xs'
                          : 'text-dd-muted hover:text-dd-ink'
                      }`}
                    >
                      Rincian per Sesi ({instructorRealtimeData.sessions?.length ?? 0})
                    </button>
                  </div>
                </div>

                {instructorRealtimeData.unverifiedClassCount > 0 && (
                  <Feedback kind="warning">
                    {instructorRealtimeData.unverifiedClassCount} kelas senilai{' '}
                    {formatRupiah(instructorRealtimeData.totalUnverifiedFeeRp)} belum punya presensi
                    instruktur. Verifikasi dari detail kelas di menu Kelas sebelum honor dibayarkan.
                  </Feedback>
                )}

                {instructorViewMode === 'SUMMARY' ? (
                  instructorRealtimeData.instructors.length === 0 ? (
                    <AdminEmptyState
                      title="Belum Ada Aktivitas Kelas"
                      description="Tidak ada slot kelas berstatus COMPLETED pada rentang tanggal ini."
                    />
                  ) : (
                    <DataTable<InstructorCostBreakdown>
                      items={instructorRealtimeData.instructors}
                      rowKey={(r) => r.instructorId}
                      mobileCard={(r) => (
                        <div className="space-y-1.5 text-xs">
                          <div className="flex items-center justify-between">
                            <span className="font-bold text-sm text-dd-ink">{r.instructorName}</span>
                            <span className="font-bold text-sm text-dd-forest">{formatRupiah(r.totalFeeRp)}</span>
                          </div>
                          <div className="grid grid-cols-3 gap-1 py-1 text-[11px] text-dd-muted border-y border-dd-line/40">
                            <div>Group: {r.groupHours}j ({formatRupiah(r.groupFeeRp)})</div>
                            <div>Semi: {r.semiPrivateHours}j ({formatRupiah(r.semiPrivateFeeRp)})</div>
                            <div>Priv: {r.privateHours}j ({formatRupiah(r.privateFeeRp)})</div>
                          </div>
                          <div className="flex items-center justify-between text-dd-muted">
                            <span>Total durasi: <strong>{r.totalHours} jam</strong></span>
                            {r.unverifiedClassCount > 0 && (
                              <Badge tone="warning">{r.unverifiedClassCount} kelas belum verifikasi</Badge>
                            )}
                          </div>
                        </div>
                      )}
                      columns={[
                        {
                          id: 'instructorName',
                          header: 'Nama Instruktur',
                          cell: (r) => <span className="font-bold">{r.instructorName}</span>,
                        },
                        {
                          id: 'groupFeeRp',
                          header: 'Group Class',
                          cell: (r) => (
                            <div>
                              <span>{formatRupiah(r.groupFeeRp)}</span>
                              <span className="block text-xs text-dd-muted">({r.groupHours} jam)</span>
                            </div>
                          ),
                        },
                        {
                          id: 'semiPrivateFeeRp',
                          header: 'Semi Private',
                          cell: (r) => (
                            <div>
                              <span>{formatRupiah(r.semiPrivateFeeRp)}</span>
                              <span className="block text-xs text-dd-muted">
                                ({r.semiPrivateHours} jam)
                              </span>
                            </div>
                          ),
                        },
                        {
                          id: 'privateFeeRp',
                          header: 'Private Class',
                          cell: (r) => (
                            <div>
                              <span>{formatRupiah(r.privateFeeRp)}</span>
                              <span className="block text-xs text-dd-muted">
                                ({r.privateHours} jam)
                              </span>
                            </div>
                          ),
                        },
                        {
                          id: 'totalFeeRp',
                          header: 'Total Honorarium',
                          cell: (r) => (
                            <div>
                              <span className="font-bold text-dd-forest">
                                {formatRupiah(r.totalFeeRp)}
                              </span>
                              <span className="block text-xs font-semibold text-dd-muted">
                                {r.totalHours} jam total
                              </span>
                              {r.unverifiedClassCount > 0 && (
                                <span className="mt-1 block">
                                  <Badge tone="warning">
                                    {r.unverifiedClassCount} kelas belum terverifikasi
                                  </Badge>
                                </span>
                              )}
                            </div>
                          ),
                        },
                      ]}
                    />
                  )
                ) : (
                  (instructorRealtimeData.sessions?.length ?? 0) === 0 ? (
                    <AdminEmptyState
                      title="Belum Ada Sesi Kelas"
                      description="Tidak ada slot kelas berstatus COMPLETED pada rentang tanggal ini."
                    />
                  ) : (
                    <DataTable<InstructorSessionItem>
                      items={instructorRealtimeData.sessions ?? []}
                      rowKey={(s) => s.slotId}
                      mobileCard={(s) => (
                        <div className="space-y-1.5 text-xs">
                          <div className="flex items-center justify-between">
                            <div>
                              <strong className="block text-sm text-dd-ink">{s.classTypeName}</strong>
                              <span className="text-xs text-dd-muted">{s.instructorName} · {s.branchName}</span>
                            </div>
                            <div className="text-right">
                              <strong className="block text-sm text-dd-forest">{formatRupiah(s.feeRp)}</strong>
                              {s.isManualFee ? (
                                <Badge tone="warning">Manual Flat</Badge>
                              ) : (
                                <span className="text-[11px] text-dd-muted">{formatRupiah(s.feePerJamRp)}/j</span>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center justify-between text-[11px] text-dd-muted pt-1 border-t border-dd-line/40">
                            <span>
                              {formatTanggalSingkat(s.startAt)} ·{' '}
                              {new Date(s.startAt).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })} -{' '}
                              {new Date(s.endAt).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })} ({s.teachingHours} jam)
                            </span>
                            <Badge tone={s.attendanceVerified ? 'success' : 'warning'}>
                              {s.attendanceVerified ? 'Terverifikasi' : 'Belum Verifikasi'}
                            </Badge>
                          </div>
                        </div>
                      )}
                      columns={[
                        {
                          id: 'time',
                          header: 'Waktu Kelas',
                          cell: (s) => (
                            <div>
                              <strong className="block text-xs font-semibold text-dd-ink">
                                {new Date(s.startAt).toLocaleDateString('id-ID', {
                                  day: 'numeric',
                                  month: 'short',
                                  year: 'numeric',
                                })}
                              </strong>
                              <span className="text-xs text-dd-muted">
                                {new Date(s.startAt).toLocaleTimeString('id-ID', {
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })}{' '}
                                -{' '}
                                {new Date(s.endAt).toLocaleTimeString('id-ID', {
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })}{' '}
                                ({s.teachingHours} jam)
                              </span>
                            </div>
                          ),
                        },
                        {
                          id: 'classType',
                          header: 'Jenis Kelas & Cabang',
                          cell: (s) => (
                            <div>
                              <span className="font-semibold text-dd-ink">{s.classTypeName}</span>
                              <span className="block text-xs text-dd-muted">{s.branchName}</span>
                            </div>
                          ),
                        },
                        {
                          id: 'instructor',
                          header: 'Instruktur',
                          cell: (s) => <span className="font-medium text-dd-ink">{s.instructorName}</span>,
                        },
                        {
                          id: 'fee',
                          header: 'Honor Sesi (Modal)',
                          cell: (s) => (
                            <div>
                              <span className="font-bold text-dd-forest">{formatRupiah(s.feeRp)}</span>
                              {s.isManualFee ? (
                                <span className="ml-1.5 inline-block text-[10px]">
                                  <Badge tone="warning">Manual Flat</Badge>
                                </span>
                              ) : (
                                <span className="block text-xs text-dd-muted">
                                  {formatRupiah(s.feePerJamRp)}/jam
                                </span>
                              )}
                            </div>
                          ),
                        },
                        {
                          id: 'attendance',
                          header: 'Status Presensi & Geofence',
                          cell: (s) => (
                            <div className="space-y-1">
                              {s.attendanceVerified ? (
                                <>
                                  <div className="flex flex-wrap items-center gap-1.5">
                                    <Badge tone="success">Terverifikasi QR</Badge>
                                    {s.distanceMeters !== null && (
                                      <Badge tone={s.isWithinGeofence ? 'success' : 'warning'}>
                                        {s.isWithinGeofence ? 'Dalam Area' : 'Di Luar Area'} ({s.distanceMeters}m)
                                      </Badge>
                                    )}
                                  </div>
                                  {s.attendanceTime && (
                                    <span className="block text-[11px] text-dd-muted">
                                      Scan:{' '}
                                      {new Date(s.attendanceTime).toLocaleTimeString('id-ID', {
                                        hour: '2-digit',
                                        minute: '2-digit',
                                      })}
                                    </span>
                                  )}
                                </>
                              ) : (
                                <Badge tone="danger">Belum Presensi</Badge>
                              )}
                            </div>
                          ),
                        },
                      ]}
                    />
                  )
                )}
              </Panel>
            </div>
          )}



          {/* TAB 5: OTHER COST */}
          {reportTab === 'OTHER_COST' && otherCostData && (
            <div className="space-y-6">
              <div className="grid gap-4 sm:grid-cols-3">
                <StatCard
                  label="Total Biaya Operasional"
                  value={formatRupiah(otherCostData.totalOtherCostRp)}
                  tone="danger"
                />
                <StatCard
                  label="Jumlah Pengeluaran"
                  value={`${otherCostData.items.length} Item`}
                  tone="neutral"
                />
                <StatCard
                  label="Rentang Tanggal"
                  value={`${formatDay(otherCostData.from ?? reportRange.from)} – ${formatDay(otherCostData.until ?? reportRange.until)}`}
                  tone="neutral"
                />
              </div>

              {canManageCosts && selectedBranchId && (
                <OtherCostForm
                  client={client}
                  branchId={selectedBranchId}
                  onCreated={() => void loadReports()}
                />
              )}

              <Panel className="p-5 space-y-3">
                <h3 className="text-sm font-bold text-dd-muted">
                  Distribusi Kategori Beban
                </h3>
                <div className="grid gap-4 sm:grid-cols-3 md:grid-cols-6">
                  {Object.entries(otherCostData.byCategory).map(([cat, val]) => (
                    <div key={cat} className="rounded-dd-md border border-dd-line p-3">
                      <span className="text-[13px] font-bold text-dd-muted">{cat}</span>
                      <p className="mt-1 text-sm font-semibold">{formatRupiah(val.amountRp)}</p>
                      <p className="text-xs text-dd-muted">{val.count} transaksi</p>
                    </div>
                  ))}
                </div>
              </Panel>

              <Panel className="space-y-4 p-5">
                <h3 className="text-base font-semibold">Daftar Pengeluaran Operasional</h3>
                {otherCostData.items.length === 0 ? (
                  <AdminEmptyState
                    title="Belum Ada Biaya Operasional"
                    description="Belum ada biaya operasional pada rentang tanggal ini."
                  />
                ) : (
                  <DataTable<OtherCostItem>
                    items={otherCostData.items}
                    rowKey={(c) => c.id}
                    mobileCard={(c) => (
                      <div className="space-y-1.5 text-xs">
                        <div className="flex items-center justify-between">
                          <Badge tone="neutral">{c.category}</Badge>
                          <span className="font-bold text-sm text-dd-danger">{formatRupiah(c.amountRp)}</span>
                        </div>
                        <div className="font-medium text-dd-ink">{c.description}</div>
                        <div className="flex items-center justify-between text-[11px] text-dd-muted pt-1 border-t border-dd-line/40">
                          <span>{formatDay(c.incurredOn)} · {c.createdByName}</span>
                          <div className="flex gap-2">
                            {canManageCosts && client.updateOtherCost && (
                              <button
                                type="button"
                                className="text-dd-forest font-semibold hover:underline"
                                onClick={() => setEditingCost(c)}
                              >
                                Ubah
                              </button>
                            )}
                            <button
                              type="button"
                              className="text-dd-danger font-semibold hover:underline flex items-center gap-0.5"
                              onClick={() => setCostToDelete(c)}
                            >
                              Hapus
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                    columns={[
                      { id: 'incurredOn', header: 'Tanggal', cell: (c) => formatDay(c.incurredOn) },
                      { id: 'category', header: 'Kategori', cell: (c) => c.category },
                      { id: 'description', header: 'Deskripsi', cell: (c) => c.description },
                      {
                        id: 'amountRp',
                        header: 'Nominal',
                        cell: (c) => (
                          <span className="font-semibold text-dd-danger">
                            {formatRupiah(c.amountRp)}
                          </span>
                        ),
                      },
                      { id: 'createdByName', header: 'Dicatat Oleh', cell: (c) => c.createdByName },
                      {
                        id: 'id',
                        header: 'Aksi',
                        cell: (c) => (
                          <div className="flex flex-wrap gap-1">
                            {canManageCosts && client.updateOtherCost && (
                              <Button variant="ghost" onClick={() => setEditingCost(c)}>
                                Ubah
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              leadingIcon={<Trash2 className="h-4 w-4 text-dd-danger" />}
                              onClick={() => setCostToDelete(c)}
                            >
                              Hapus
                            </Button>
                          </div>
                        ),
                      },
                    ]}
                  />
                )}
              </Panel>
            </div>
          )}
        </div>
      )}

      {/* ========================================================================= */}
      {/* SECTION: REKONSILIASI TRANSAKSI & ANOMALI (LEGACY VIEW)                   */}
      {/* ========================================================================= */}
      {mainTab === 'RECONCILIATION' && (
        <div className="space-y-6">
          <Panel className="flex flex-col gap-4 p-5 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="text-xl font-semibold">Rekonsiliasi transaksi</h2>
              <p className="text-sm text-dd-muted">
                Ringkasan pembayaran pesanan yang diharapkan dan yang diterima per periode.
              </p>
            </div>
            <FilterBar>
              <div className="flex flex-wrap gap-3">
                <label className="grid gap-1 text-xs font-bold text-dd-muted">
                  Dari tanggal
                  <input
                    className="rounded-dd-sm border border-dd-line bg-dd-surface px-3 py-2 text-sm text-dd-ink outline-none transition focus:border-dd-forest focus:ring-2 focus:ring-dd-forest/15"
                    type="date"
                    value={from}
                    onChange={(event) => setFrom(event.target.value)}
                  />
                </label>
                <label className="grid gap-1 text-xs font-bold text-dd-muted">
                  Sampai tanggal
                  <input
                    className="rounded-dd-sm border border-dd-line bg-dd-surface px-3 py-2 text-sm text-dd-ink outline-none transition focus:border-dd-forest focus:ring-2 focus:ring-dd-forest/15"
                    type="date"
                    value={until}
                    onChange={(event) => setUntil(event.target.value)}
                  />
                </label>
              </div>
            </FilterBar>
          </Panel>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <StatCard
              label="Ekspektasi Pembayaran"
              value={formatRupiah(metrics?.expectedRp ?? 0)}
              tone="neutral"
            />
            <StatCard
              label="Diterima Rekening"
              value={formatRupiah(metrics?.receivedRp ?? 0)}
              tone="neutral"
            />
            <StatCard
              label="Disetujui Manual / Gateway"
              value={formatRupiah(metrics?.approvedRp ?? 0)}
              tone="success"
            />
          </div>

          {/* Anomali Table: tampil hanya jika ada hasil pemeriksaan */}
          {((reconData?.anomalies.items.length ?? 0) > 0 || anomalyCursorHistory.length > 0) && (
          <Panel className="space-y-4 p-5">
            <h3 className="text-base font-semibold">Deteksi Anomali Rekonsiliasi</h3>
            <DataTable
              rowNumberOffset={pageOffset(anomalyCursorHistory.length)}
              items={reconData?.anomalies.items ?? []}
              loading={reconLoading}
              rowKey={(item) => item.purchaseId}
              emptyTitle="Tidak Ada Anomali Rekonsiliasi"
              emptyDescription="Semua transaksi pembayaran pada periode ini telah terverifikasi."
              mobileCard={(item: any) => (
                <div className="space-y-1 text-xs">
                  <div className="flex items-center justify-between">
                    <Badge tone={item.severity === 'ERROR' ? 'danger' : 'warning'}>
                      {formatSeverity(item.severity)}
                    </Badge>
                    <span className="font-bold text-dd-ink">{formatRupiah(item.amountRp)}</span>
                  </div>
                  <div className="font-semibold text-dd-ink">
                    {formatAnomalyType(item.code)}
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-dd-muted pt-1 border-t border-dd-line/40">
                    <span>{branches.find((b) => b.code === item.branchCode)?.name || formatStudioName(item.branchCode, 'short')} · {new Date(item.submittedAt).toLocaleDateString('id-ID')}</span>
                    <Link href={item.href || '#'} className="font-semibold text-dd-forest hover:underline">
                      Buka Pembayaran →
                    </Link>
                  </div>
                </div>
              )}
              columns={[
                {
                  id: 'branch',
                  header: 'Studio/Cabang',
                  cell: (item: any) =>
                    branches.find((b) => b.code === item.branchCode)?.name || formatStudioName(item.branchCode, 'short'),
                },
                {
                  id: 'severity',
                  header: 'Tingkat Urgensi',
                  cell: (item: any) => (
                    <Badge tone={item.severity === 'ERROR' ? 'danger' : 'warning'}>
                      {formatSeverity(item.severity)}
                    </Badge>
                  ),
                },
                {
                  id: 'code',
                  header: 'Jenis Anomali',
                  cell: (item: any) => (
                    <span className="text-xs font-medium text-dd-ink">
                      {formatAnomalyType(item.code)}
                    </span>
                  ),
                },
                {
                  id: 'amount',
                  header: 'Nominal',
                  cell: (item: any) => formatRupiah(item.amountRp),
                },
                {
                  id: 'date',
                  header: 'Waktu Submit',
                  cell: (item: any) =>
                    new Date(item.submittedAt).toLocaleDateString('id-ID'),
                },
                {
                  id: 'action',
                  header: 'Aksi',
                  cell: (item: any) => (
                    <Link
                      href={item.href || '#'}
                      className="text-xs font-semibold text-dd-forest hover:underline"
                    >
                      Buka Pembayaran
                    </Link>
                  ),
                },
              ]}
            />
            {reconData && (
              <div className="border-t border-dd-line p-4">
                <Pagination
                  hasPrevious={anomalyCursorHistory.length > 0 && !reconLoading}
                  hasNext={Boolean(reconData.anomalies.page.nextCursor) && !reconLoading}
                  currentPage={anomalyCursorHistory.length + 1}
                  onPrevious={() => {
                    const previous = anomalyCursorHistory.at(-1) ?? '';
                    void loadAnomalyPage(previous || undefined).then((loaded) => {
                      if (loaded) setAnomalyCursorHistory((current) => current.slice(0, -1));
                    });
                  }}
                  onNext={() => {
                    const next = reconData.anomalies.page.nextCursor;
                    if (!next) return;
                    void loadAnomalyPage(next).then((loaded) => {
                      if (loaded)
                        setAnomalyCursorHistory((current) => [...current, anomalyCursor ?? '']);
                    });
                  }}
                />
              </div>
            )}
          </Panel>
          )}

          {/* Arus kas lama: tampil hanya jika ada datanya */}
          {((reconData?.legacyCashflow.items.length ?? 0) > 0 || legacyCursorHistory.length > 0) && (
          <Panel className="space-y-4 p-5">
            <h3 className="text-base font-semibold">Entri arus kas lama (v1)</h3>
            <DataTable
              rowNumberOffset={pageOffset(legacyCursorHistory.length)}
              items={reconData?.legacyCashflow.items ?? []}
              loading={reconLoading}
              rowKey={(item) => item.id}
              emptyTitle="Arus kas lama (v1) belum terhubung"
              emptyDescription="Belum ada data v1 yang dapat ditampilkan."
              mobileCard={(item: any) => (
                <div className="space-y-1 text-xs">
                  <div className="flex items-center justify-between">
                    <Badge tone={item.type === 'INCOME' ? 'success' : 'warning'}>
                      {item.type === 'INCOME' ? 'Income' : 'Expense'}
                    </Badge>
                    <span className="font-bold text-sm text-dd-ink">{formatRupiah(item.amountRp)}</span>
                  </div>
                  <div className="font-medium text-dd-ink">{item.description ?? '—'}</div>
                  <div className="text-[11px] text-dd-muted pt-1 border-t border-dd-line/40">
                    {item.branch?.name ?? 'Global'} · {new Date(item.occurredAt).toLocaleDateString('id-ID')}
                  </div>
                </div>
              )}
              columns={[
                {
                  id: 'date',
                  header: 'Tanggal',
                  cell: (item) => new Date(item.occurredAt).toLocaleDateString('id-ID'),
                },
                {
                  id: 'type',
                  header: 'Tipe',
                  cell: (item) => (
                    <Badge tone={item.type === 'INCOME' ? 'success' : 'warning'}>
                      {item.type === 'INCOME' ? 'Income' : 'Expense'}
                    </Badge>
                  ),
                },
                {
                  id: 'description',
                  header: 'Deskripsi',
                  cell: (item) => item.description ?? '—',
                },
                {
                  id: 'branch',
                  header: 'Studio/Cabang',
                  cell: (item) => item.branch?.name ?? 'Global',
                },
                { id: 'amount', header: 'Nominal', cell: (item) => formatRupiah(item.amountRp) },
              ]}
            />
            {reconData && (
              <div className="border-t border-dd-line p-4">
                <Pagination
                  previousAriaLabel="Arus kas lama (v1) sebelumnya"
                  nextAriaLabel="Arus kas lama (v1) berikutnya"
                  hasPrevious={legacyCursorHistory.length > 0 && !reconLoading}
                  hasNext={Boolean(reconData.legacyCashflow.page.nextCursor) && !reconLoading}
                  currentPage={legacyCursorHistory.length + 1}
                  onPrevious={() => {
                    const previous = legacyCursorHistory.at(-1) ?? '';
                    void loadLegacyPage(previous || undefined).then((loaded) => {
                      if (loaded) setLegacyCursorHistory((current) => current.slice(0, -1));
                    });
                  }}
                  onNext={() => {
                    const next = reconData.legacyCashflow.page.nextCursor;
                    if (!next) return;
                    void loadLegacyPage(next).then((loaded) => {
                      if (loaded) setLegacyCursorHistory((current) => [...current, legacyCursor ?? '']);
                    });
                  }}
                />
              </div>
            )}
          </Panel>
          )}
        </div>
      )}
      <ReasonDialog
        open={Boolean(costToDelete)}
        title="Hapus biaya operasional?"
        description={
          costToDelete
            ? `${costToDelete.category} · ${costToDelete.description}. Biaya ini dihapus permanen dan tidak dapat dipulihkan.`
            : undefined
        }
        confirmLabel="Hapus biaya"
        tone="danger"
        maxLength={500}
        onCancel={() => setCostToDelete(null)}
        onConfirm={(reason) => {
          const cost = costToDelete;
          if (!cost) return;
          setCostToDelete(null);
          void (async () => {
            try {
              await client.deleteOtherCost?.(cost.id, reason);
              void loadReports();
            } catch (error) {
              feedback.showToast({
                tone: 'danger',
                title: 'Biaya belum dapat dihapus',
                message: financeFailureMessage(error),
              });
            }
          })();
        }}
      />
      <OtherCostEditDialog
        cost={editingCost}
        onSave={(id, input) => client.updateOtherCost?.(id, input) ?? Promise.resolve()}
        onClose={() => setEditingCost(null)}
        onSaved={() => void loadReports()}
      />
    </div>
  );
}
