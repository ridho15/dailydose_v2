'use client';

import Image from 'next/image';
import Link from 'next/link';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Clipboard,
  Clock3,
  Eye,
  FileCheck2,
  FileClock,
  FileQuestion,
  MessageCircle,
  QrCode,
  Smartphone,
  UploadCloud,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  browserOrderClient,
  orderErrorDetails,
  sha256Upload,
  type CustomerOrder,
  type PaymentProofUploadSession,
} from '@/api-clients/order-client';
import { formatPaymentCode, orderReasonLabels, orderStatusLabels } from '@/lib/order-presenters';
import { Button, ButtonLink } from '../actions';
import { compressImageIfNeeded } from '@/lib/image-compression';
import { AlertBanner, useAppFeedback } from '../app-feedback';
import { formatRupiah } from '../../lib/formatters';

const steps = ['Ringkasan', 'Pembayaran', 'Unggah bukti', 'Status'];

function currentStep(
  order: CustomerOrder,
  file: File | null,
  uploadSession?: PaymentProofUploadSession,
) {
  if (['PENDING', 'APPROVED', 'REJECTED', 'EXPIRED'].includes(order.status)) return 4;
  if (order.status === 'ACTION_REQUIRED' || file || uploadSession) return 3;
  return 2;
}

const uploadStageLabels = {
  IDLE: '',
  ISSUING: 'Menyiapkan upload aman…',
  UPLOADING: 'Mengunggah bukti…',
  SCANNING: 'Memeriksa keamanan file…',
  ATTACHING: 'Menghubungkan bukti ke pesanan…',
  COMPLETED: 'Bukti pembayaran diterima.',
} as const;

