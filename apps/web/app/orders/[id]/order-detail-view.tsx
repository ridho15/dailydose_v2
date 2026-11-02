'use client';

import { ArrowLeft, CheckCircle2, Clock3, PackageCheck } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { CustomerPaymentFlow } from '../../components/customer/customer-payment-flow';
import { AlertBanner } from '../../components/app-feedback';
import { ButtonLink } from '../../components/actions';
import { browserOrderClient, orderError, type CustomerOrder } from '@/api-clients/order-client';
import { orderReasonLabels, orderTimelineLabels } from '@/lib/order-presenters';
import { PageHeader, Skeleton, StatusBadge } from '../../ui';

// Halaman yang boleh menjadi tujuan "kembali" dari detail pesanan (jalur persis, bukan awalan).
const TUJUAN_KEMBALI = new Set(['/orders', '/account/packages']);

function safeReturnTo(value: string | null) {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return '/orders';
  try {
    const parsed = new URL(value, 'http://local');
    return parsed.origin === 'http://local' && TUJUAN_KEMBALI.has(parsed.pathname)
      ? `${parsed.pathname}${parsed.search}`
      : '/orders';
  } catch {
    return '/orders';
  }
}

export function OrderDetailView({ id }: { id: string }) {
  const searchParams = useSearchParams();
  const returnTo = safeReturnTo(searchParams.get('returnTo'));
  const [order, setOrder] = useState<CustomerOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      setOrder(await browserOrderClient.detail(id));
    } catch (cause) {
      setError(orderError(cause));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => void load(), [id]);

  if (loading)
    return (
      <section className="rounded-none border border-ed-line bg-white p-6 shadow-none">
        <Skeleton label="Memuat pesanan" />
      </section>
    );

  if (!order)
    return (
      <section className="rounded-none border border-ed-line bg-white p-6 shadow-none">
        <p className="text-[13px] font-bold text-ed-green">Pesanan</p>
        <h1 className="font-serif mt-2 text-2xl font-normal tracking-tight text-ed-ink">Pesanan tidak tersedia</h1>
        <p className="mt-2 text-sm text-ed-muted">
          Pesanan mungkin sudah tidak dapat diakses atau bukan milik akun ini.
        </p>
        {error && (
          <div className="mt-5">
            <AlertBanner tone="danger" title="Pesanan belum dapat dimuat" message={error} />
          </div>
        )}
        <div className="mt-5 flex flex-wrap gap-3">
          <ButtonLink href={returnTo}>Kembali ke pesanan</ButtonLink>
          <ButtonLink href="/contact" variant="secondary">
            Hubungi studio
          </ButtonLink>
        </div>
      </section>
    );

  const formatter = new Intl.DateTimeFormat('id-ID', {
    dateStyle: 'medium',
    timeStyle: 'short',
    ...(order.branchTimezone ? { timeZone: order.branchTimezone } : {}),
  });

  return (
    <main className="space-y-6" aria-labelledby="order-title">
      <PageHeader
        eyebrow={`Pesanan •${order.id.slice(-8)}`}
        title={order.packageName}
        description="Pantau pembayaran, unggah bukti, dan lihat riwayat pesanan pada satu halaman."
        titleId="order-title"
        backHref={returnTo}
        backLabel="Semua pesanan"
      />

      <CustomerPaymentFlow
        order={order}
        onUpdated={(updated) => {
          setOrder(updated);
          void browserOrderClient.detail(id).then(setOrder);
        }}
      />

      {order.activation && (
        <section className="rounded-none border border-ed-line bg-ed-tint/60 p-5 sm:p-6">
          <div className="flex items-start gap-3">
            <span className="grid size-11 shrink-0 place-items-center rounded-none border border-ed-line bg-white text-ed-forest">
              <PackageCheck className="size-5" aria-hidden="true" />
            </span>
            <div>
              <p className="text-[13px] font-bold text-ed-green">
                Paket aktif
              </p>
              <h2 className="font-serif mt-1 text-xl font-normal tracking-tight text-ed-ink">{order.packageName}</h2>
              <p className="mt-2 text-sm text-ed-muted">
                {order.activation.sessionCount} sesi · aktif sejak{' '}
                {new Date(order.activation.activationDate).toLocaleDateString('id-ID')} · berlaku sampai{' '}
                {new Date(order.activation.expiryAt).toLocaleDateString('id-ID')}
              </p>
              <ButtonLink href="/account/packages" size="sm" className="mt-4">
                Lihat Paket Saya
              </ButtonLink>
            </div>
          </div>
        </section>
      )}

      <section className="rounded-none border border-ed-line bg-white p-5 shadow-none sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[13px] font-bold text-ed-green">
              Histori pesanan
            </p>
            <h2 className="font-serif mt-1 text-xl font-normal tracking-tight text-ed-ink">Timeline pembayaran</h2>
          </div>
          <StatusBadge tone={order.timelineComplete ? 'success' : 'neutral'}>
            {order.timelineComplete ? 'Riwayat lengkap' : 'Riwayat legacy'}
          </StatusBadge>
        </div>
        {!order.timelineComplete && (
          <div className="mt-4">
            <AlertBanner
              tone="info"
              title="Riwayat pesanan lama"
              message="Timeline hanya menampilkan kejadian yang dapat dipastikan dari data transaksi. Tahap yang tidak tercatat tidak dibuat ulang."
            />
          </div>
        )}
        {order.timeline?.items.length ? (
          <ol className="mt-6 space-y-0" aria-label="Timeline pesanan">
            {order.timeline.items.map((item, index) => {
              const copy = orderTimelineLabels[item.type];
              const reason = item.reasonCode ? orderReasonLabels[item.reasonCode] : undefined;
              return (
                <li
                  key={item.id}
                  className="relative grid grid-cols-[32px_minmax(0,1fr)] gap-3 pb-6"
                >
                  {index < order.timeline!.items.length - 1 && (
                    <span
                      className="absolute left-[15px] top-8 h-[calc(100%-1rem)] w-px bg-ed-line"
                      aria-hidden="true"
                    />
                  )}
                  <span className="relative z-[1] grid size-8 place-items-center rounded-none border border-ed-line bg-white text-ed-forest">
                    {item.type === 'PAYMENT_APPROVED' || item.type === 'PACKAGE_ACTIVATED' ? (
                      <CheckCircle2 className="size-4" aria-hidden="true" />
                    ) : (
                      <Clock3 className="size-4" aria-hidden="true" />
                    )}
                  </span>
                  <div>
                    <strong className="block text-sm text-ed-ink">{copy.title}</strong>
                    <time
                      className="mt-1 block text-xs text-ed-muted"
                      dateTime={item.occurredAt.toISOString()}
                    >
                      {formatter.format(item.occurredAt)}
                    </time>
                    <p className="mt-2 text-sm leading-relaxed text-ed-muted">
                      {reason ?? copy.description}
                    </p>
                  </div>
                </li>
              );
            })}
          </ol>
        ) : (
          <p className="mt-5 rounded-none border border-ed-line bg-ed-tint/40 p-4 text-sm text-ed-muted">
            Belum ada histori yang dapat ditampilkan.
          </p>
        )}
      </section>
    </main>
  );
}
