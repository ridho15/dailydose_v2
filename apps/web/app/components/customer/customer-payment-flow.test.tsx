import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { browserOrderClient, type CustomerOrder } from '@/api-clients/order-client';
import { AppFeedbackProvider } from '../app-feedback';
import { CustomerPaymentFlow } from './customer-payment-flow';

const order: CustomerOrder = {
  id: 'order-1',
  branchId: 'branch-1',
  branchName: 'Daily Dose BSD',
  packageId: 'package-1',
  packageName: 'Reformer Pilates 10',
  priceRp: 1_730_000,
  baseAmountRp: 1_730_000,
  paymentUniqueCode: 377,
  payableAmountRp: 1_730_377,
  sessionCount: 10,
  durationDays: 90,
  status: 'PENDING',
  submittedAt: new Date('2026-07-28T00:00:00Z'),
  decidedAt: null,
  expiresAt: new Date('2026-07-29T00:00:00Z'),
  continuationSlotId: null,
  paymentProofId: 'proof-1',
  paymentProofStatus: { uploadStatus: 'FINALIZED', scanStatus: 'CLEAN' },
  decisionReasonCode: null,
  timelineComplete: true,
  version: 1,
  activation: null,
  paymentAccount: null,
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('customer payment proof preview', () => {
  it('loads, renders, closes, and revokes the customer-owned image preview', async () => {
    vi.spyOn(browserOrderClient, 'loadProof').mockResolvedValue(
      new Blob(['proof'], { type: 'image/png' }),
    );
    const createObjectURL = vi.fn().mockReturnValue('blob:customer-proof');
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL });

    render(
      <AppFeedbackProvider>
        <CustomerPaymentFlow order={order} onUpdated={vi.fn()} />
      </AppFeedbackProvider>,
    );
    const user = userEvent.setup();

    expect(screen.getByText('Bukti pembayaran yang dikirim')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Lihat bukti pembayaran' }));

    expect(browserOrderClient.loadProof).toHaveBeenCalledWith('order-1');
    expect(await screen.findByRole('img', { name: 'Bukti pembayaran yang dikirim' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Tutup preview' }));
    expect(screen.queryByRole('img', { name: 'Bukti pembayaran yang dikirim' })).toBeNull();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:customer-proof');
  });

  it('keeps preview disabled while the proof scan is pending', () => {
    render(
      <AppFeedbackProvider>
        <CustomerPaymentFlow
          order={{
            ...order,
            paymentProofStatus: { uploadStatus: 'FINALIZED', scanStatus: 'PENDING' },
          }}
          onUpdated={vi.fn()}
        />
      </AppFeedbackProvider>,
    );

    expect(screen.getByRole('button', { name: 'Lihat bukti pembayaran' })).toBeDisabled();
    expect(
      screen.getByText('Preview tersedia setelah pemeriksaan keamanan selesai.'),
    ).toBeVisible();
  });

  it('renders payment verification SLA and operational hours when payment is pending', () => {
    render(
      <AppFeedbackProvider>
        <CustomerPaymentFlow order={order} onUpdated={vi.fn()} />
      </AppFeedbackProvider>,
    );

    expect(screen.getByText('Pembayaran sedang diperiksa')).toBeVisible();
    expect(
      screen.getByText(/Pemeriksaan bukti pembayaran biasanya memakan waktu 15–30 menit/),
    ).toBeVisible();
    expect(screen.getByText('Estimasi verifikasi: 15–30 menit')).toBeVisible();
  });

  it('renders Tiket T-07 payment layout with 30 px nominal, copy buttons with feedback, order code warning, and server deadline', async () => {
    const awaitingOrder: CustomerOrder = {
      ...order,
      status: 'AWAITING_PAYMENT',
      expiresAt: new Date(Date.now() + 2 * 3600 * 1000),
      paymentProofId: null,
      paymentProofStatus: null,
      paymentAccount: {
        bankName: 'BCA',
        accountNumber: '1234567890',
        accountHolderName: 'PT DAILY DOSE INDONESIA',
      },
    };

    render(
      <AppFeedbackProvider>
        <CustomerPaymentFlow order={awaitingOrder} onUpdated={vi.fn()} />
      </AppFeedbackProvider>,
    );

    const user = userEvent.setup();

    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    // 1. Kartu Ringkasan Paket
    expect(screen.getByText('Ringkasan pesanan')).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Reformer Pilates 10' })).toBeVisible();

    // 2. Kartu LANGKAH 1, TRANSFER TEPAT SEJUMLAH INI
    expect(screen.getByText('LANGKAH 1, TRANSFER TEPAT SEJUMLAH INI')).toBeVisible();
    const payableAmount = screen.getByTestId('payable-amount');
    expect(payableAmount).toBeVisible();
    expect(payableAmount).toHaveClass('text-[30px]');

    // Satu baris peringatan kode pesanan
    expect(
      screen.getByText(/Tiga angka terakhir adalah kode pesanan dan transfer harus pas/),
    ).toBeVisible();

    // Tombol Salin nominal dengan feedback visual
    const copyNominalBtn = screen.getByRole('button', { name: 'Salin nominal' });
    expect(copyNominalBtn).toBeVisible();
    await user.click(copyNominalBtn);
    expect(writeText).toHaveBeenCalledWith('1730377');
    expect(screen.getByText('Tersalin ✓')).toBeVisible();

    // Rekening tujuan dan Tombol Salin nomor rekening dengan feedback visual
    expect(screen.getByTestId('account-number')).toHaveTextContent('1234567890');
    expect(screen.getByText(/PT DAILY DOSE INDONESIA/)).toBeVisible();
    const copyAccountBtn = screen.getByRole('button', { name: 'Salin nomor rekening' });
    expect(copyAccountBtn).toBeVisible();
    await user.click(copyAccountBtn);
    expect(writeText).toHaveBeenCalledWith('1234567890');

    // 3. Kartu LANGKAH 2, UNGGAH BUKTI TRANSFER
    expect(screen.getByText('LANGKAH 2, UNGGAH BUKTI TRANSFER')).toBeVisible();
    expect(screen.getByText('Ambil foto atau pilih dari galeri')).toBeVisible();
    expect(
      screen.getAllByText(/Format JPEG, PNG, atau PDF · Maksimal 10 MB/).length,
    ).toBeGreaterThanOrEqual(1);

    // 4. Kartu Batas Waktu Pembayaran
    expect(screen.getByText('BATAS WAKTU PEMBAYARAN')).toBeVisible();
    expect(screen.getByText('Batas Waktu Transfer')).toBeVisible();
    expect(
      screen.getByText(
        /Jika melewati batas waktu ini, pesanan akan otomatis dibatalkan dan kode pembayaran kedaluwarsa/,
      ),
    ).toBeVisible();
  });

  it('allows switching to QRIS tab when awaiting payment, displaying QRIS code and WhatsApp link', async () => {
    const awaitingOrder: CustomerOrder = {
      ...order,
      status: 'AWAITING_PAYMENT',
      paymentProofId: null,
      paymentProofStatus: null,
      paymentAccount: {
        bankName: 'BCA',
        accountNumber: '1234567890',
        accountHolderName: 'PT DAILY DOSE INDONESIA',
      },
    };

    render(
      <AppFeedbackProvider>
        <CustomerPaymentFlow order={awaitingOrder} onUpdated={vi.fn()} />
      </AppFeedbackProvider>,
    );

    const user = userEvent.setup();

    // Switch to QRIS tab
    await user.click(screen.getByRole('tab', { name: /QRIS Instan/ }));
    expect(screen.getByText('Scan QRIS Instan')).toBeVisible();
    expect(screen.getByLabelText('QRIS Code Daily Dose Pilates')).toBeInTheDocument();
    expect(screen.getByText('Nominal Otomatis Terdeteksi')).toBeVisible();
    expect(screen.getByRole('link', { name: /Konfirmasi via WhatsApp CS/i })).toHaveAttribute(
      'href',
      expect.stringContaining('wa.me'),
    );
  });

  it('renders rejection alert banner and actionable recovery buttons when order is REJECTED', () => {
    const rejectedOrder: CustomerOrder = {
      ...order,
      status: 'REJECTED',
      decisionReasonCode: 'AMOUNT_MISMATCH',
    };

    render(
      <AppFeedbackProvider>
        <CustomerPaymentFlow order={rejectedOrder} onUpdated={vi.fn()} />
      </AppFeedbackProvider>,
    );

    // Alert Banner should show rejection title and reason
    expect(screen.getByText('Pembayaran ditolak')).toBeVisible();
    expect(screen.getByText(/Nominal transfer tidak sesuai/)).toBeVisible();

    // Recovery action buttons should be available (no dead end)
    expect(screen.getByRole('link', { name: 'Buat pesanan baru' })).toBeVisible();
    expect(
      screen.getByRole('link', { name: 'Hubungi studio via WhatsApp' }),
    ).toBeVisible();
  });
});