export function CustomerPaymentFlow({
  order,
  onUpdated,
}: {
  order: CustomerOrder;
  onUpdated(order: CustomerOrder): void;
}) {
  const feedback = useAppFeedback();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState('');
  const [uploadSession, setUploadSession] = useState<PaymentProofUploadSession>();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<ReturnType<typeof orderErrorDetails>>();
  const [proofPreviewUrl, setProofPreviewUrl] = useState('');
  const [proofPreviewType, setProofPreviewType] = useState('');
  const [proofPreviewLoading, setProofPreviewLoading] = useState(false);
  const [proofPreviewError, setProofPreviewError] = useState('');
  const proofPreviewRef = useRef<HTMLDivElement>(null);
  const [paymentMethod, setPaymentMethod] = useState<'BANK_TRANSFER' | 'QRIS'>('BANK_TRANSFER');
  const [copiedField, setCopiedField] = useState<'nominal' | 'account' | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const step = currentStep(order, file, uploadSession);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!file || file.type === 'application/pdf') {
      setPreview('');
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  useEffect(
    () => () => {
      if (proofPreviewUrl) URL.revokeObjectURL(proofPreviewUrl);
    },
    [proofPreviewUrl],
  );
  useEffect(() => {
    if (proofPreviewUrl) proofPreviewRef.current?.focus();
  }, [proofPreviewUrl]);

  const defaultPaymentAccount = useMemo(
    () => ({
      bankName: 'BCA',
      accountNumber: '8040 123 8899',
      accountHolderName: 'PT DAILY DOSE INDONESIA',
    }),
    [],
  );
  const activePaymentAccount = order.paymentAccount ?? defaultPaymentAccount;

  const expiryFormatter = useMemo(() => {
    return new Intl.DateTimeFormat('id-ID', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZoneName: 'short',
      ...(order.branchTimezone ? { timeZone: order.branchTimezone } : {}),
    });
  }, [order.branchTimezone]);

  const remaining = useMemo(
    () => (order.expiresAt ? Math.max(0, order.expiresAt.getTime() - now) : 0),
    [now, order.expiresAt],
  );
  const paymentAccountAvailable = Boolean(
    activePaymentAccount.bankName &&
      activePaymentAccount.accountNumber &&
      activePaymentAccount.accountHolderName,
  );
  const canUpload =
    ['AWAITING_PAYMENT', 'ACTION_REQUIRED'].includes(order.status) &&
    remaining > 0 &&
    (paymentAccountAvailable || paymentMethod === 'QRIS');
  const paymentCode = formatPaymentCode(order.paymentUniqueCode);
  const waMessage = `Halo Daily Dose Pilates, saya ingin konfirmasi pembayaran pesanan:\n- Paket: ${order.packageName}\n- No. Pesanan: ${order.id}\n- Nominal: ${formatRupiah(order.payableAmountRp)}\n- Metode: ${paymentMethod === 'QRIS' ? 'QRIS Instan' : 'Transfer Bank'}\nMohon dibantu verifikasi ya. Terima kasih!`;
  const waUrl = `https://wa.me/6281234567890?text=${encodeURIComponent(waMessage)}`;
  const proofReady =
    order.paymentProofStatus?.uploadStatus === 'FINALIZED' &&
    order.paymentProofStatus.scanStatus === 'CLEAN';
  const proofVisual = proofStatusVisual(order.paymentProofStatus);
  const ProofIcon = proofVisual.icon;
  const duration = {
    hours: Math.floor(remaining / 3_600_000),
    minutes: Math.floor((remaining % 3_600_000) / 60_000),
    seconds: Math.floor((remaining % 60_000) / 1000),
  };
  const durationLabel =
    duration.hours > 0
      ? `${duration.hours} jam ${duration.minutes} menit`
      : duration.minutes > 0
        ? `${duration.minutes} menit`
        : `${duration.seconds} detik`;

  const copyToClipboard = async (
    value: string,
    field: 'nominal' | 'account',
    label: string,
  ) => {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
      } else if (typeof document !== 'undefined') {
        const el = document.createElement('textarea');
        el.value = value;
        el.setAttribute('readonly', '');
        el.style.position = 'absolute';
        el.style.left = '-9999px';
        document.body.appendChild(el);
        el.select();
        document.execCommand('copy');
        document.body.removeChild(el);
      }
      setCopiedField(field);
      feedback.showToast({ tone: 'success', title: `${label} disalin` });
      window.setTimeout(() => {
        setCopiedField((prev) => (prev === field ? null : prev));
      }, 2000);
    } catch {
      feedback.showToast({ tone: 'danger', title: `Gagal menyalin ${label.toLowerCase()}` });
    }
  };

  const copy = async (value: string, label: string) => {
    await copyToClipboard(value, 'nominal', label);
  };

  const closeProofPreview = () => {
    setProofPreviewUrl('');
    setProofPreviewType('');
    setProofPreviewError('');
  };

  const loadProofPreview = async () => {
    if (!proofReady) return;
    setProofPreviewLoading(true);
    setProofPreviewError('');
    setProofPreviewUrl('');
    setProofPreviewType('');
    try {
      const blob = await browserOrderClient.loadProof(order.id);
      if (!['image/jpeg', 'image/png', 'application/pdf'].includes(blob.type)) {
        setProofPreviewUrl('');
        setProofPreviewType(blob.type);
        setProofPreviewError('Format bukti pembayaran tidak didukung untuk preview.');
        return;
      }
      setProofPreviewType(blob.type);
      setProofPreviewUrl(URL.createObjectURL(blob));
    } catch (cause) {
      setProofPreviewError(orderErrorDetails(cause).message);
    } finally {
      setProofPreviewLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <ol
        aria-label="Tahapan checkout"
        className="grid grid-cols-2 gap-2 rounded-none border border-ed-line bg-white p-2.5 sm:grid-cols-4"
      >
        {steps.map((label, index) => {
          const number = index + 1;
          const complete = number < step;
          const active = number === step;
          return (
            <li
              key={label}
              aria-current={active ? 'step' : undefined}
              className={`flex items-center gap-2.5 rounded-none px-3 py-2 text-xs font-semibold sm:text-sm ${
                active
                  ? 'bg-ed-forest text-white'
                  : complete
                    ? 'border border-ed-line bg-ed-tint text-ed-forest'
                    : 'text-ed-muted bg-ed-tint/30'
              }`}
            >
              <span className="grid size-5 shrink-0 place-items-center rounded-none border border-current font-serif text-[13px]">
                {complete ? <Check className="size-3.5" /> : number}
              </span>
              <span className="tracking-tight">{label}</span>
            </li>
          );
        })}
      </ol>

      {order.status === 'ACTION_REQUIRED' && (
        <AlertBanner
          tone="warning"
          title="Bukti pembayaran perlu diperbaiki"
          message={
            orderReasonLabels[order.decisionReasonCode ?? ''] ??
            'Unggah bukti pengganti pada pesanan yang sama.'
          }
        />
      )}
      {order.status === 'PENDING' && (
        <AlertBanner
          tone="info"
          title="Pembayaran sedang diperiksa"
          message="Bukti sudah diterima. Pemeriksaan bukti pembayaran biasanya memakan waktu 15–30 menit pada jam kerja studio (07.00 – 21.00 WIB). Anda akan menerima notifikasi begitu paket aktif."
        />
      )}
      {order.status === 'APPROVED' && (
        <AlertBanner
          tone="success"
          title="Pembayaran disetujui"
          message="Paket sudah aktif dan dapat digunakan untuk booking kelas."
        />
      )}
      {order.status === 'EXPIRED' && (
        <AlertBanner
          tone="danger"
          title="Pesanan kedaluwarsa"
          message="Batas transfer sudah berakhir. Buat pesanan baru untuk memperoleh nominal pembayaran baru."
        />
      )}
      {order.status === 'REJECTED' && (
        <AlertBanner
          tone="danger"
          title="Pembayaran ditolak"
          message={
            order.decisionReasonCode && orderReasonLabels[order.decisionReasonCode]
              ? `Alasan penolakan: ${orderReasonLabels[order.decisionReasonCode]}. Anda dapat membuat pesanan baru atau menghubungi studio untuk bantuan.`
              : 'Bukti pembayaran ditolak oleh tim verifikasi. Anda dapat membuat pesanan baru atau menghubungi studio untuk informasi lebih lanjut.'
          }
        />
      )}
      {failure && (
        <AlertBanner
          tone="danger"
          title={
            failure.stage === 'ISSUING'
              ? 'Upload belum dapat disiapkan'
              : failure.stage === 'UPLOADING'
                ? 'File belum selesai diunggah'
                : failure.stage === 'SCANNING'
                  ? 'Pemeriksaan file belum selesai'
                  : failure.stage === 'ATTACHING'
                    ? 'Bukti belum terhubung ke pesanan'
                    : 'Upload belum berhasil'
          }
          message={`${failure.message}${
            failure.correlationReference
              ? ` Referensi bantuan: ${failure.correlationReference}.`
              : ''
          }`}
        />
      )}

      {/* Structure per Spesifikasi 5.7: 4 Kartu Berurutan */}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
        {/* Kolom Kiri: Kartu 1, Kartu 2, Kartu 3 */}
        <div className="space-y-6">
          {/* KARTU 1: Ringkasan paket yang dibeli */}
          <section
            className="rounded-none border border-ed-line bg-white p-5 shadow-none sm:p-6"
            aria-labelledby="order-summary-title"
          >
            <p className="text-[13px] font-bold text-ed-green">
              Ringkasan pesanan
            </p>
            <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2
                  id="order-summary-title"
                  className="font-serif text-xl font-normal tracking-tight text-ed-ink sm:text-2xl"
                >
                  {order.packageName}
                </h2>
                <p className="mt-1 text-sm text-ed-muted">
                  {order.branchName} · {order.sessionCount} sesi · {order.durationDays} hari
                </p>
              </div>
              <span className="rounded-none border border-ed-line bg-ed-tint px-2.5 py-0.5 text-[13px] font-bold text-ed-forest">
                {orderStatusLabels[order.status]}
              </span>
            </div>
            <dl className="mt-6 divide-y divide-ed-line rounded-none border border-ed-line">
              <div className="flex items-center justify-between gap-4 px-4 py-3">
                <dt className="text-sm text-ed-muted">Harga paket</dt>
                <dd className="font-semibold text-ed-ink">{formatRupiah(order.baseAmountRp)}</dd>
              </div>
              {order.promotion && (
                <div className="flex items-center justify-between gap-4 px-4 py-3">
                  <dt className="text-sm text-ed-muted">Promo paket · {order.promotion.name}</dt>
                  <dd className="font-semibold text-ed-forest">
                    -{formatRupiah(order.promotion.discountRp)}
                  </dd>
                </div>
              )}
              {order.voucher && (
                <div className="flex items-center justify-between gap-4 px-4 py-3">
                  <dt className="text-sm text-ed-muted">Diskon voucher · {order.voucher.code}</dt>
                  <dd className="font-semibold text-ed-forest">
                    -{formatRupiah(order.voucher.discountRp)}
                  </dd>
                </div>
              )}
              <div className="flex items-center justify-between gap-4 bg-ed-tint/50 px-4 py-4">
                <dt>
                  <span className="block font-semibold text-ed-ink">Total tagihan</span>
                  <span className="mt-1 block text-xs text-ed-muted">
                    {paymentCode
                      ? `Termasuk kode unik pesanan ${paymentCode}`
                      : 'Nominal transfer pas'}
                  </span>
                </dt>
                <dd className="font-serif text-2xl font-normal text-ed-forest">
                  {formatRupiah(order.payableAmountRp)}
                </dd>
              </div>
            </dl>
          </section>

          {/* KARTU 2: LANGKAH 1, TRANSFER TEPAT SEJUMLAH INI (Batas 2 px #396552) */}
          {['AWAITING_PAYMENT', 'ACTION_REQUIRED'].includes(order.status) && (
            <section
              className="rounded-none border-2 border-[#396552] bg-white p-5 shadow-none sm:p-6"
              aria-labelledby="step-1-title"
            >
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ed-line pb-4">
                <div>
                  <p className="text-[13px] font-bold text-ed-green">
                    LANGKAH 1, TRANSFER TEPAT SEJUMLAH INI
                  </p>
                  <h2
                    id="step-1-title"
                    className="font-serif mt-1 text-xl font-normal tracking-tight text-ed-ink"
                  >
                    {paymentMethod === 'BANK_TRANSFER'
                      ? 'Transfer Bank (Manual)'
                      : 'Pembayaran QRIS'}
                  </h2>
                </div>
                <div
                  className="flex rounded-none border border-ed-line bg-ed-tint/50 p-1"
                  role="tablist"
                  aria-label="Pilihan Metode Pembayaran"
                >
                  <button
                    type="button"
                    role="tab"
                    aria-selected={paymentMethod === 'BANK_TRANSFER'}
                    onClick={() => setPaymentMethod('BANK_TRANSFER')}
                    className={`flex items-center gap-1.5 rounded-none px-3 py-2 text-xs font-semibold cursor-pointer transition ${
                      paymentMethod === 'BANK_TRANSFER'
                        ? 'bg-ed-forest text-white'
                        : 'text-ed-ink hover:text-ed-forest'
                    }`}
                  >
                    <Smartphone className="size-4" />
                    <span>Transfer Bank</span>
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={paymentMethod === 'QRIS'}
                    onClick={() => setPaymentMethod('QRIS')}
                    className={`flex items-center gap-1.5 rounded-none px-3 py-2 text-xs font-semibold cursor-pointer transition ${
                      paymentMethod === 'QRIS'
                        ? 'bg-ed-forest text-white'
                        : 'text-ed-ink hover:text-ed-forest'
                    }`}
                  >
                    <QrCode className="size-4" />
                    <span>QRIS Instan</span>
                  </button>
                </div>
              </div>

              {paymentMethod === 'BANK_TRANSFER' ? (
                <div className="mt-5 space-y-5">
                  {/* Nominal 30 px Poppins 600 dengan tombol Salin nominal */}
                  <div className="flex flex-wrap items-center justify-between gap-4 rounded-none border border-ed-line bg-ed-tint/30 p-4">
                    <div>
                      <span className="block text-[13px] font-bold text-ed-muted">
                        Nominal Transfer
                      </span>
                      <strong
                        className="mt-1 block font-sans text-[30px] font-semibold leading-tight text-ed-ink sm:text-[32px]"
                        data-testid="payable-amount"
                      >
                        {formatRupiah(order.payableAmountRp)}
                      </strong>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        copyToClipboard(
                          String(order.payableAmountRp),
                          'nominal',
                          'Nominal transfer',
                        )
                      }
                      className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-none bg-[#396552] px-4 py-2.5 text-xs font-semibold text-white transition hover:bg-[#2c4e3f] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#396552] cursor-pointer"
                      aria-label="Salin nominal"
                    >
                      {copiedField === 'nominal' ? (
                        <>
                          <Check className="size-4 text-emerald-300" aria-hidden="true" />
                          <span>Tersalin ✓</span>
                        </>
                      ) : (
                        <>
                          <Clipboard className="size-4" aria-hidden="true" />
                          <span>Salin nominal</span>
                        </>
                      )}
                    </button>
                  </div>

                  {/* Satu baris peringatan bahwa tiga angka terakhir adalah kode pesanan */}
                  <div className="flex items-start gap-2.5 rounded-none border border-amber-300 bg-amber-50 p-3.5 text-xs text-amber-950">
                    <AlertTriangle
                      className="size-4 shrink-0 text-amber-700 mt-0.5"
                      aria-hidden="true"
                    />
                    <p className="leading-relaxed">
                      Tiga angka terakhir adalah kode pesanan dan transfer harus pas agar verifikasi
                      pembayaran berjalan lancar.
                    </p>
                  </div>

                  {/* Nomor rekening dan tombol Salin nomor rekening */}
                  <div className="rounded-none border border-ed-line bg-white p-4">
                    <div className="flex flex-wrap items-center justify-between gap-4">
                      <div>
                        <span className="block text-[13px] font-bold text-ed-muted">
                          Rekening Tujuan ({activePaymentAccount.bankName})
                        </span>
                        <strong
                          className="mt-1 block font-mono text-xl font-bold tracking-wider text-ed-ink sm:text-2xl"
                          data-testid="account-number"
                        >
                          {activePaymentAccount.accountNumber}
                        </strong>
                        <span className="mt-0.5 block text-xs text-ed-muted">
                          a.n. {activePaymentAccount.accountHolderName}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          copyToClipboard(
                            activePaymentAccount.accountNumber.replace(/\s+/g, ''),
                            'account',
                            'Nomor rekening',
                          )
                        }
                        className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-none border border-[#396552] bg-white px-4 py-2.5 text-xs font-semibold text-[#396552] transition hover:bg-[#e9eee6] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#396552] cursor-pointer"
                        aria-label="Salin nomor rekening"
                      >
                        {copiedField === 'account' ? (
                          <>
                            <Check className="size-4 text-emerald-700" aria-hidden="true" />
                            <span>Tersalin ✓</span>
                          </>
                        ) : (
                          <>
                            <Clipboard className="size-4" aria-hidden="true" />
                            <span>Salin nomor rekening</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                /* QRIS Mode */
                <div className="mt-5 space-y-4">
                  <div className="text-center">
                    <div className="inline-flex items-center gap-2 rounded-none border border-rose-300 bg-rose-50 px-3 py-1 text-xs font-semibold text-rose-700">
                      <span>QRIS</span>
                      <span className="text-rose-300">·</span>
                      <span className="font-semibold text-rose-800">
                        Standar Pembayaran Nasional
                      </span>
                    </div>
                    <h3 className="font-serif mt-2 text-xl font-normal tracking-tight text-ed-ink">
                      Scan QRIS Instan
                    </h3>
                    <p className="text-xs text-ed-muted">
                      NMID: ID1020038829101 · Daily Dose Pilates {order.branchName}
                    </p>
                  </div>

                  <div className="flex flex-col items-center justify-center rounded-none border-2 border-dashed border-ed-line bg-ed-tint/20 p-4 sm:p-5">
                    <div className="flex flex-col items-center rounded-none border border-ed-line bg-white p-4 shadow-none">
                      <QrisSvgPattern />
                      <div className="mt-3 flex items-center gap-1.5 text-[13px] font-semibold text-ed-forest">
                        <CheckCircle2 className="size-3.5 text-ed-forest" />
                        <span>Nominal Otomatis Terdeteksi</span>
                      </div>
                    </div>

                    <div className="mt-4 flex w-full items-center justify-between rounded-none border border-ed-line bg-white p-3">
                      <div>
                        <span className="text-[13px] font-bold text-ed-muted">
                          Nominal Pembayaran
                        </span>
                        <strong className="block font-sans text-lg font-semibold text-ed-forest">
                          {formatRupiah(order.payableAmountRp)}
                        </strong>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          copyToClipboard(
                            String(order.payableAmountRp),
                            'nominal',
                            'Nominal transfer',
                          )
                        }
                        className="inline-flex min-h-[44px] items-center gap-1.5 rounded-none border border-ed-line px-3 py-2 text-xs font-semibold text-ed-ink hover:bg-ed-tint cursor-pointer"
                        aria-label="Salin nominal"
                      >
                        <Clipboard className="size-3.5" />
                        <span>Salin</span>
                      </button>
                    </div>
                  </div>

                  <div className="space-y-1.5 text-xs text-ed-muted">
                    <p className="font-semibold text-ed-ink">Langkah Pembayaran:</p>
                    <ol className="list-decimal list-inside space-y-1 pl-1">
                      <li>Buka aplikasi m-Banking atau E-Wallet Anda.</li>
                      <li>
                        Pilih menu <strong>Scan QR / Bayar QRIS</strong>.
                      </li>
                      <li>Scan kode QR di atas (atau screenshot jika pakai 1 HP).</li>
                      <li>
                        Pastikan penerima <strong>DAILY DOSE PILATES</strong> dan nominal sesuai.
                      </li>
                      <li>Selesaikan pembayaran &amp; simpan bukti pembayaran.</li>
                    </ol>
                  </div>
                </div>
              )}
            </section>
          )}

          {/* KARTU 3: LANGKAH 2, UNGGAH BUKTI TRANSFER */}
          {canUpload && (
            <section
              className="rounded-none border border-ed-line bg-white p-5 shadow-none sm:p-6"
              aria-labelledby="step-2-title"
            >
              <div className="flex items-start gap-3">
                <span className="grid size-11 shrink-0 place-items-center rounded-none border border-ed-line bg-ed-tint text-ed-forest">
                  <UploadCloud className="size-5" aria-hidden="true" />
                </span>
                <div>
                  <p className="text-[13px] font-bold text-ed-green">
                    LANGKAH 2, UNGGAH BUKTI TRANSFER
                  </p>
                  <h2
                    id="step-2-title"
                    className="font-serif mt-1 text-lg font-normal tracking-tight text-ed-ink"
                  >
                    {order.status === 'ACTION_REQUIRED'
                      ? 'Unggah bukti pengganti'
                      : 'Unggah bukti transfer'}
                  </h2>
                  <p className="mt-1 text-xs leading-relaxed text-ed-muted sm:text-sm">
                    Format JPEG, PNG, atau PDF · Maksimal 10 MB. Pastikan nominal dan tujuan
                    transfer terlihat jelas.
                  </p>
                </div>
              </div>

              <div className="mt-5">
                <label
                  htmlFor="proof-upload-input"
                  className="flex min-h-[130px] cursor-pointer flex-col items-center justify-center rounded-none border-2 border-dashed border-ed-border-ui bg-ed-tint/20 p-5 text-center transition hover:border-ed-green hover:bg-ed-tint/40 focus-within:ring-2 focus-within:ring-ed-green"
                >
                  <UploadCloud className="size-8 text-ed-green" aria-hidden="true" />
                  <span className="mt-2.5 inline-flex min-h-[44px] items-center justify-center rounded-none bg-ed-forest px-5 py-2.5 text-xs font-semibold text-white shadow-none hover:bg-ed-deep">
                    Ambil foto atau pilih dari galeri
                  </span>
                  <span className="mt-2 text-xs text-ed-muted">
                    Format JPEG, PNG, atau PDF · Maksimal 10 MB
                  </span>
                  <input
                    id="proof-upload-input"
                    className="sr-only"
                    type="file"
                    accept="image/jpeg,image/png,application/pdf"
                    onChange={(event) => {
                      const selected = event.target.files?.[0] ?? null;
                      if (selected && selected.size > 10_000_000) {
                        setFailure({
                          code: 'PAYMENT_PROOF_TOO_LARGE',
                          message: 'Ukuran file melebihi 10 MB.',
                          correlationReference: undefined,
                          retryable: false,
                          stage: undefined,
                        });
                        setFile(null);
                        setUploadSession(undefined);
                        return;
                      }
                      setFailure(undefined);
                      setUploadSession(undefined);
                      setFile(selected);
                    }}
                  />
                </label>

                {preview && (
                  <Image
                    src={preview}
                    alt="Preview bukti pembayaran"
                    width={720}
                    height={420}
                    unoptimized
                    className="mt-4 max-h-72 w-full rounded-none border border-ed-line object-contain"
                  />
                )}

                {file && (
                  <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-none border border-ed-line bg-white px-4 py-3">
                    <div className="min-w-0">
                      <strong className="block truncate text-sm text-ed-ink">{file.name}</strong>
                      <span className="text-xs text-ed-muted">
                        {(file.size / 1024 / 1024).toFixed(2)} MB
                      </span>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      onClick={() => {
                        setFile(null);
                        setUploadSession(undefined);
                        setFailure(undefined);
                      }}
                    >
                      Ganti file
                    </Button>
                  </div>
                )}

                <p className="mt-4 min-h-5 text-sm text-ed-muted" aria-live="polite" role="status">
                  {busy && uploadSession
                    ? uploadStageLabels[uploadSession.stage]
                    : !file
                      ? 'Pilih bukti pembayaran terlebih dahulu.'
                      : failure?.retryable
                        ? 'File tetap tersimpan pada halaman ini. Coba lagi untuk melanjutkan.'
                        : ''}
                </p>

                <Button
                  type="button"
                  disabled={!file || busy || (failure ? !failure.retryable : false)}
                  fullWidth
                  size="lg"
                  loading={busy}
                  loadingLabel={
                    uploadSession
                      ? uploadStageLabels[uploadSession.stage]
                      : 'Menyiapkan upload aman…'
                  }
                  className="mt-4"
                  onClick={async () => {
                    if (!file) return;
                    setFailure(undefined);
                    setBusy(true);
                    try {
                      const fileToUpload = await compressImageIfNeeded(file);
                      const sha256 = await sha256Upload(fileToUpload);
                      const updated = await browserOrderClient.uploadProof(
                        order,
                        fileToUpload,
                        sha256,
                        uploadSession,
                        setUploadSession,
                      );
                      onUpdated(updated);
                      setFile(null);
                      setUploadSession(undefined);
                      feedback.showToast({
                        tone: 'success',
                        title: 'Bukti pembayaran diterima',
                        message: `Status kini Menunggu pemeriksaan Finance.${
                          updated.correlationReference
                            ? ` Referensi: ${updated.correlationReference}.`
                            : ''
                        }`,
                      });
                    } catch (cause) {
                      setFailure(orderErrorDetails(cause));
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  {failure?.retryable ? 'Coba lagi' : 'Kirim bukti transfer'}
                </Button>
              </div>
            </section>
          )}
        </div>

        {/* Kolom Kanan: Kartu 4 Batas Waktu Pembayaran & Preview Bukti Terkirim */}
        <div className="space-y-6">
          {/* KARTU 4: Batas waktu dengan tanggal dan jam, serta akibat kalau lewat */}
          {['AWAITING_PAYMENT', 'ACTION_REQUIRED'].includes(order.status) && (
            <section
              className="rounded-none border border-amber-300 bg-amber-50/60 p-5 shadow-none sm:p-6"
              aria-labelledby="expiry-card-title"
            >
              <div className="flex items-start gap-3">
                <span className="grid size-11 shrink-0 place-items-center rounded-none border border-amber-300 bg-amber-100 text-amber-900">
                  <Clock3 className="size-5" aria-hidden="true" />
                </span>
                <div>
                  <p className="text-[13px] font-bold text-amber-800">
                    BATAS WAKTU PEMBAYARAN
                  </p>
                  <h2
                    id="expiry-card-title"
                    className="font-serif mt-1 text-lg font-normal tracking-tight text-amber-950"
                  >
                    {remaining > 0 ? `${durationLabel} tersisa` : 'Batas transfer berakhir'}
                  </h2>
                </div>
              </div>

              <div className="mt-4 rounded-none border border-amber-200 bg-white p-3.5 text-xs text-amber-950">
                <span className="block font-bold text-amber-800">
                  Batas Waktu Transfer
                </span>
                <time
                  className="mt-1 block text-sm font-bold text-ed-ink"
                  dateTime={order.expiresAt?.toISOString()}
                >
                  {order.expiresAt
                    ? expiryFormatter.format(order.expiresAt)
                    : 'Waktu server belum tersedia'}
                </time>
              </div>

              <p className="mt-3 text-xs leading-relaxed text-amber-900/90">
                Jika melewati batas waktu ini, pesanan akan otomatis dibatalkan dan kode pembayaran
                kedaluwarsa. Anda perlu membuat pesanan baru.
              </p>

              <div className="mt-5 border-t border-amber-200/80 pt-4">
                <a
                  href={waUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex w-full items-center justify-center gap-2 rounded-none bg-[#208346] hover:bg-[#1a6e3a] px-4 py-2.5 text-xs font-semibold text-white shadow-none transition-colors sm:text-sm"
                >
                  <MessageCircle className="size-4" />
                  <span>Konfirmasi via WhatsApp CS</span>
                </a>
              </div>
            </section>
          )}

          {/* Bagian Bukti Terkirim (jika sudah pernah upload bukti sebelumnya) */}
          {order.paymentProofId && (
            <section
              className="rounded-none border border-ed-line bg-white p-5 shadow-none sm:p-6"
              aria-labelledby="payment-proof-title"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <span
                    className={`grid size-11 shrink-0 place-items-center rounded-none border border-ed-line ${proofVisual.classes}`}
                  >
                    <ProofIcon className="size-5" aria-hidden="true" />
                  </span>
                  <div>
                    <h2
                      id="payment-proof-title"
                      className="font-serif text-lg font-normal tracking-tight text-ed-ink"
                    >
                      Bukti pembayaran yang dikirim
                    </h2>
                    <p className="mt-1 text-sm text-ed-muted">
                      {proofStatusLabel(order.paymentProofStatus)}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {proofPreviewUrl && (
                    <Button
                      type="button"
                      variant="ghost"
                      leadingIcon={<X className="size-4" aria-hidden="true" />}
                      onClick={closeProofPreview}
                    >
                      Tutup preview
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={!proofReady || proofPreviewLoading}
                    loading={proofPreviewLoading}
                    loadingLabel="Memuat bukti…"
                    onClick={() => void loadProofPreview()}
                    leadingIcon={<Eye className="size-4" aria-hidden="true" />}
                  >
                    {proofPreviewUrl ? 'Terbitkan ulang preview' : 'Lihat bukti pembayaran'}
                  </Button>
                </div>
              </div>

              {order.status === 'PENDING' && (
                <div className="mt-4 flex items-start gap-2.5 rounded-none border border-ed-line bg-ed-tint/60 p-3.5 text-xs text-ed-forest sm:text-sm">
                  <Clock3 className="size-4 shrink-0 text-ed-forest mt-0.5" />
                  <div>
                    <p className="font-semibold text-ed-ink">Estimasi verifikasi: 15–30 menit</p>
                    <p className="mt-0.5 text-ed-muted">
                      Tim Finance memverifikasi transaksi setiap hari pukul 07.00 – 21.00 WIB. Begitu
                      diverifikasi, saldo paket Anda otomatis bertambah dan siap dipakai untuk memesan
                      kelas.
                    </p>
                  </div>
                </div>
              )}

              {proofPreviewError && (
                <div className="mt-5">
                  <AlertBanner
                    tone="danger"
                    title="Bukti belum dapat ditampilkan"
                    message={proofPreviewError}
                  />
                </div>
              )}
              {proofPreviewUrl ? (
                <div
                  ref={proofPreviewRef}
                  tabIndex={-1}
                  className="mt-5 outline-none focus-visible:ring-1 focus-visible:ring-ed-forest"
                  role="region"
                  aria-label="Preview bukti pembayaran"
                >
                  {proofPreviewType.startsWith('image/') ? (
                    <img
                      src={proofPreviewUrl}
                      alt="Bukti pembayaran yang dikirim"
                      className="max-h-[34rem] w-full rounded-none border border-ed-line bg-white object-contain"
                    />
                  ) : (
                    <object
                      data={proofPreviewUrl}
                      type={proofPreviewType}
                      title="Bukti pembayaran yang dikirim"
                      className="h-[34rem] w-full rounded-none border border-ed-line bg-white"
                    >
                      <p>Preview PDF tidak didukung browser ini.</p>
                    </object>
                  )}
                </div>
              ) : (
                !proofPreviewError && (
                  <div
                    className="mt-5 rounded-none border border-dashed border-ed-line bg-ed-tint/30 px-5 py-4 text-sm leading-relaxed text-ed-muted"
                    role="status"
                    aria-live="polite"
                  >
                    {proofReady
                      ? 'Pilih “Lihat bukti pembayaran” untuk membuka file privat Anda.'
                      : proofUnavailableLabel(order.paymentProofStatus)}
                  </div>
                )
              )}
            </section>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-3">
        <div className="flex flex-wrap justify-end gap-3">
          {order.status === 'APPROVED' && (
            <>
              <ButtonLink href="/account/packages" variant="secondary">
                Lihat Paket Saya
              </ButtonLink>
              <ButtonLink
                href={
                  order.continuationSlotId
                    ? `/bookings/new?slot=${order.continuationSlotId}`
                    : '/classes#schedule'
                }
              >
                Booking kelas
              </ButtonLink>
            </>
          )}
          {order.status === 'EXPIRED' && (
            <ButtonLink
              href={`/checkout?package=${encodeURIComponent(order.packageId)}&branch=${encodeURIComponent(order.branchId)}${order.continuationSlotId ? `&slot=${encodeURIComponent(order.continuationSlotId)}` : ''}`}
            >
              Buat pesanan baru
            </ButtonLink>
          )}
          {order.status === 'REJECTED' && (
            <>
              <ButtonLink
                href={waUrl}
                variant="secondary"
                target="_blank"
                rel="noopener noreferrer"
              >
                Hubungi studio via WhatsApp
              </ButtonLink>
              <ButtonLink
                href={`/checkout?package=${encodeURIComponent(order.packageId)}&branch=${encodeURIComponent(order.branchId)}${order.continuationSlotId ? `&slot=${encodeURIComponent(order.continuationSlotId)}` : ''}`}
              >
                Buat pesanan baru
              </ButtonLink>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function proofStatusLabel(status: CustomerOrder['paymentProofStatus']) {
  if (!status) return 'Status bukti belum tersedia.';
  if (status.uploadStatus !== 'FINALIZED') return 'Upload bukti belum selesai.';
  if (status.scanStatus === 'CLEAN') return 'Upload selesai · pemeriksaan keamanan bersih.';
  if (status.scanStatus === 'PENDING') return 'Upload selesai · pemeriksaan keamanan berlangsung.';
  if (status.scanStatus === 'REJECTED' || status.scanStatus === 'INFECTED')
    return 'Bukti ditolak oleh pemeriksaan keamanan.';
  return 'Pemeriksaan keamanan bukti mengalami kendala.';
}

function proofStatusVisual(status: CustomerOrder['paymentProofStatus']) {
  if (!status)
    return {
      icon: FileQuestion,
      classes: 'bg-ed-tint/60 text-ed-muted',
    };
  if (status.uploadStatus !== 'FINALIZED' || status.scanStatus === 'PENDING')
    return {
      icon: status.uploadStatus === 'FINALIZED' ? FileClock : UploadCloud,
      classes: 'bg-sky-50 text-sky-800 border-sky-200',
    };
  if (status.scanStatus === 'CLEAN')
    return {
      icon: FileCheck2,
      classes: 'bg-ed-tint text-ed-forest border-ed-line',
    };
  if (['REJECTED', 'INFECTED', 'ERROR'].includes(status.scanStatus))
    return {
      icon: AlertTriangle,
      classes: 'bg-rose-50 text-rose-800 border-rose-200',
    };
  return {
    icon: FileQuestion,
    classes: 'bg-ed-tint/60 text-ed-muted',
  };
}

function proofUnavailableLabel(status: CustomerOrder['paymentProofStatus']) {
  if (!status || status.uploadStatus !== 'FINALIZED')
    return 'Preview tersedia setelah upload selesai.';
  if (status.scanStatus === 'PENDING')
    return 'Preview tersedia setelah pemeriksaan keamanan selesai.';
  if (status.scanStatus === 'REJECTED' || status.scanStatus === 'INFECTED')
    return 'File yang ditolak oleh pemeriksaan keamanan tidak dapat dibuka.';
  return 'Bukti belum dapat dipreview. Coba kembali setelah status pemeriksaan diperbarui.';
}


function QrisSvgPattern() {
  return (
    <svg
      width="180"
      height="180"
      viewBox="0 0 160 160"
      className="size-44 select-none"
      aria-label="QRIS Code Daily Dose Pilates"
      role="img"
    >
      <rect width="160" height="160" fill="white" />
      {/* Top Left Finder Pattern */}
      <rect
        x="10"
        y="10"
        width="38"
        height="38"
        fill="none"
        stroke="#111827"
        strokeWidth="6"
        rx="3"
      />
      <rect x="20" y="20" width="18" height="18" fill="#111827" rx="2" />
      {/* Top Right Finder Pattern */}
      <rect
        x="112"
        y="10"
        width="38"
        height="38"
        fill="none"
        stroke="#111827"
        strokeWidth="6"
        rx="3"
      />
      <rect x="122" y="20" width="18" height="18" fill="#111827" rx="2" />
      {/* Bottom Left Finder Pattern */}
      <rect
        x="10"
        y="112"
        width="38"
        height="38"
        fill="none"
        stroke="#111827"
        strokeWidth="6"
        rx="3"
      />
      <rect x="20" y="122" width="18" height="18" fill="#111827" rx="2" />
      {/* Timing lines & Data Modules pattern */}
      <path
        d="M56 16h6v6h-6zm14 0h6v6h-6zm14 0h6v6h-6zm0 14h6v6h-6zm-14 14h6v6h-6zm28 0h6v6h-6zM16 56h6v6h-6zm0 14h6v6h-6zm0 14h6v6h-6zm14 0h6v6h-6zm14-14h6v6h-6zm14 0h6v6h-6zm14 0h6v6h-6zm14 0h6v6h-6zm14 0h6v6h-6zm14 0h6v6h-6zm14 0h6v6h-6zm14 0h6v6h-6zM56 70h6v6h-6zm28 0h6v6h-6zm28 0h6v6h-6zm-42 14h6v6h-6zm28 0h6v6h-6zm14 14h6v6h-6zm-42 14h6v6h-6zm14 0h6v6h-6zm28 0h6v6h-6zm14 0h6v6h-6zm-28 14h6v6h-6zm28 0h6v6h-6zm-14 14h6v6h-6zm28 0h6v6h-6zm-42 14h6v6h-6zm14 0h6v6h-6zm28 0h6v6h-6zM70 30h6v6h-6zm28 0h6v6h-6zm-14 26h6v6h-6zm14 28h6v6h-6zm28 14h6v6h-6zm-70 14h6v6h-6zm42 14h6v6h-6z"
        fill="#111827"
      />
      {/* Center QRIS Badge */}
      <rect x="60" y="66" width="40" height="20" rx="4" fill="#E11D48" />
      <text
        x="80"
        y="80"
        fill="white"
        fontSize="10"
        fontWeight="bold"
        textAnchor="middle"
        fontFamily="sans-serif"
      >
        QRIS
      </text>
    </svg>
  );
}

