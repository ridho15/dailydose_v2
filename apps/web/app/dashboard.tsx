'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock,
  RefreshCw,
  TrendingUp,
} from 'lucide-react';
import { shortcutPagesFor } from '@/lib/frontend-pages';
import { isFrontDeskOnlySession, isInstructorOnlySession } from '@/lib/session-audience';
import { useSessionContext } from './session-context';
import { Feedback } from './ui';
import { Button, ButtonLink } from './components/actions';
import { AdminPageHeader } from './components/admin/admin-page-header';
import { Badge, DataTable, Panel, StatCard } from './components/admin/admin-ui';
import { DateInput } from './components/forms';
import {
  browserDashboardClient,
  type DashboardClient,
  type DashboardOverview,
} from '@/api-clients/dashboard-client';
import { formatRupiah } from './lib/formatters';
import { metricLabel } from './lib/audit-labels';
import { iconForPage } from './lib/page-icons';
import { timezoneLabel } from './classes/class-slot-presenters';
import { FrontDeskTodayView } from './workspace/front-desk-today-view';
import { InstructorTodayView } from './workspace/instructor-today-view';
import type { ClassSlotClient } from '@/api-clients/class-slot-client';
import type { BookingClient } from '@/api-clients/booking-client';
import type { AvailabilityClient } from '@/api-clients/availability-client';
import { EmptyWeeksNotice } from './workspace/empty-weeks-notice';
import { OwnerExceptionsPanel } from './workspace/owner-exceptions-panel';
import { OwnerHome } from './workspace/owner-home';
import type { OwnerReportClient } from '@/api-clients/owner-report-client';

