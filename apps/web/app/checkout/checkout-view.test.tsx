import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CheckoutView } from './checkout-view';
import { AppFeedbackProvider } from '../components/app-feedback';
import { OrderClientError, orderErrorDetails } from '@/api-clients/order-client';

const mockSearchParams = vi.hoisted(() => new Map<string, string>());
const mockRouter = vi.hoisted(() => ({
  replace: vi.fn(),
  push: vi.fn(),
}));
const mockSession = vi.hoisted(() => ({
  session: {
    userId: 'user-1',
    displayName: 'Gerald Customer',
    roles: ['CUSTOMER'],
    identityVerificationStatus: 'ACTION_REQUIRED',
    preferredBranch: { id: 'branch-1' },
  },
  status: 'authenticated',
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => ({
    get: (key: string) => mockSearchParams.get(key) ?? null,
  }),
}));

vi.mock('../components/app-loading', () => ({
  useTrackedRouter: () => mockRouter,
  foregroundFetch: vi.fn(),
}));

vi.mock('../session-context', () => ({
  useSessionContext: () => mockSession,
}));

vi.mock('@/api-clients/order-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api-clients/order-client')>();
  return {
    ...actual,
    browserOrderClient: {
      checkout: vi.fn(),
      detail: vi.fn(),
      create: vi.fn(),
      previewVoucher: vi.fn(),
    },
  };
});

import { browserOrderClient } from '@/api-clients/order-client';

describe('CheckoutView verification gate (Tiket T-01)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockSearchParams.clear();
    mockSearchParams.set('package', 'package-reformer-10');
    mockSearchParams.set('branch', 'branch-1');
    mockSession.session.identityVerificationStatus = 'ACTION_REQUIRED';
  });

  it('renders verification gate with polite non-jargon copy when backend returns CUSTOMER_VERIFICATION_REQUIRED', async () => {
    vi.mocked(browserOrderClient.checkout).mockRejectedValueOnce(
      new OrderClientError('CUSTOMER_VERIFICATION_REQUIRED'),
    );

    render(
      <AppFeedbackProvider>
        <CheckoutView />
      </AppFeedbackProvider>,
    );

    expect(await screen.findByRole('heading', { name: 'Pembelian paket belum bisa diproses' })).toBeVisible();
    expect(
      screen.getByText('Identitas kamu belum diverifikasi. Isi data verifikasi dulu, sekitar 2 menit.'),
    ).toBeVisible();

    const verificationBtn = screen.getByRole('link', { name: 'Isi data verifikasi' });
    expect(verificationBtn).toBeVisible();
    expect(verificationBtn.getAttribute('href')).toContain('/account/verification?returnTo=');
    expect(verificationBtn.getAttribute('href')).toContain('package%3Dpackage-reformer-10');

    const backBtn = screen.getByRole('link', { name: 'Kembali ke paket' });
    expect(backBtn).toBeVisible();
    expect(backBtn.getAttribute('href')).toBe('/packages');
  });

  it('renders pending status verification gate when customer verification is PENDING', async () => {
    mockSession.session.identityVerificationStatus = 'PENDING';
    vi.mocked(browserOrderClient.checkout).mockRejectedValueOnce(
      new OrderClientError('CUSTOMER_VERIFICATION_REQUIRED'),
    );

    render(
      <AppFeedbackProvider>
        <CheckoutView />
      </AppFeedbackProvider>,
    );

    expect(await screen.findByRole('heading', { name: 'Verifikasi identitas sedang diproses' })).toBeVisible();
    expect(
      screen.getByText('Data kamu sedang diperiksa tim studio. Kami kabari lewat WhatsApp kalau sudah selesai.'),
    ).toBeVisible();

    const checkStatusBtn = screen.getByRole('link', { name: 'Lihat status verifikasi' });
    expect(checkStatusBtn).toBeVisible();
    expect(checkStatusBtn.getAttribute('href')).toContain('/account/verification?returnTo=');
  });

  it('renders verification gate even if packageId query parameter is omitted', async () => {
    mockSearchParams.clear();
    mockSession.session.identityVerificationStatus = 'ACTION_REQUIRED';

    render(
      <AppFeedbackProvider>
        <CheckoutView />
      </AppFeedbackProvider>,
    );

    expect(await screen.findByRole('heading', { name: 'Pembelian paket belum bisa diproses' })).toBeVisible();
    const verificationBtn = screen.getByRole('link', { name: 'Isi data verifikasi' });
    expect(verificationBtn).toBeVisible();
    expect(verificationBtn.getAttribute('href')).toContain('returnTo=%2Fpackages');
  });

  it('never leaks raw technical error codes in user facing error alert', async () => {
    mockSession.session.identityVerificationStatus = 'APPROVED';
    vi.mocked(browserOrderClient.checkout).mockRejectedValueOnce(
      new OrderClientError('UNMAPPED_INTERNAL_EXCEPTION_CODE'),
    );

    render(
      <AppFeedbackProvider>
        <CheckoutView />
      </AppFeedbackProvider>,
    );

    expect(await screen.findByRole('heading', { name: 'Paket belum tersedia' })).toBeVisible();
    expect(screen.queryByText(/UNMAPPED_INTERNAL_EXCEPTION_CODE/)).toBeNull();
    expect(
      screen.getByText('Layanan pesanan belum dapat memproses permintaan. Silakan coba kembali.'),
    ).toBeVisible();
  });
});

