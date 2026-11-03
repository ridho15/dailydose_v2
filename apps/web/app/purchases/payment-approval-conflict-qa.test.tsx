import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PurchaseReviewClient } from '@/api-clients/purchase-client';
import { purchaseFailure } from '@/api-clients/purchase-client';
import { notifySessionFailure } from '@/api-clients/session-client';
import { PurchaseReviewView } from '@/purchases/purchase-review-view';
import { PaymentReviewDetailView } from '@/workspace/payments/[id]/payment-review-detail-view';
import { AppFeedbackProvider } from '../components/app-feedback';

const routerPush = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: routerPush, replace: vi.fn() }),
  usePathname: () => '/workspace/payments',
  useSearchParams: () => new URLSearchParams(),
}));

const branch = { id: 'branch-1', name: 'Surabaya', timezone: 'Asia/Jakarta' };

const basePurchase = {
  id: 'purch-everi-1',
  branchId: 'branch-1',
  userId: 'user-everi',
  packageId: 'pkg-1',
  packageNameSnapshot: 'Paket 10 Sesi Pilates',
  priceRpSnapshot: 1_500_000,
  payableAmountRpSnapshot: 1_500_000,
  sessionCountSnapshot: 10,
  durationDaysSnapshot: 30,
  status: 'PENDING' as const,
  paymentMethod: 'BANK_TRANSFER' as const,
  submittedAt: new Date('2026-11-01T10:00:00Z'),
  paymentExpiresAt: new Date(Date.now() + 86400000),
  decidedAt: null,
  version: 1,
  auditReference: null,
  customer: {
    id: 'user-everi',
    displayName: 'Everi',
    phoneMasked: '+62••••8888',
  },
  branch: { id: 'branch-1', code: 'SBY', name: 'Surabaya', timezone: 'Asia/Jakarta' },
  paymentProof: null,
  activationSummary: null,
};

const makeReviewFake = (overrides: Partial<PurchaseReviewClient> = {}): PurchaseReviewClient => ({
  list: vi.fn().mockResolvedValue({
    items: [basePurchase],
    summary: {
      pending: 1,
      actionRequired: 0,
      approved: 0,
      rejected: 0,
      expired: 0,
      totalAmountRp: 1_500_000,
      agingOver24Hours: 1,
    },
    generatedAt: new Date('2026-11-03T02:00:00Z'),
    page: { nextCursor: null, hasMore: false },
  }),
  detail: vi.fn().mockResolvedValue({
    purchase: basePurchase,
    timeline: {
      submittedAt: basePurchase.submittedAt,
      proofFinalizedAt: null,
      decidedAt: null,
    },
    decisionActorMasked: null,
    activation: null,
    balance: null,
    usageHistory: { items: [], page: { nextCursor: null, hasMore: false } },
  }),
  loadProof: vi.fn().mockResolvedValue(new Blob(['fake'], { type: 'image/jpeg' })),
  approve: vi.fn().mockResolvedValue({
    purchase: { ...basePurchase, status: 'APPROVED' },
    customerPackage: { packageName: 'Paket 10 Sesi Pilates', available: 10 },
    ledgerEntry: { id: 'led-1' },
  }),
  reject: vi.fn().mockResolvedValue({ ...basePurchase, status: 'REJECTED' }),
  ...overrides,
});

