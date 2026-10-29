import { appLoading } from '../components/app-loading';

/** Dua ringkasan dashboard: keuangan dan operasional; satu peran bisa melihat keduanya. */
export interface DashboardViews {
  finance: boolean;
  operations: boolean;
}

export interface DashboardMetric {
  key: string;
  label: string;
  value: number;
  unit: 'IDR' | 'COUNT' | string;
  changePercent: number | null;
}

export interface DashboardQueueSummary {
  key: string;
  label: string;
  count: number;
  href: string;
}

export interface DashboardTrendPoint {
  date: Date;
  revenue: number;
  profit: number;
  bookings: number;
}

export interface DashboardOverviewPeriod {
  from: Date | string;
  until: Date | string;
  previousFrom?: Date | string;
  previousUntil?: Date | string;
}

export interface OmsetSourceItem {
  key: string;
  label: string;
  count: number;
  totalRp: number;
  percentage: number;
}

export interface ProfitBreakdownDetails {
  grossSalesRp: number;
  discountRp: number;
  netRevenueRp: number;
  instructorCostRp: number;
  /** Sesi terjual x modal per sesi; dasar laba. */
  modalSesiRp?: number;
  grossProfitRp: number;
  grossMarginPercent: number;
  otherCostRp: number;
  netOperatingProfitRp: number;
  netMarginPercent: number;
}

export interface DashboardFinancialSummary {
  grossSalesRp: number;
  discountRp?: number;
  packagePromotionDiscountRp?: number;
  voucherDiscountRp?: number;
  revenueRp: number;
  instructorRealtimeRp: number;
  modalSesiRp?: number;
  otherCostRp: number;
  grossProfitRp?: number;
  grossMarginPercent?: number;
  profitRp: number;
  netMarginPercent?: number;
  completeness: 'COMPLETE' | 'INCOMPLETE' | 'ESTIMATED' | string;
  /** Ada kelas selesai tetapi tarif honor instruktur belum diisi (biaya instruktur tampil Rp 0). */
  instructorFeeMissing?: boolean;
  anomalyCount: number;
  sourceCutoffAt: Date | string;
  controlHash: string;
  realizedRevenueRp?: number;
  projectedRevenueRp?: number;
  netProfitRp?: number;
  pendingRefundsRp?: number;
  omsetBreakdown?: {
    byPackage: OmsetSourceItem[];
    byPaymentMethod: OmsetSourceItem[];
    byClassType: OmsetSourceItem[];
  };
  profitBreakdown?: ProfitBreakdownDetails;
}

export interface DashboardBranchPerformance {
  id: string;
  code: string;
  name: string;
  grossSalesRp: number;
  revenueRp: number;
  instructorRealtimeRp: number;
  modalSesiRp?: number;
  otherCostRp: number;
  grossProfitRp?: number;
  grossMarginPercent?: number;
  profitRp: number;
  netMarginPercent?: number;
  bookings: number;
  occupancyPercent: number;
  bookingCount?: number;
  activeMembers?: number;
  occupancyRatePercent?: number;
}

export interface DashboardRiskItem {
  id: string;
  branchName: string;
  branchCode: string;
  className: string;
  startAt: Date;
  bookedCount: number;
  minimumQuota: number;
  capacity?: number;
  href: string;
}

export type DashboardSections = {
  trend: boolean;
  queue: boolean;
  risk: boolean;
  branchComparison: boolean;
};

export interface DashboardOverview {
  generatedAt: Date | string;
  period: DashboardOverviewPeriod;
  financial: DashboardFinancialSummary;
  views: DashboardViews;
  sections: DashboardSections;
  metrics: DashboardMetric[];
  queues: DashboardQueueSummary[];
  trend: DashboardTrendPoint[];
  branches: DashboardBranchPerformance[];
  risks: DashboardRiskItem[];
}

export interface DashboardClient {
  overview(input: { branchId?: string; from?: string; until?: string }): Promise<DashboardOverview>;
}

async function dashboardFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/v1${path}`, {
    credentials: 'include',
    headers: {
      Accept: 'application/json',
      ...init?.headers,
    },
    ...init,
  });
  if (!response.ok) {
    const error = new Error(`Dashboard request failed: ${response.status}`);
    (error as any).response = { status: response.status };
    throw error;
  }
  return response.json() as Promise<T>;
}

export const browserDashboardClient: DashboardClient = {
  async overview(input) {
    const params = new URLSearchParams();
    if (input.branchId) params.set('branchId', input.branchId);
    if (input.from) params.set('from', input.from.slice(0, 10));
    if (input.until) params.set('until', input.until.slice(0, 10));
    const qs = params.toString() ? `?${params.toString()}` : '';

    const data = await appLoading.track(
      dashboardFetch<any>(`/dashboard/overview${qs}`),
      { label: 'Memuat dashboard…' },
    );

    return {
      ...data,
      generatedAt: new Date(data.generatedAt),
      trend: (data.trend || []).map((t: any) => ({
        ...t,
        date: new Date(t.date),
      })),
      risks: (data.risks || []).map((r: any) => ({
        ...r,
        startAt: new Date(r.startAt),
      })),
    };
  },
};