describe('CheckoutView Voucher Non-Happy Path', () => {
  const dummyOptions = {
    package: {
      id: 'pkg-1',
      name: 'Paket Pilates 10 Sesi',
      priceRp: 1500000,
      effectivePriceRp: 1500000,
      version: 1,
      promotion: null,
      sessionCount: 10,
      durationDays: 30,
      branchId: 'branch-1',
      branchName: 'Daily Dose Menteng',
      classTypes: [{ id: 'ct-1', name: 'Reformer' }],
    },
    paymentAccount: {
      id: 'pa-1',
      bankName: 'BCA',
      accountNumber: '1234567890',
      accountHolderName: 'PT Daily Dose Pilates',
      paymentWindowHours: 24,
    },
  };

  beforeEach(() => {
    vi.resetAllMocks();
    mockSearchParams.clear();
    mockSearchParams.set('package', 'pkg-1');
    mockSearchParams.set('branch', 'branch-1');
    mockSession.session.identityVerificationStatus = 'APPROVED';
    vi.mocked(browserOrderClient.checkout).mockResolvedValue(dummyOptions);
  });

  it('displays local voucher error inside the voucher section and avoids global misleading order error banner', async () => {
    const user = userEvent.setup();
    vi.mocked(browserOrderClient.previewVoucher).mockRejectedValueOnce(
      new OrderClientError('VOUCHER_EXPIRED'),
    );

    render(
      <AppFeedbackProvider>
        <CheckoutView />
      </AppFeedbackProvider>,
    );

    expect(await screen.findByRole('heading', { name: 'Ringkasan pembelian' })).toBeVisible();

    const voucherInput = screen.getByPlaceholderText('Contoh: WELCOME10');
    await user.type(voucherInput, 'EXPIRED10');
    expect((voucherInput as HTMLInputElement).value).toBe('EXPIRED10');

    const applyButton = screen.getByRole('button', { name: 'Terapkan voucher' });
    expect(applyButton).toBeEnabled();
    await user.click(applyButton);
    expect(browserOrderClient.previewVoucher).toHaveBeenCalled();

    const errorElements = await screen.findAllByText('Kode voucher telah kedaluwarsa.');
    expect(errorElements.length).toBeGreaterThan(0);
    expect(screen.getAllByText('Voucher tidak dapat digunakan').length).toBeGreaterThan(0);

    // Top order error banner should NOT be rendered
    expect(screen.queryByText('Pesanan belum berhasil dibuat')).toBeNull();

    const voucherSection = voucherInput.closest('section')!;
    expect(voucherSection).toHaveTextContent('Kode voucher telah kedaluwarsa.');

    // Typing a new voucher code clears the error inside the voucher section
    await user.clear(voucherInput);
    await user.type(voucherInput, 'NEWCODE');
    expect(voucherSection).not.toHaveTextContent('Kode voucher telah kedaluwarsa.');
  });

  it('translates VOUCHER_NOT_APPLICABLE and detailed issues correctly in orderErrorDetails', () => {
    const errorWithDetail = new OrderClientError(
      'VOUCHER_NOT_APPLICABLE',
      undefined,
      false,
      undefined,
      [{ field: 'voucherCode', issue: 'EXPIRED' }],
    );
    expect(orderErrorDetails(errorWithDetail).message).toBe('Kode voucher telah kedaluwarsa.');

    const errorMinSpend = new OrderClientError(
      'VOUCHER_NOT_APPLICABLE',
      undefined,
      false,
      undefined,
      [{ field: 'voucherCode', issue: 'MINIMUM_SPEND_NOT_MET' }],
    );
    expect(orderErrorDetails(errorMinSpend).message).toBe(
      'Total belanja belum memenuhi syarat minimum voucher.',
    );

    const errorExhausted = new OrderClientError('VOUCHER_QUOTA_EXHAUSTED');
    expect(orderErrorDetails(errorExhausted).message).toBe(
      'Kuota penggunaan voucher telah habis.',
    );
  });
});