const number = new Intl.NumberFormat('id-ID');
const compact = new Intl.NumberFormat('id-ID', { notation: 'compact', maximumFractionDigits: 1 });
const dateInput = (date: Date) => date.toISOString().slice(0, 10);
/** Tanggal tren bisa berupa Date (klien ter-generate) atau string ISO; ditampilkan sebagai "14 Sep 2026". */
const trendDate = (value: Date | string) => {
  const iso = (value instanceof Date ? value.toISOString() : String(value)).slice(0, 10);
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('id-ID', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
};
const financialMetricKeys = new Set([
  'gross-sales',
  'revenue',
  'instructor-realtime',
  'gross-profit',
  'other-cost',
  'profit',
  'pending-payments',
  'finance-anomalies',
]);

const dashboardCopy = {
  both: {
    eyebrow: 'Ikhtisar Studio',
    title: 'Keuangan dan operasional dalam satu pandangan',
    description:
      'Pantau omzet, laba, booking, okupansi, risiko kelas, dan pekerjaan yang membutuhkan keputusan Anda.',
  },
  finance: {
    eyebrow: 'Ikhtisar Keuangan',
    title: 'Arus transaksi dan pekerjaan keuangan',
    description: 'Pantau pembayaran, saldo sesi, dan antrean finansial dari satu ruang kerja.',
  },
  operations: {
    eyebrow: 'Pusat Operasional Cabang',
    title: 'Operasional cabang hari ini',
    description:
      'Prioritaskan kelas, booking, pelanggan, dan antrean keputusan untuk cabang aktif.',
  },
} as const;

/** Owner dan Super Owner memakai beranda keuangan bulanan (`OwnerHome`), bukan ringkasan ini. */
function isOwnerSession(session: { roles: readonly string[] }) {
  return session.roles.some((role) => role === 'SUPER_OWNER' || role === 'OWNER');
}

/** Ringkasan yang tampil bila server belum menjawab: keuangan untuk Finance/Owner/Super Owner, operasional untuk lainnya. */
function fallbackViews(roles: readonly string[]) {
  const finance = roles.some((role) => ['SUPER_OWNER', 'OWNER', 'FINANCE'].includes(role));
  const operations =
    roles.some((role) => ['SUPER_OWNER', 'OWNER', 'ADMIN', 'MANAGER'].includes(role)) || !finance;
  return { finance, operations };
}

function TrendChart({ points, finance }: { points: DashboardOverview['trend']; finance: boolean }) {
  if (points.length < 2)
    return <p className="py-12 text-center text-sm text-dd-muted">Belum cukup data untuk tren.</p>;
  const values = points.map((point) => (finance ? point.revenue : point.bookings));
  const profitValues = finance ? points.map((point) => point.profit) : [];
  const minimum = Math.min(...values, ...profitValues, 0);
  const maximum = Math.max(...values, ...profitValues, 1);
  const span = Math.max(1, maximum - minimum);
  const y = (value: number) => 92 - ((value - minimum) / span) * 76;
  const polyline = values
    .map((value, index) => `${(index / (values.length - 1)) * 100},${y(value)}`)
    .join(' ');
  const profitPolyline = profitValues
    .map((value, index) => `${(index / (profitValues.length - 1)) * 100},${y(value)}`)
    .join(' ');
  const format = (value: number) =>
    finance ? `Rp ${compact.format(value)}` : number.format(value);
  const formatExact = (value: number) => (finance ? formatRupiah(value) : number.format(value));
  const step = 100 / (points.length - 1);
  return (
    <figure className="mt-5">
      <div className="flex gap-3">
        <div
          className="flex h-56 shrink-0 flex-col justify-between py-3 text-right text-[11px] font-medium text-dd-muted"
          aria-hidden="true"
        >
          <span>{format(maximum)}</span>
          <span>{format(minimum + span / 2)}</span>
          <span>{format(minimum)}</span>
        </div>
        <svg
          role="img"
          aria-labelledby="dashboard-trend-title dashboard-trend-description"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          className="h-56 min-w-0 flex-1 overflow-visible"
        >
          <title id="dashboard-trend-title">Tren {finance ? 'pendapatan' : 'booking'}</title>
          <desc id="dashboard-trend-description">
            {values.map((value, index) => `${trendDate(points[index]!.date)}: ${value}`).join(', ')}
          </desc>
          {[16, 41, 66, 91].map((gridY) => (
            <line
              key={gridY}
              x1="0"
              y1={gridY}
              x2="100"
              y2={gridY}
              stroke="currentColor"
              className="text-dd-line/70"
              strokeWidth="0.5"
              strokeDasharray="2 2"
            />
          ))}
          <polyline
            points={polyline}
            fill="none"
            stroke="currentColor"
            className="text-dd-forest drop-shadow-sm"
            strokeWidth="2.5"
            vectorEffect="non-scaling-stroke"
          />
          {finance && (
            <polyline
              points={profitPolyline}
              fill="none"
              stroke="currentColor"
              className="text-dd-brass"
              strokeWidth="2"
              strokeDasharray="4 3"
              vectorEffect="non-scaling-stroke"
            />
          )}
          {/* Area sentuh per titik: tooltip bawaan menampilkan tanggal dan nilai. */}
          {points.map((point, index) => (
            <rect
              key={trendDate(point.date)}
              x={Math.max(0, index * step - step / 2)}
              y="0"
              width={step}
              height="100"
              fill="transparent"
            >
              <title>
                {`${trendDate(point.date)}: ${formatExact(values[index]!)}${
                  finance ? ` · profit ${formatExact(profitValues[index]!)}` : ''
                }`}
              </title>
            </rect>
          ))}
        </svg>
      </div>
      {finance && (
        <div className="mt-3 flex items-center gap-6 border-t border-dd-line/60 pt-3 text-xs font-semibold text-dd-muted">
          <span className="flex items-center gap-1.5 text-dd-forest">
            <span className="size-2.5 rounded-full bg-dd-forest" /> Omzet Bruto
          </span>
          <span className="flex items-center gap-1.5 text-dd-brass">
            <span className="size-2.5 rounded-full bg-dd-brass" /> Profit Operasional
          </span>
        </div>
      )}
      <figcaption className="mt-2 flex justify-between text-[11px] font-medium text-dd-muted">
        <span>{trendDate(points[0]!.date)}</span>
        <span>{trendDate(points.at(-1)!.date)}</span>
      </figcaption>
    </figure>
  );
}

export function Dashboard({
  client = browserDashboardClient,
  slotClient,
  bookingClient,
  availabilityClient,
  ownerReportClient,
}: {
  client?: DashboardClient;
  ownerReportClient?: OwnerReportClient;
  slotClient?: ClassSlotClient;
  bookingClient?: BookingClient;
  availabilityClient?: AvailabilityClient;
} = {}) {
  const context = useSessionContext();
  const session = context?.session;
  const [overview, setOverview] = useState<DashboardOverview>();
  const [loading, setLoading] = useState(false);
  const [failure, setFailure] = useState(false);
  const [until, setUntil] = useState(() => dateInput(new Date()));
  const [from, setFrom] = useState(() => dateInput(new Date(Date.now() - 29 * 86_400_000)));
  // Cakupan cabang mengikuti pemilih "Cabang aktif" di topbar (satu-satunya pemilih cabang).
  const activeBranch = context?.activeBranch;
  const branchId = context?.activeBranchId ?? '';
  const shortcuts = useMemo(() => (session ? shortcutPagesFor(session) : []), [session]);
  const canManageClasses = Boolean(
    typeof context?.hasCapability === 'function'
      ? context.hasCapability('class-slot:manage')
      : session?.capabilities?.includes('class-slot:manage') || session?.roles?.includes('SUPER_OWNER'),
  );

  const load = useCallback(async () => {
    if (!session) return;
    // Beranda instruktur tidak memakai ringkasan ini dan API menjawab 403 untuk perannya.
    if (isInstructorOnlySession(session) || isOwnerSession(session)) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setFailure(false);
    try {
      setOverview(await client.overview({ branchId: branchId || undefined, from, until }));
    } catch {
      setFailure(true);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchId, client, from, session?.id, until]);

  useEffect(() => {
    void load();
  }, [load]);
  if (!session) return null;
  if (isInstructorOnlySession(session)) {
    return (
      <InstructorTodayView
        client={slotClient}
        bookingClient={bookingClient}
        availabilityClient={availabilityClient}
      />
    );
  }
  // Owner dan Super Owner: keputusan lebih dulu, lalu omzet, payroll, pengeluaran, dan laba bulan ini.
  if (isOwnerSession(session)) {
    return <OwnerHome ownerReportClient={ownerReportClient} slotClient={slotClient} />;
  }
  if (isFrontDeskOnlySession(session)) {
    return (
      <FrontDeskTodayView
        client={slotClient}
        bookingClient={bookingClient}
        dashboardClient={client}
        queues={overview ? overview.queues.filter((queue) => queue.count > 0) : null}
      />
    );
  }
  const views = overview?.views ?? fallbackViews(session.roles);
  const copy = dashboardCopy[views.finance && views.operations ? 'both' : views.finance ? 'finance' : 'operations'];
  const queueTotal = overview?.queues.reduce((sum, item) => sum + item.count, 0) ?? 0;
  const queueCounts = Object.fromEntries(
    (overview?.queues ?? []).map((item) => [item.key, item.count]),
  );
  const showQueue = Boolean(overview?.sections.queue);
  const showRisk = Boolean(overview?.sections.risk);
  const canReadOwnerReport = Boolean(
    typeof context?.hasCapability === 'function'
      ? context.hasCapability('dashboard:read')
      : session.capabilities?.includes('dashboard:read'),
  );

  return (
    <div className="space-y-8 font-sans text-dd-ink">
      {/* ========================================================================= */}
      {/* ZONE 1: EXECUTIVE CONTEXT & HEADER                                       */}
      {/* ========================================================================= */}
      <AdminPageHeader
        eyebrow={copy.eyebrow}
        title={`Selamat datang, ${session.displayName}`}
        description={
          <>
            <strong className="font-semibold text-dd-ink">{copy.title}.</strong> {copy.description}
          </>
        }
        actions={
          <div className="flex flex-wrap items-center gap-3">
            <Badge tone={activeBranch ? 'success' : 'neutral'}>
              {activeBranch ? `Cabang: ${activeBranch.name}` : 'Semua Cabang'}
            </Badge>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void load()}
              disabled={loading}
              leadingIcon={
                <RefreshCw
                  className={`size-3.5 ${loading ? 'animate-spin' : ''}`}
                  aria-hidden="true"
                />
              }
            >
              Segarkan data
            </Button>
          </div>
        }
      />

      {/* Satu baris cakupan: cabang, periode, dan kesegaran data */}
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 rounded-dd-lg border border-dd-line/70 bg-white/70 px-4 py-2.5 text-xs font-medium text-dd-muted">
        <span>
          {activeBranch ? (
            <>
              <strong className="text-dd-ink">Cabang operasional: {activeBranch.name}</strong> (
              {timezoneLabel(activeBranch.timezone)})
            </>
          ) : (
            <strong className="text-dd-ink">Mode Lintas Cabang (Semua Cabang yang Diizinkan)</strong>
          )}
        </span>
        {overview && (
          <time dateTime={String(overview.generatedAt)} className="flex items-center gap-1.5">
            <Clock className="size-3.5" aria-hidden="true" />
            Diperbarui{' '}
            {new Date(overview.generatedAt).toLocaleString('id-ID', {
              dateStyle: 'medium',
              timeStyle: 'short',
            })}
            {' · '}
            Sumber s.d.{' '}
            {new Date(overview.financial.sourceCutoffAt).toLocaleString('id-ID', {
              dateStyle: 'medium',
              timeStyle: 'short',
            })}
          </time>
        )}
      </div>

      {/* Peringatan minggu kosong 4 minggu ke depan untuk owner / staf operasional */}
      {activeBranch ? (
        <EmptyWeeksNotice
          branchId={activeBranch.id}
          timezone={activeBranch.timezone}
          client={slotClient}
          canFill={canManageClasses}
        />
      ) : (
        session.branches.length > 0 && (
          <div className="space-y-4">
            {session.branches.map((b) => (
              <div key={b.id} className="space-y-1.5">
                <span className="text-[13px] font-bold text-dd-muted">
                  Jadwal Cabang: {b.name}
                </span>
                <EmptyWeeksNotice
                  branchId={b.id}
                  timezone={b.timezone}
                  client={slotClient}
                  canFill={canManageClasses}
                />
              </div>
            ))}
          </div>
        )
      )}

      {!activeBranch &&
        session.branches.length > 0 &&
        !session.roles.includes('SUPER_OWNER') &&
        !session.roles.includes('FINANCE') && (
          <Feedback kind="warning">
            Pilih cabang aktif di bagian atas sebelum membuka atau menjalankan pekerjaan yang
            memiliki cakupan cabang.
          </Feedback>
        )}
      {failure && (
        <Feedback kind="error">
          Ringkasan bisnis belum dapat dimuat. Gunakan pintasan di bawah atau coba segarkan.
        </Feedback>
      )}
      {overview?.financial.instructorFeeMissing && (
        <Feedback kind="warning">
          Tarif honor instruktur belum diisi, sehingga biaya instruktur tampil Rp 0 dan laba sama
          dengan omzet. Isi tarif honor di menu Master Data agar laba akurat.
        </Feedback>
      )}
      {overview?.financial.completeness === 'INCOMPLETE' && (
        <Feedback kind="warning">
          Laporan keuangan belum lengkap ({overview.financial.anomalyCount} anomali). Angka ini
          belum boleh digunakan sebagai acuan laporan atau sign-off Finance.
        </Feedback>
      )}

      {/* ========================================================================= */}
      {/* ZONE 2: ACTION CENTER (URGENT FIRST)                                     */}
      {/* ========================================================================= */}
      {overview && (showQueue || showRisk) && (
        <section aria-label="Pusat Tindakan & Antrean" className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-[13px] font-bold text-dd-forest">
              Pusat Tindakan & Antrean
            </span>
            {queueTotal > 0 && (
              <span className="text-xs font-semibold text-dd-brass">
                {queueTotal} pekerjaan menunggu tindakan
              </span>
            )}
          </div>
          <div className={`grid gap-6 ${showQueue && showRisk ? 'xl:grid-cols-[1.5fr_1fr]' : ''}`}>
            {showQueue && (
              <Panel className="p-6" aria-labelledby="dashboard-queue-title">
                <div className="flex items-center justify-between gap-3 border-b border-dd-line/60 pb-4">
                  <div>
                    <span className="text-[13px] font-bold text-dd-forest">
                      Antrean kerja
                    </span>
                    <h2
                      id="dashboard-queue-title"
                      className="mt-1 font-sans text-xl font-bold text-dd-ink"
                    >
                      Perlu perhatian Anda
                    </h2>
                  </div>
                  <Badge tone={queueTotal > 0 ? 'warning' : 'success'}>{queueTotal} item</Badge>
                </div>
                <div className="mt-2 divide-y divide-dd-line/60">
                  {overview.queues.length ? (
                    overview.queues.map((item) => (
                      <Link
                        key={item.key}
                        href={item.href}
                        className="group flex items-center gap-4 rounded-dd-md px-2 py-4 text-dd-ink no-underline transition hover:bg-dd-surface-muted/30"
                      >
                        <span className="grid size-10 place-items-center rounded-dd-md bg-dd-brass-soft font-bold text-dd-brass-dark shadow-sm">
                          {item.count}
                        </span>
                        <span className="text-sm font-semibold sm:text-base">{item.label}</span>
                        <ArrowRight className="ml-auto size-4 text-dd-muted transition group-hover:translate-x-1 group-hover:text-dd-forest" />
                      </Link>
                    ))
                  ) : (
                    <div className="py-10 text-center text-sm text-dd-muted">
                      <CheckCircle2 className="mx-auto mb-2 size-8 text-dd-success/60" />
                      Tidak ada antrean yang membutuhkan tindakan.
                    </div>
                  )}
                </div>
              </Panel>
            )}

            {showRisk && (
              <Panel className="p-6" aria-labelledby="dashboard-risk-title">
                <div className="border-b border-dd-line/60 pb-4">
                  <span className="text-[13px] font-bold text-dd-forest">
                    Pantauan H-24
                  </span>
                  <h2
                    id="dashboard-risk-title"
                    className="mt-1 font-sans text-xl font-bold text-dd-ink"
                  >
                    Kelas berisiko
                  </h2>
                </div>
                <div className="mt-4 space-y-3">
                  {overview.risks.length ? (
                    overview.risks.map((item) => (
                      <Link
                        key={item.id}
                        href={item.href}
                        className="flex gap-3.5 rounded-dd-md border border-dd-line/80 bg-dd-surface-muted/30 p-3.5 text-dd-ink no-underline transition hover:border-dd-forest/60 hover:bg-white"
                      >
                        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-dd-warning" />
                        <span className="min-w-0 flex-1">
                          <strong className="block truncate text-sm font-bold text-dd-ink">
                            {item.className}
                          </strong>
                          <span className="mt-1 block text-xs text-dd-muted">
                            {item.bookedCount}/{item.minimumQuota} kuota minimum ·{' '}
                            {new Date(item.startAt).toLocaleString('id-ID', {
                              dateStyle: 'medium',
                              timeStyle: 'short',
                            })}
                          </span>
                        </span>
                      </Link>
                    ))
                  ) : (
                    <div className="py-10 text-center text-sm text-dd-muted">
                      <CheckCircle2 className="mx-auto mb-2 size-8 text-dd-success/60" />
                      Tidak ada kelas berisiko dalam 24 jam.
                    </div>
                  )}
                </div>
              </Panel>
            )}
          </div>
        </section>
      )}

      {overview && canReadOwnerReport && (
        <OwnerExceptionsPanel
          from={from}
          until={until}
          branchId={branchId || undefined}
          timezone={activeBranch?.timezone}
          client={ownerReportClient}
        />
      )}

      {/* ========================================================================= */}
      {/* ZONE 3: EXECUTIVE HERO KPIS & PERFORMANCE METRICS                        */}
      {/* ========================================================================= */}
      {overview &&
        (() => {
          const metrics = overview.metrics ?? [];
          const financialMetrics = metrics.filter((m) => financialMetricKeys.has(m.key));
          const operationalMetrics = metrics.filter((m) => !financialMetricKeys.has(m.key));

          const renderCard = (metric: (typeof metrics)[number]) => {
            const isFinancial = financialMetricKeys.has(metric.key);
            const isUnavailable =
              metric.value === null ||
              metric.value === undefined ||
              Number.isNaN(metric.value) ||
              (overview.financial.completeness === 'INCOMPLETE' && isFinancial);

            const formattedValue = isUnavailable
              ? 'Belum tersedia'
              : metric.unit === 'IDR'
                ? formatRupiah(metric.value)
                : metric.unit === 'PERCENT'
                  ? `${number.format(metric.value)}%`
                  : number.format(metric.value);

            const helperText = isUnavailable
              ? 'Konfigurasi atau sumber belum lengkap'
              : metric.changePercent == null
                ? 'Periode terpilih'
                : 'dibanding periode sebelumnya';

            return (
              <StatCard
                key={metric.key}
                label={metricLabel(metric.key, metric.label)}
                value={formattedValue}
                change={isUnavailable ? undefined : (metric.changePercent ?? undefined)}
                helper={helperText}
              />
            );
          };

          return (
            <div className="space-y-6">
              {operationalMetrics.length > 0 && (
                <section aria-label="Kinerja operasional dan member" className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[13px] font-bold text-dd-forest">
                      Indikator Utama Operasional & Member
                    </span>
                  </div>
                  <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
                    {operationalMetrics.map(renderCard)}
                  </div>
                </section>
              )}

              {financialMetrics.length > 0 && (
                <section aria-label="Performa finansial" className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[13px] font-bold text-dd-forest">
                      Rincian Finansial & Transaksi
                    </span>
                    {overview.financial.completeness === 'INCOMPLETE' && (
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-dd-warning/30 bg-dd-warning-soft px-2.5 py-0.5 text-[11px] font-semibold text-dd-warning">
                        <span className="size-1.5 rounded-full bg-dd-warning" />
                        {overview.financial.anomalyCount} anomali data migrasi tercatat
                      </span>
                    )}
                  </div>
                  <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
                    {financialMetrics.map(renderCard)}
                  </div>
                </section>
              )}
            </div>
          );
        })()}

      {loading && !overview && (
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 8 }, (_, index) => (
            <div
              key={index}
              className="h-40 animate-pulse rounded-dd-lg border border-dd-line/80 bg-white/70"
            />
          ))}
        </div>
      )}

      {/* ========================================================================= */}
      {/* ZONE 4: ANALYTICS & TRENDS (WITH INTEGRATED DATE RANGE TOOLBAR)           */}
      {/* ========================================================================= */}
      <section aria-label="Analisis tren dan portofolio" className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-dd-line/60 pb-3">
          <div>
            <span className="text-[13px] font-bold text-dd-forest">
              Analisis Tren & Portofolio
            </span>
            <h2 className="mt-1 font-sans text-xl font-bold text-dd-ink sm:text-2xl">
              Performa Periode Historis
            </h2>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <DateInput
              label="Dari"
              value={from}
              max={until}
              compact
              onChange={(event) => setFrom(event.target.value)}
              wrapperClassName="min-w-36"
            />
            <DateInput
              label="Sampai"
              value={until}
              min={from}
              compact
              onChange={(event) => setUntil(event.target.value)}
              wrapperClassName="min-w-36"
            />
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void load()}
              disabled={loading}
              leadingIcon={
                <RefreshCw
                  className={`size-3.5 ${loading ? 'animate-spin' : ''}`}
                  aria-hidden="true"
                />
              }
            >
              Terapkan
            </Button>
          </div>
        </div>

        {overview?.sections.trend && (
          <Panel className="p-6 sm:p-8">
            <div className="flex items-center justify-between border-b border-dd-line/60 pb-4">
              <div>
                <h3 className="font-sans text-lg font-bold text-dd-ink">
                  {views.finance
                    ? 'Omzet dan profit operasional'
                    : 'Pergerakan booking'}
                </h3>
                <p className="text-xs text-dd-muted">Grafik fluktuasi harian dalam periode terpilih</p>
              </div>
              <TrendingUp className="size-5 text-dd-forest opacity-80" />
            </div>
            <TrendChart
              points={overview.trend}
              finance={views.finance}
            />
          </Panel>
        )}

        {/* Rincian Profit & Sumber Omset (Hanya untuk Owner, Super Owner / Executive, & Finance) */}
        {(views.finance) && overview?.financial.profitBreakdown && (
          <div className="grid gap-6 lg:grid-cols-2">
            {/* Kartu 1: Dekomposisi Laba Rugi Berjenjang (Waterfall P&L) */}
            <Panel className="p-6">
              <div className="flex items-center justify-between border-b border-dd-line/60 pb-3">
                <div>
                  <h3 className="font-sans text-base font-bold text-dd-ink">
                    Dekomposisi Laba Rugi (P&L)
                  </h3>
                  <p className="text-xs text-dd-muted">Alur pembentukan laba dari omzet kotor hingga laba bersih operasional</p>
                </div>
                <Badge tone={overview.financial.profitBreakdown.netOperatingProfitRp >= 0 ? 'success' : 'danger'}>
                  Margin Bersih: {overview.financial.profitBreakdown.netMarginPercent}%
                </Badge>
              </div>

              <div className="mt-4 space-y-2 text-sm">
                <div className="flex items-center justify-between py-1.5">
                  <span className="text-dd-muted">Omzet Penjualan Bruto</span>
                  <span className="font-semibold">{formatRupiah(overview.financial.profitBreakdown.grossSalesRp)}</span>
                </div>
                {overview.financial.profitBreakdown.discountRp > 0 && (
                  <div className="flex items-center justify-between py-1.5 text-dd-danger">
                    <span>(-) Diskon & Promo Paket</span>
                    <span className="font-medium">- {formatRupiah(overview.financial.profitBreakdown.discountRp)}</span>
                  </div>
                )}
                <div className="flex items-center justify-between border-t border-dd-line/50 py-1.5 font-medium">
                  <span className="text-dd-ink">(=) Omzet Penjualan Bersih</span>
                  <span className="font-bold text-dd-forest">{formatRupiah(overview.financial.profitBreakdown.netRevenueRp)}</span>
                </div>
                <div className="flex items-center justify-between py-1.5 text-dd-brass-dark">
                  <span>(-) Modal sesi (sesi terjual x modal per sesi)</span>
                  <span className="font-medium">- {formatRupiah(overview.financial.profitBreakdown.modalSesiRp ?? 0)}</span>
                </div>
                <div className="flex items-center justify-between rounded-dd-md bg-dd-forest/5 px-3 py-2 border border-dd-forest/20">
                  <div className="flex items-center gap-2">
                    <strong className="text-dd-forest">(=) Laba Kotor Operasional</strong>
                    <span className="text-[11px] font-bold text-dd-forest/80 rounded bg-dd-forest/10 px-1.5 py-0.5">
                      Margin {overview.financial.profitBreakdown.grossMarginPercent}%
                    </span>
                  </div>
                  <span className="font-bold text-dd-forest">{formatRupiah(overview.financial.profitBreakdown.grossProfitRp)}</span>
                </div>
                <div className="flex items-center justify-between py-1.5 text-dd-danger">
                  <span>(-) Biaya Operasional / Pengeluaran Lain</span>
                  <span className="font-medium">- {formatRupiah(overview.financial.profitBreakdown.otherCostRp)}</span>
                </div>
                <div className="flex items-center justify-between rounded-dd-md bg-dd-surface-muted/60 px-3 py-2.5 border border-dd-line">
                  <div className="flex items-center gap-2">
                    <strong className="text-dd-ink">(=) Laba Bersih Operasional</strong>
                    <span className="text-[11px] font-bold text-dd-ink/80 rounded bg-white px-1.5 py-0.5 border border-dd-line/60">
                      Margin {overview.financial.profitBreakdown.netMarginPercent}%
                    </span>
                  </div>
                  <span className="text-base font-extrabold text-dd-forest">
                    {formatRupiah(overview.financial.profitBreakdown.netOperatingProfitRp)}
                  </span>
                </div>
              </div>
            </Panel>

            {/* Kartu 2: Sumber Omset Penjualan (Breakdown by Package, Payment Method, Class Type) */}
            <Panel className="p-6">
              <div className="flex items-center justify-between border-b border-dd-line/60 pb-3">
                <div>
                  <h3 className="font-sans text-base font-bold text-dd-ink">
                    Rincian Sumber Omset
                  </h3>
                  <p className="text-xs text-dd-muted">Kontribusi omzet berdasarkan paket, metode pembayaran, dan jenis kelas</p>
                </div>
                <Badge tone="neutral">
                  Total {formatRupiah(overview.financial.revenueRp)}
                </Badge>
              </div>

              <div className="mt-4 space-y-4">
                {/* Sumber per Paket */}
                <div>
                  <div className="flex items-center justify-between text-[13px] font-bold text-dd-muted">
                    <span>Paket Terlaris</span>
                    <span>Nominal & Porsi</span>
                  </div>
                  <div className="mt-2 divide-y divide-dd-line/50 text-xs">
                    {(overview.financial.omsetBreakdown?.byPackage ?? []).slice(0, 4).map((pkg) => (
                      <div key={pkg.key} className="flex items-center justify-between py-2">
                        <span className="font-medium text-dd-ink truncate max-w-[55%]">
                          {pkg.label} <span className="text-dd-muted">({pkg.count} terjual)</span>
                        </span>
                        <div className="text-right">
                          <span className="font-bold text-dd-forest">{formatRupiah(pkg.totalRp)}</span>
                          <span className="ml-2 font-semibold text-dd-muted">({pkg.percentage}%)</span>
                        </div>
                      </div>
                    ))}
                    {(overview.financial.omsetBreakdown?.byPackage?.length ?? 0) === 0 && (
                      <p className="py-2 text-center text-xs text-dd-muted">Belum ada transaksi paket terbayar.</p>
                    )}
                  </div>
                </div>

                {/* Sumber per Metode Pembayaran */}
                <div className="border-t border-dd-line/60 pt-3">
                  <div className="flex items-center justify-between text-[13px] font-bold text-dd-muted">
                    <span>Metode Pembayaran</span>
                    <span>Nominal & Porsi</span>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                    {(overview.financial.omsetBreakdown?.byPaymentMethod ?? []).map((method) => (
                      <div key={method.key} className="rounded-dd-sm border border-dd-line/60 bg-dd-surface-muted/30 p-2.5">
                        <span className="font-bold text-dd-muted">{method.label}</span>
                        <div className="mt-1 flex items-baseline justify-between">
                          <strong className="text-dd-ink">{formatRupiah(method.totalRp)}</strong>
                          <span className="text-[11px] font-semibold text-dd-forest">{method.percentage}%</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </Panel>
          </div>
        )}

        {overview?.branches.length ? (
          <div className="space-y-3 pt-2">
            <div>
              <h3 className="font-sans text-lg font-bold text-dd-ink">
                Performa per cabang
              </h3>
              <p className="text-xs text-dd-muted">Perbandingan omzet, okupansi, dan efisiensi operasional</p>
            </div>
            <DataTable
              items={overview.branches}
              rowKey={(branch) => branch.id}
              showRowNumbers={false}
              columns={[
                {
                  id: 'branch',
                  header: 'Cabang',
                  cell: (branch) => (
                    <strong className="font-bold text-dd-ink">{branch.name}</strong>
                  ),
                },
                { id: 'revenue', header: 'Omzet', cell: (branch) => formatRupiah(branch.revenueRp) },
                {
                  id: 'instructor',
                  header: 'Modal sesi',
                  cell: (branch) => formatRupiah(branch.modalSesiRp ?? 0),
                },
                {
                  id: 'grossProfit',
                  header: 'Laba Kotor',
                  cell: (branch) => (
                    <div>
                      <span className="font-semibold text-dd-forest">
                        {formatRupiah(branch.grossProfitRp)}
                      </span>
                      {branch.grossMarginPercent !== undefined && (
                        <span className="block text-xs font-medium text-dd-muted">{branch.grossMarginPercent}% margin</span>
                      )}
                    </div>
                  ),
                },
                {
                  id: 'cost',
                  header: 'Pengeluaran Lain',
                  cell: (branch) => formatRupiah(branch.otherCostRp),
                },
                {
                  id: 'profit',
                  header: 'Profit Bersih',
                  cell: (branch) => (
                    <div>
                      <span className="font-bold text-dd-forest">{formatRupiah(branch.profitRp)}</span>
                      {branch.netMarginPercent !== undefined && (
                        <span className="block text-xs font-semibold text-dd-forest/80">{branch.netMarginPercent}% margin</span>
                      )}
                    </div>
                  ),
                },
                {
                  id: 'bookings',
                  header: 'Booking',
                  cell: (branch) => (
                    <span className="font-semibold">{number.format(branch.bookings)}</span>
                  ),
                },
                {
                  id: 'occupancy',
                  header: 'Okupansi',
                  cell: (branch) => (
                    <div className="flex items-center gap-3">
                      <div className="h-2 w-24 overflow-hidden rounded-full bg-dd-surface-muted">
                        <span
                          className="block h-full rounded-full bg-dd-forest"
                          style={{ width: `${Math.min(100, branch.occupancyPercent)}%` }}
                        />
                      </div>
                      <span className="text-xs font-bold">{branch.occupancyPercent}%</span>
                    </div>
                  ),
                },
              ]}
              mobileCard={(branch) => (
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <strong className="text-dd-ink">{branch.name}</strong>
                  </div>
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                    <dt className="text-dd-muted">Omzet</dt>
                    <dd className="text-right font-medium">{formatRupiah(branch.revenueRp)}</dd>
                    <dt className="text-dd-muted">Laba Kotor</dt>
                    <dd className="text-right font-semibold text-dd-forest">
                      {formatRupiah(branch.grossProfitRp)}
                    </dd>
                    <dt className="text-dd-muted">Profit Bersih</dt>
                    <dd className="text-right font-bold text-dd-forest">
                      {formatRupiah(branch.profitRp)}
                    </dd>
                    <dt className="text-dd-muted">Booking</dt>
                    <dd className="text-right font-semibold">{number.format(branch.bookings)}</dd>
                    <dt className="text-dd-muted">Okupansi</dt>
                    <dd className="text-right font-bold">{branch.occupancyPercent}%</dd>
                  </dl>
                </div>
              )}
            />
          </div>
        ) : null}
      </section>

      {/* ========================================================================= */}
      {/* ZONE 5: QUICK WORKFLOWS & SYSTEM HEALTH (BOTTOM)                          */}
      {/* ========================================================================= */}
      {shortcuts.length > 0 && (
        <section aria-label="Pintasan" className="space-y-3 pt-2">
          <div className="flex items-center justify-between border-t border-dd-line/60 pt-4">
            <div>
              <span className="text-[13px] font-bold text-dd-forest">
                Akses Cepat
              </span>
              <h2
                id="dashboard-shortcuts-title"
                className="mt-1 font-sans text-xl font-bold text-dd-ink"
              >
                Pintasan Alur Kerja
              </h2>
            </div>
            <span className="text-xs text-dd-muted">Pekerjaan harian sesuai peran Anda</span>
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            {shortcuts.map((page) => {
              const Icon = iconForPage(page.href);
              const count = page.queueBadgeSource ? (queueCounts[page.queueBadgeSource] ?? 0) : 0;
              return (
                <Link
                  key={page.href}
                  href={page.href}
                  className="group flex flex-col justify-between gap-3 rounded-dd-lg border border-dd-line/80 bg-white p-4 no-underline transition hover:-translate-y-0.5 hover:border-dd-forest hover:"
                >
                  <div className="flex items-center justify-between">
                    <span className="grid size-9 place-items-center rounded-dd-md bg-dd-forest/10 text-dd-forest">
                      <Icon className="size-5" aria-hidden="true" />
                    </span>
                    {count > 0 && (
                      <span
                        aria-label={`${count} antrean`}
                        className="rounded-full bg-dd-brass px-2 py-0.5 text-[11px] font-bold text-white"
                      >
                        {count}
                      </span>
                    )}
                  </div>
                  <div>
                    <strong className="block text-sm font-bold text-dd-ink">
                      {page.shortLabel}
                    </strong>
                    <span className="mt-0.5 line-clamp-2 text-xs text-dd-muted">
                      {page.description}
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
