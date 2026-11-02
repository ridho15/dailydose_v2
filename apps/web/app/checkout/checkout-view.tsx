'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ArrowLeft, ArrowRight, Check, ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { CustomerPaymentFlow } from '../components/customer/customer-payment-flow';
import { AlertBanner, useAppFeedback } from '../components/app-feedback';
import { useTrackedRouter } from '../components/app-loading';
import { Button, ButtonLink, StickyActionBar } from '../components/actions';
import { SearchSelect, TextInput } from '../components/forms';
import { PackagePrice } from '../components/public/package-price';
import {
  browserOrderClient,
  orderError,
  orderErrorDetails,
  type CheckoutOptions,
  type CustomerOrder,
} from '@/api-clients/order-client';
import { Skeleton } from '../ui';
import { formatRupiah } from '../lib/formatters';
import { useSessionContext } from '../session-context';

export function CheckoutView() {
  const params = useSearchParams();
  const router = useTrackedRouter();
  const feedback = useAppFeedback();
  const sessionContext = useSessionContext();
  const session = sessionContext?.session;
  const packageId = params.get('package') || params.get('packageId') || '';
  const branchId = params.get('branch') || params.get('branchId');
  const requestedClassTypeId = params.get('classType') || params.get('classTypeId') || '';
  const slot = params.get('slot') || params.get('slotId');
  const orderId = params.get('order') || params.get('orderId');
  const [options, setOptions] = useState<CheckoutOptions | null>(null);
  const [selectedClassTypeId, setSelectedClassTypeId] = useState('');
  const [order, setOrder] = useState<CustomerOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [errorCode, setErrorCode] = useState('');
  const [voucherCode, setVoucherCode] = useState('');
  const [voucherError, setVoucherError] = useState('');
  const [voucherPreview, setVoucherPreview] = useState<{
    code: string;
    packagePromotionDiscountRp: number;
    discountRp: number;
    priceAfterDiscountRp: number;
    discountType?: 'PERCENTAGE' | 'FIXED_AMOUNT';
    discountValue?: number;
  } | null>(null);
  const [voucherBusy, setVoucherBusy] = useState(false);

  const effectiveBranchId = branchId?.trim() || options?.package.branchId || '';

  useEffect(() => {
    setLoading(true);
    setError('');
    setErrorCode('');
    setVoucherError('');
    const request = orderId
      ? browserOrderClient.detail(orderId).then((value) => setOrder(value))
      : packageId
        ? browserOrderClient.checkout(packageId, branchId).then((value) => {
            setOptions(value);

            const requestedIsValid = value.package.classTypes.some(
              (item) => item.id === requestedClassTypeId,
            );

            setSelectedClassTypeId(
              requestedIsValid
                ? requestedClassTypeId
                : value.package.classTypes.length === 1
                  ? value.package.classTypes[0]!.id
                  : '',
            );
          })
        : Promise.reject(new Error('RESOURCE_NOT_FOUND'));
    request
      .catch((cause) => {
        const details = orderErrorDetails(cause);
        setError(details.message);
        setErrorCode(details.code);
      })
      .finally(() => setLoading(false));
  }, [branchId, orderId, packageId, requestedClassTypeId]);

  if (loading)
    return (
      <section className="rounded-none border border-ed-line bg-white p-6 shadow-none">
        <Skeleton label="Menyiapkan checkout" />
      </section>
    );

  if (order) {
    return (
      <main className="space-y-6 pt-2" aria-labelledby="checkout-title">
        <header>
          <p className="text-[13px] font-bold text-ed-green">
            Checkout aman
          </p>
          <h1 id="checkout-title" className="font-serif mt-2 text-2xl font-normal tracking-tight text-ed-ink sm:text-3xl">
            Selesaikan pembayaran
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-ed-muted">
            Gunakan nominal yang ditampilkan agar transfer dapat dicocokkan, lalu unggah bukti pada
            halaman ini.
          </p>
        </header>
        <CustomerPaymentFlow order={order} onUpdated={setOrder} />
      </main>
    );
  }

  if (!packageId || !options) {
    const isAuthError =
      errorCode === 'UNAUTHORIZED' ||
      errorCode === 'HTTP_401' ||
      error?.toLowerCase().includes('sesi') ||
      error?.toLowerCase().includes('unauthorized') ||
      error?.toLowerCase().includes('401') ||
      sessionContext?.status === 'unauthenticated';

    const checkoutDestination = packageId
      ? `/checkout?package=${packageId}${branchId ? `&branch=${branchId}` : ''}${requestedClassTypeId ? `&classType=${requestedClassTypeId}` : ''}${slot ? `&slot=${encodeURIComponent(slot)}` : ''}`
      : '/packages';
    const returnTo = encodeURIComponent(checkoutDestination);

    if (isAuthError && packageId) {
      return (
        <section className="rounded-none border border-ui bg-white p-8 shadow-none max-w-xl mx-auto text-center space-y-4">
          <div className="mx-auto flex size-12 items-center justify-center rounded-none border border-ed-line bg-ed-tint text-ed-forest">
            <ShieldCheck className="size-6" />
          </div>
          <p className="text-[13px] font-bold text-ed-green">
            Pembelian Paket Sesi
          </p>
          <h1 className="font-serif text-2xl font-normal tracking-tight text-ed-ink sm:text-3xl">
            Masuk untuk Melanjutkan Pembelian
          </h1>
          <p className="text-[17px] leading-relaxed text-ed-muted">
            Untuk mengaitkan paket sesi Pilates dengan akun Anda dan memproses pembayaran secara aman,
            silakan masuk atau buat akun baru terlebih dahulu.
          </p>
          <div className="pt-2 flex flex-col sm:flex-row gap-3 justify-center">
            <ButtonLink href={`/sign-in?returnTo=${returnTo}`} className="w-full sm:w-auto min-h-[44px]">
              Masuk ke Akun
            </ButtonLink>
            <ButtonLink variant="secondary" href={`/register?returnTo=${returnTo}`} className="w-full sm:w-auto min-h-[44px] border-ui">
              Daftar Akun Baru
            </ButtonLink>
          </div>
        </section>
      );
    }

    const isVerificationRequired =
      errorCode === 'CUSTOMER_VERIFICATION_REQUIRED' ||
      errorCode === 'IDENTITY_VERIFICATION_REQUIRED' ||
      (sessionContext?.status === 'authenticated' &&
        session?.identityVerificationStatus &&
        session?.identityVerificationStatus !== 'APPROVED');

    if (isVerificationRequired) {
      const isPending =
        session?.identityVerificationStatus === 'PENDING' ||
        error?.toLowerCase().includes('sedang diperiksa') ||
        error?.toLowerCase().includes('sedang berlangsung');

      return (
        <section className="rounded-none border border-ui bg-white p-8 shadow-none max-w-xl mx-auto text-center space-y-4">
          <div className="mx-auto flex size-12 items-center justify-center rounded-none border border-amber-800/20 bg-amber-50 text-amber-900">
            <ShieldCheck className="size-6" />
          </div>
          <p className="text-[13px] font-bold text-amber-900">
            Verifikasi Identitas
          </p>
          <h1 className="font-serif text-2xl font-normal tracking-tight text-ed-ink sm:text-3xl">
            {isPending ? 'Verifikasi identitas sedang diproses' : 'Pembelian paket belum bisa diproses'}
          </h1>
          <p className="text-[17px] leading-relaxed text-ed-muted">
            {isPending
              ? 'Data kamu sedang diperiksa tim studio. Kami kabari lewat WhatsApp kalau sudah selesai.'
              : 'Identitas kamu belum diverifikasi. Isi data verifikasi dulu, sekitar 2 menit.'}
          </p>
          <div className="pt-2 flex flex-col sm:flex-row gap-3 justify-center">
            <ButtonLink href={`/account/verification?returnTo=${returnTo}`} className="w-full sm:w-auto min-h-[44px]">
              {isPending ? 'Lihat status verifikasi' : 'Isi data verifikasi'}
            </ButtonLink>
            <ButtonLink variant="secondary" href="/packages" className="w-full sm:w-auto min-h-[44px] border-ui">
              Kembali ke paket
            </ButtonLink>
          </div>
        </section>
      );
    }

    return (
      <section className="rounded-none border border-ui bg-white p-6 shadow-none">
        <p className="text-[13px] font-bold text-ed-green">Checkout</p>
        <h1 className="font-serif mt-2 text-2xl font-normal tracking-tight text-ed-ink">Paket belum tersedia</h1>
        <p className="mt-2 text-[17px] leading-relaxed text-ed-muted">
          Checkout harus dimulai dari paket dan studio yang sesuai.
        </p>
        {error && (
          <div className="mt-5">
            <AlertBanner tone="danger" title="Checkout belum dapat dimuat" message={error} />
          </div>
        )}
        <ButtonLink className="mt-5 min-h-[44px]" href="/packages">
          Lihat paket
        </ButtonLink>
      </section>
    );
  }

  return (
    <main className="space-y-6 pt-2" aria-labelledby="checkout-title">
      <header>
        <Link
          href={`/packages?branch=${encodeURIComponent(options.package.branchId)}`}
          className="inline-flex items-center gap-2 text-sm font-semibold text-ed-forest hover:text-ed-green no-underline min-h-[44px]"
        >
          <ArrowLeft className="size-4" />
          Kembali ke paket
        </Link>
        <p className="mt-5 text-[13px] font-bold text-ed-green">
          Checkout aman
        </p>
        <h1 id="checkout-title" className="font-serif mt-2 text-2xl font-normal tracking-tight text-ed-ink sm:text-3xl">
          Ringkasan pembelian
        </h1>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-ed-muted">
          Periksa paket dan studio sebelum membuat pesanan. Nominal transfer terverifikasi akan
          ditampilkan setelah pesanan berhasil dibuat.
        </p>
      </header>

      {error && (
        <AlertBanner
          tone="danger"
          title={
            errorCode === 'CUSTOMER_VERIFICATION_REQUIRED' ||
            errorCode === 'IDENTITY_VERIFICATION_REQUIRED'
              ? 'Pembelian paket belum bisa diproses'
              : 'Pesanan belum berhasil dibuat'
          }
          message={
            errorCode === 'CUSTOMER_VERIFICATION_REQUIRED' ||
            errorCode === 'IDENTITY_VERIFICATION_REQUIRED'
              ? 'Identitas kamu belum diverifikasi. Isi data verifikasi dulu, sekitar 2 menit.'
              : error
          }
          action={
            errorCode === 'CUSTOMER_VERIFICATION_REQUIRED' ||
            errorCode === 'IDENTITY_VERIFICATION_REQUIRED'
              ? {
                  label: 'Isi data verifikasi',
                  onSelect: () => {
                    const checkoutDestination = `/checkout?package=${packageId}${branchId ? `&branch=${branchId}` : ''}${selectedClassTypeId ? `&classType=${selectedClassTypeId}` : ''}${slot ? `&slot=${encodeURIComponent(slot)}` : ''}`;
                    window.location.assign(
                      `/account/verification?returnTo=${encodeURIComponent(checkoutDestination)}`,
                    );
                  },
                }
              : undefined
          }
        />
      )}

      <ol
        aria-label="Tahapan checkout"
        className="grid grid-cols-2 gap-2 rounded-none border border-ed-line bg-white p-2.5 sm:grid-cols-4"
      >
        {['Ringkasan', 'Pembayaran', 'Unggah bukti', 'Status'].map((label, index) => (
          <li
            key={label}
            aria-current={index === 0 ? 'step' : undefined}
            className={`flex items-center gap-2.5 rounded-none px-3 py-2 text-xs font-semibold sm:text-sm ${
              index === 0 ? 'bg-ed-forest text-white' : 'text-ed-muted bg-ed-tint/30'
            }`}
          >
            <span className="grid size-5 place-items-center rounded-none border border-current font-serif text-[11px]">
              {index + 1}
            </span>
            <span className="tracking-tight">{label}</span>
          </li>
        ))}
      </ol>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(320px,.85fr)]">
        <section className="rounded-none border border-ed-line bg-white p-5 shadow-none sm:p-6">
          <p className="text-[13px] font-bold text-ed-green">
            Paket dipilih
          </p>
          <h2 className="font-serif mt-3 text-2xl font-normal tracking-tight text-ed-ink">{options.package.name}</h2>
          <p className="mt-1 text-sm text-ed-muted">
            {options.package.classTypes.find((item) => item.id === selectedClassTypeId)?.name ??
              'Pilih jenis kelas'}{' '}
            · {options.package.isMultiBranch ? 'Semua Cabang (Multi-Branch)' : options.package.branchName}
          </p>

          {options.package.classTypes.length > 1 && (
            <div className="mt-5 max-w-md">
              <SearchSelect
                label="Jenis kelas"
                description="Pilih satu jenis kelas yang akan digunakan untuk paket ini."
                value={selectedClassTypeId}
                placeholder="Pilih jenis kelas"
                options={options.package.classTypes.map((item) => ({
                  id: item.id,
                  label: item.name,
                }))}
                onChange={(value) => {
                  setSelectedClassTypeId(value);
                  setVoucherPreview(null);
                  setVoucherError('');
                }}
              />
            </div>
          )}
          <dl className="mt-6 grid gap-3 sm:grid-cols-3">
            <div className="rounded-none border border-ed-line/70 bg-ed-tint/40 p-4">
              <dt className="text-[13px] font-medium text-ed-muted">Jumlah sesi</dt>
              <dd className="mt-1 font-serif text-lg text-ed-ink">{options.package.sessionCount} sesi</dd>
            </div>
            <div className="rounded-none border border-ed-line/70 bg-ed-tint/40 p-4">
              <dt className="text-[13px] font-medium text-ed-muted">Masa berlaku</dt>
              <dd className="mt-1 font-serif text-lg text-ed-ink">{options.package.durationDays} hari</dd>
            </div>
            <div className="rounded-none border border-ed-line/70 bg-ed-tint/40 p-4">
              <dt className="text-[13px] font-medium text-ed-muted">Harga paket</dt>
              <dd className="mt-2">
                <PackagePrice
                  priceRp={options.package.priceRp}
                  effectivePriceRp={options.package.effectivePriceRp}
                  promotion={options.package.promotion}
                  compact
                />
              </dd>
            </div>
          </dl>
        </section>

        <aside className="rounded-none border border-ed-line bg-ed-tint/60 p-5 sm:p-6">
          <ShieldCheck className="size-7 text-ed-forest" />
          <h2 className="font-serif mt-3 text-lg font-normal tracking-tight text-ed-ink">Transfer manual terverifikasi</h2>
          <ul className="mt-4 space-y-3 text-sm leading-relaxed text-ed-muted">
            <li className="flex gap-2">
              <Check className="mt-1 size-4 shrink-0 text-ed-green" />
              Rekening tujuan disimpan sebagai snapshot pesanan.
            </li>
            <li className="flex gap-2">
              <Check className="mt-1 size-4 shrink-0 text-ed-green" />
              Tiga digit terakhir pada nominal digunakan sebagai identifikasi transfer.
            </li>
            <li className="flex gap-2">
              <Check className="mt-1 size-4 shrink-0 text-ed-green" />
              Bukti pembayaran diperiksa privat oleh Finance.
            </li>
          </ul>
          <p className="mt-4 text-xs leading-relaxed text-ed-muted">
            Jangan transfer sebelum pesanan berhasil dibuat dan nominal pembayaran sudah muncul.
          </p>
        </aside>
      </div>

      <section className="rounded-none border border-ed-line bg-white p-5 shadow-none sm:p-6">
        <h2 className="font-serif text-lg font-normal tracking-tight text-ed-ink">Punya voucher?</h2>
        <p className="mt-1 text-sm text-ed-muted">
          Masukkan kode voucher sebelum membuat pesanan. Diskon dihitung otomatis oleh sistem.
        </p>
        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
          <TextInput
            label="Kode voucher"
            value={voucherCode}
            onChange={(event) => {
              setVoucherCode(event.target.value.toUpperCase());
              setVoucherPreview(null);
              setVoucherError('');
            }}
            placeholder="Contoh: WELCOME10"
            wrapperClassName="sm:flex-1"
          />
          <Button
            type="button"
            variant="secondary"
            disabled={
              voucherBusy || !effectiveBranchId || !selectedClassTypeId || voucherCode.trim().length < 3
            }
            loading={voucherBusy}
            onClick={async () => {
              setVoucherBusy(true);
              setVoucherError('');
              try {
                if (!effectiveBranchId) {
                  setVoucherPreview(null);
                  setVoucherError('Cabang checkout tidak valid.');
                  return;
                }

                const result = await browserOrderClient.previewVoucher(
                  packageId,
                  effectiveBranchId,
                  selectedClassTypeId,
                  voucherCode,
                );
                setVoucherPreview(result);
                feedback.showToast({
                  tone: 'success',
                  title: 'Voucher berhasil diterapkan',
                  message: `Hemat ${formatRupiah(result.discountRp)} untuk pesanan Anda.`,
                });
              } catch (cause) {
                setVoucherPreview(null);
                const message = orderError(cause);
                setVoucherError(message);
                feedback.showToast({
                  tone: 'danger',
                  title: 'Voucher tidak dapat digunakan',
                  message,
                });
              } finally {
                setVoucherBusy(false);
              }
            }}
          >
            Terapkan voucher
          </Button>
        </div>
        {voucherError && (
          <div className="mt-3">
            <AlertBanner
              tone="danger"
              title="Voucher tidak dapat digunakan"
              message={voucherError}
            />
          </div>
        )}
        {voucherPreview && (
          <dl className="mt-4 grid gap-2 rounded-none border border-ed-line bg-ed-tint/40 p-4 text-sm sm:grid-cols-4">
            {voucherPreview.packagePromotionDiscountRp > 0 && (
              <div>
                <dt className="text-xs text-ed-muted">Promo paket</dt>
                <dd className="font-semibold text-ed-forest">
                  -{formatRupiah(voucherPreview.packagePromotionDiscountRp)}
                </dd>
              </div>
            )}
            <div>
              <dt className="text-xs text-ed-muted">Voucher</dt>
              <dd className="font-semibold text-ed-ink">{voucherPreview.code}</dd>
            </div>
            <div>
              <dt className="text-xs text-ed-muted">Diskon</dt>
              <dd className="font-semibold text-ed-forest">
                -{formatRupiah(voucherPreview.discountRp)}
                {voucherPreview.discountType === 'PERCENTAGE' && voucherPreview.discountValue ? (
                  <span className="ml-1 text-xs font-bold text-amber-800">
                    ({voucherPreview.discountValue}%)
                  </span>
                ) : null}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-ed-muted">Total setelah diskon</dt>
              <dd className="font-semibold text-ed-ink">
                {formatRupiah(voucherPreview.priceAfterDiscountRp)}
              </dd>
            </div>
          </dl>
        )}
      </section>

      <StickyActionBar
        description={
          <p>Pesanan memiliki batas pembayaran {options.paymentAccount.paymentWindowHours} jam.</p>
        }
        className="border-ed-line/70"
      >
        <Button
          type="button"
          size="lg"
          fullWidth
          disabled={!selectedClassTypeId}
          loading={submitting}
          loadingLabel="Membuat pesanan…"
          trailingIcon={<ArrowRight className="size-4" aria-hidden="true" />}
          className="sm:min-w-80"
          onClick={async () => {
            const confirmed = await feedback.confirm({
              title: 'Buat pesanan ini?',
              message: `${options.package.name} di ${options.package.branchName} akan dibuat. Setelah itu Anda memperoleh rekening dan nominal pembayaran.`,
              confirmLabel: 'Buat pesanan',
            });
            if (!confirmed) return;
            setSubmitting(true);
            setError('');
            try {
              const created = await browserOrderClient.create(
                packageId,
                slot,
                effectiveBranchId,
                selectedClassTypeId,
                voucherPreview?.code,
                options.package,
              );
              setOrder(created);
              router.replace(`/checkout?order=${encodeURIComponent(created.id)}`);
              feedback.showToast({
                tone: 'success',
                title: 'Pesanan berhasil dibuat',
                message: 'Silakan transfer sesuai nominal yang ditampilkan.',
              });
            } catch (cause) {
              const details = orderErrorDetails(cause);
              setError(details.message);
              setErrorCode(details.code);
              feedback.showToast({
                tone: 'danger',
                title: 'Pesanan belum berhasil dibuat',
                message: details.message,
              });
            } finally {
              setSubmitting(false);
            }
          }}
        >
          Buat pesanan dan lanjutkan pembayaran
        </Button>
      </StickyActionBar>
    </main>
  );
}