describe('QA Testing & No-Happy-Path: Payment Approval Conflict Resolution', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Scenario 1: Antrean (Queue) Table - No Happy Path Validation', () => {
    it('QA-01: Displays "Setujui" button even when bank transfer proof is missing, with explanatory tooltip', async () => {
      const client = makeReviewFake();
      render(
        <AppFeedbackProvider>
          <PurchaseReviewView client={client} branchOverride={branch} />
        </AppFeedbackProvider>,
      );

      const approveButtons = await screen.findAllByRole('button', { name: 'Setujui' });
      expect(approveButtons.length).toBeGreaterThan(0);
      const approveBtn = approveButtons[0]!;
      expect(approveBtn).toBeEnabled();
      expect(approveBtn.getAttribute('title')).toContain('Bukti transfer belum diunggah');
    });

    it('QA-02: Clicking "Setujui" on Bank Transfer without proof blocks API call and triggers warning modal', async () => {
      const client = makeReviewFake();
      render(
        <AppFeedbackProvider>
          <PurchaseReviewView client={client} branchOverride={branch} />
        </AppFeedbackProvider>,
      );

      const user = userEvent.setup();
      const approveBtn = (await screen.findAllByRole('button', { name: 'Setujui' }))[0]!;
      await user.click(approveBtn);

      // Verify client.approve was NOT called (preventing 409 Conflict)
      expect(client.approve).not.toHaveBeenCalled();

      // Verify user gets clear, friendly instruction modal
      expect(await screen.findByText('Bukti transfer belum diunggah')).toBeVisible();
      expect(screen.getByText(/Pelanggan Everi belum mengunggah bukti transfer bank/i)).toBeVisible();
    });

    it('QA-03: Clicking "Setujui" on expired Bank Transfer triggers danger alert modal', async () => {
      const expiredPurchase = {
        ...basePurchase,
        id: 'purch-expired',
        paymentExpiresAt: new Date(Date.now() - 3600000), // 1 hour ago
      };
      const client = makeReviewFake({
        list: vi.fn().mockResolvedValue({
          items: [expiredPurchase],
          summary: { pending: 1, actionRequired: 0, approved: 0, rejected: 0, expired: 0, totalAmountRp: 1500000 },
          generatedAt: new Date(),
          page: { nextCursor: null },
        }),
      });

      render(
        <AppFeedbackProvider>
          <PurchaseReviewView client={client} branchOverride={branch} />
        </AppFeedbackProvider>,
      );

      const user = userEvent.setup();
      const approveBtn = (await screen.findAllByRole('button', { name: 'Setujui' }))[0]!;
      await user.click(approveBtn);

      expect(client.approve).not.toHaveBeenCalled();
      expect(await screen.findByText('Batas waktu transfer kedaluwarsa')).toBeVisible();
      expect(screen.getByText(/telah berakhir pada/i)).toBeVisible();
    });
  });

  describe('Scenario 2: Detail View - No Happy Path Validation', () => {
    it('QA-04: Displays "Menunggu Bukti Transfer" notice when proof is null', async () => {
      const client = makeReviewFake();
      render(
        <AppFeedbackProvider>
          <PaymentReviewDetailView id="purch-everi-1" client={client} authorityOverride={{ canReview: true, canDecide: true }} />
        </AppFeedbackProvider>,
      );

      expect(await screen.findByText('Menunggu Bukti Transfer:')).toBeVisible();
      expect(screen.getByText(/Pelanggan belum mengunggah bukti transfer bank/i)).toBeVisible();
    });

    it('QA-05: Clicking "Setujui dan aktifkan paket" on Bank Transfer without proof shows warning alert', async () => {
      const client = makeReviewFake();
      render(
        <AppFeedbackProvider>
          <PaymentReviewDetailView id="purch-everi-1" client={client} authorityOverride={{ canReview: true, canDecide: true }} />
        </AppFeedbackProvider>,
      );

      const user = userEvent.setup();
      const approveBtn = await screen.findByRole('button', { name: 'Setujui pembayaran' });
      await user.click(approveBtn);

      expect(client.approve).not.toHaveBeenCalled();
      expect(await screen.findByText('Bukti transfer belum diunggah')).toBeVisible();
      expect(screen.getByText(/gunakan formulir "Simpan Bukti Manual"/i)).toBeVisible();
    });
  });

  describe('Scenario 3: Error Parser (purchaseFailure) Comprehensive No-Happy-Path', () => {
    it('QA-06: Formats ApiError 409 PAYMENT_PROOF_REQUIRED into actionable instructions', () => {
      const error = {
        name: 'ApiError',
        status: 409,
        code: 'PAYMENT_PROOF_REQUIRED',
        data: { error: { code: 'PAYMENT_PROOF_REQUIRED' } },
      };
      const message = purchaseFailure(error);
      expect(message).toBe(
        'Bukti transfer belum diunggah oleh pelanggan. Minta pelanggan mengunggah bukti atau unggah bukti manual melalui menu Periksa Detail sebelum menyetujui.',
      );
    });

    it('QA-07: Formats ApiError 409 PAYMENT_EXPIRED into clear expired warning', () => {
      const error = {
        name: 'ApiError',
        status: 409,
        code: 'PAYMENT_EXPIRED',
        data: { error: { code: 'PAYMENT_EXPIRED' } },
      };
      const message = purchaseFailure(error);
      expect(message).toBe(
        'Batas waktu pembayaran telah kedaluwarsa. Transaksi transfer bank ini tidak dapat disetujui.',
      );
    });

    it('QA-08: Formats ApiError 409 PURCHASE_ALREADY_DECIDED (race condition / already approved)', () => {
      const error = {
        name: 'ApiError',
        status: 409,
        code: 'PURCHASE_ALREADY_DECIDED',
        data: { error: { code: 'PURCHASE_ALREADY_DECIDED' } },
      };
      const message = purchaseFailure(error);
      expect(message).toBe('Purchase ini sudah memiliki keputusan atau sudah disetujui sebelumnya.');
    });

    it('QA-09: Formats ApiError 409 CONCURRENCY_CONFLICT with retry advice', () => {
      const error = {
        name: 'ApiError',
        status: 409,
        code: 'CONCURRENCY_CONFLICT',
        data: { error: { code: 'CONCURRENCY_CONFLICT' } },
      };
      const message = purchaseFailure(error);
      expect(message).toBe('Terjadi konflik transaksi bersamaan. Silakan coba kembali.');
    });

    it('QA-10: Formats ApiError 409 IDEMPOTENCY_IN_PROGRESS', () => {
      const error = {
        name: 'ApiError',
        status: 409,
        code: 'IDEMPOTENCY_IN_PROGRESS',
      };
      const message = purchaseFailure(error);
      expect(message).toBe('Permintaan sebelumnya masih diproses. Coba lagi tanpa mengubah data.');
    });

    it('QA-11: Fallbacks to generic 409 message if code is completely unknown', () => {
      const error = {
        name: 'ApiError',
        status: 409,
      };
      const message = purchaseFailure(error);
      expect(message).toBe('Purchase atau bukti mengalami konflik. Muat ulang.');
    });

    it('QA-12: notifySessionFailure dispatches dd-session-revoked on 401 ApiError', () => {
      const listener = vi.fn();
      window.addEventListener('dd-session-revoked', listener);

      const error = {
        name: 'ApiError',
        status: 401,
      };
      notifySessionFailure(error);

      expect(listener).toHaveBeenCalled();
      window.removeEventListener('dd-session-revoked', listener);
    });
  });
});
