import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  browserPurchaseClient,
  browserPurchaseReviewClient,
  mapActivationSummary,
  mapApprovalResult,
  mapPackage,
  mapPaymentProof,
  mapPurchase,
  mapReviewDetail,
  mapReviewItem,
  purchaseFailure,
  toDate,
  toOptionalDate,
} from './purchase-client';

const mockResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

describe('Purchase client Date hydration and mappings (Tahap 3)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Date hydration unit helpers', () => {
    it('toDate converts ISO string or preserves Date', () => {
      const iso = '2026-07-23T10:00:00.000Z';
      const parsed = toDate(iso);
      expect(parsed).toBeInstanceOf(Date);
      expect(parsed.toISOString()).toBe(iso);

      const existingDate = new Date('2026-01-01T00:00:00.000Z');
      expect(toDate(existingDate)).toBe(existingDate);
    });

    it('toOptionalDate returns null for nullish and Date for string', () => {
      expect(toOptionalDate(null)).toBeNull();
      expect(toOptionalDate(undefined)).toBeNull();
      expect(toOptionalDate('')).toBeNull();

      const iso = '2026-08-01T12:00:00.000Z';
      const parsed = toOptionalDate(iso);
      expect(parsed).toBeInstanceOf(Date);
      expect(parsed?.toISOString()).toBe(iso);
    });

    it('mapPackage properly hydrates effectiveFrom and effectiveUntil', () => {
      const raw = {
        id: 'pkg-1',
        name: 'Paket 10 Sesi',
        sessionCount: 10,
        durationDays: 30,
        priceRp: 1500000,
        status: 'ACTIVE',
        effectiveFrom: '2026-01-01T00:00:00.000Z',
        effectiveUntil: '2026-12-31T23:59:59.000Z',
      };

      const mapped = mapPackage(raw);
      expect(mapped.effectiveFrom).toBeInstanceOf(Date);
      expect(mapped.effectiveUntil).toBeInstanceOf(Date);
      expect(mapped.effectiveFrom.toISOString()).toBe('2026-01-01T00:00:00.000Z');
      expect(mapped.effectiveUntil?.toISOString()).toBe('2026-12-31T23:59:59.000Z');
    });

    it('mapReviewItem properly hydrates review dates and nested activation summary', () => {
      const raw = {
        id: 'purchase-1',
        branchId: 'branch-1',
        userId: 'user-1',
        packageId: 'pkg-1',
        packageNameSnapshot: 'Paket 10 Sesi',
        priceRpSnapshot: 1500000,
        sessionCountSnapshot: 10,
        durationDaysSnapshot: 30,
        status: 'PENDING',
        submittedAt: '2026-07-23T14:30:00.000Z',
        paymentExpiresAt: '2026-07-24T14:30:00.000Z',
        decidedAt: null,
        auditReference: null,
        version: 1,
        customer: { id: 'cust-1', displayName: 'Jane', phoneMasked: '+62•••' },
        branch: { id: 'branch-1', code: 'SBY', name: 'Surabaya', timezone: 'Asia/Jakarta' },
        paymentProof: {
          id: 'proof-1',
          uploadStatus: 'FINALIZED',
          scanStatus: 'CLEAN',
          mimeType: 'image/jpeg',
          sizeBytes: 2048,
          finalizedAt: '2026-07-23T14:32:00.000Z',
        },
        activationSummary: {
          customerPackageId: 'cpkg-1',
          status: 'ACTIVE',
          activationDate: '2026-07-23T14:35:00.000Z',
          expiryAt: '2026-08-22T14:35:00.000Z',
          sessionCount: 10,
          ledgerBalance: 10,
          reserved: 0,
          available: 10,
          used: 0,
        },
      };

      const mapped = mapReviewItem(raw);
      expect(mapped.submittedAt).toBeInstanceOf(Date);
      expect(mapped.paymentExpiresAt).toBeInstanceOf(Date);
      expect(mapped.decidedAt).toBeNull();
      expect(mapped.paymentProof?.finalizedAt).toBeInstanceOf(Date);
      expect(mapped.activationSummary?.activationDate).toBeInstanceOf(Date);
      expect(mapped.activationSummary?.expiryAt).toBeInstanceOf(Date);
      expect(typeof mapped.activationSummary?.activationDate.toLocaleDateString).toBe('function');
    });

    it('mapReviewDetail properly hydrates timeline, activation, and usage history', () => {
      const raw = {
        purchase: {
          id: 'purchase-1',
          branchId: 'branch-1',
          userId: 'user-1',
          packageId: 'pkg-1',
          packageNameSnapshot: 'Paket 10 Sesi',
          priceRpSnapshot: 1500000,
          sessionCountSnapshot: 10,
          durationDaysSnapshot: 30,
          status: 'APPROVED',
          submittedAt: '2026-07-23T14:30:00.000Z',
          decidedAt: '2026-07-23T15:00:00.000Z',
          auditReference: 'AUD-001',
          version: 2,
          customer: { id: 'cust-1', displayName: 'Jane', phoneMasked: '+62•••' },
          branch: { id: 'branch-1', code: 'SBY', name: 'Surabaya', timezone: 'Asia/Jakarta' },
          paymentProof: null,
          activationSummary: null,
        },
        timeline: {
          submittedAt: '2026-07-23T14:30:00.000Z',
          proofFinalizedAt: '2026-07-23T14:32:00.000Z',
          decidedAt: '2026-07-23T15:00:00.000Z',
        },
        decisionActorMasked: 'Staf •123456',
        activation: {
          customerPackageId: 'cpkg-1',
          packageId: 'pkg-1',
          packageName: 'Paket 10 Sesi',
          status: 'ACTIVE',
          sessionCount: 10,
          activationDate: '2026-07-23T15:00:00.000Z',
          expiryAt: '2026-08-22T15:00:00.000Z',
          ledgerEntryId: 'led-1',
          ledgerQuantity: 10,
          ledgerOccurredAt: '2026-07-23T15:00:00.000Z',
        },
        balance: null,
        usageHistory: {
          items: [
            {
              id: 'use-1',
              type: 'ATTEND',
              label: 'Booking: Pilates Reformer',
              quantity: -1,
              balanceAfter: 9,
              occurredAt: '2026-07-24T10:00:00.000Z',
            },
          ],
          page: { nextCursor: null, hasMore: false },
        },
      };

      const mapped = mapReviewDetail(raw);
      expect(mapped.timeline.submittedAt).toBeInstanceOf(Date);
      expect(mapped.timeline.proofFinalizedAt).toBeInstanceOf(Date);
      expect(mapped.timeline.decidedAt).toBeInstanceOf(Date);
      expect(mapped.activation?.activationDate).toBeInstanceOf(Date);
      expect(mapped.activation?.expiryAt).toBeInstanceOf(Date);
      expect(mapped.activation?.ledgerOccurredAt).toBeInstanceOf(Date);
      expect(mapped.usageHistory.items[0]?.occurredAt).toBeInstanceOf(Date);
      expect(typeof mapped.usageHistory.items[0]?.occurredAt.toLocaleString).toBe('function');
    });
  });

  describe('browserPurchaseClient integration', () => {
    it('list packages returns items with hydrated Date objects', async () => {
      const mockRawPackages = [
        {
          id: 'pkg-101',
          name: 'Paket Reformer Intro',
          sessionCount: 5,
          durationDays: 14,
          priceRp: 800000,
          status: 'ACTIVE',
          effectiveFrom: '2026-05-01T00:00:00.000Z',
          effectiveUntil: null,
        },
      ];

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        mockResponse({ items: mockRawPackages, page: { nextCursor: null } }),
      );

      const result = await browserPurchaseClient.list('branch-sby');
      expect(result.items).toHaveLength(1);
      expect(result.items[0]!.effectiveFrom).toBeInstanceOf(Date);
      expect(result.items[0]!.effectiveUntil).toBeNull();
      expect(result.items[0]!.effectiveFrom.getFullYear()).toBe(2026);
    });
  });

  describe('browserPurchaseReviewClient integration', () => {
    it('list returns review items and generatedAt as Date instances', async () => {
      const mockPage = {
        items: [
          {
            id: 'purch-1',
            branchId: 'branch-1',
            userId: 'user-1',
            packageId: 'pkg-1',
            packageNameSnapshot: 'Paket Test',
            priceRpSnapshot: 500000,
            sessionCountSnapshot: 4,
            durationDaysSnapshot: 14,
            status: 'PENDING',
            submittedAt: '2026-07-25T08:00:00.000Z',
            customer: { id: 'c-1', displayName: 'Budi', phoneMasked: '+62•••' },
            branch: { id: 'b-1', code: 'SBY', name: 'Surabaya', timezone: 'Asia/Jakarta' },
            paymentProof: null,
            activationSummary: null,
            auditReference: null,
            version: 1,
          },
        ],
        page: { nextCursor: null },
        summary: {
          pending: 1,
          actionRequired: 0,
          approved: 0,
          rejected: 0,
          expired: 0,
          totalAmountRp: 500000,
        },
        generatedAt: '2026-07-25T08:05:00.000Z',
      };

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(mockResponse(mockPage));

      const result = await browserPurchaseReviewClient.list({ branchId: 'branch-1' });
      expect(result.items[0]!.submittedAt).toBeInstanceOf(Date);
      expect(result.generatedAt).toBeInstanceOf(Date);
    });

    it('detail returns completely hydrated ReviewDetail', async () => {
      const mockDetail = {
        purchase: {
          id: 'purch-1',
          branchId: 'branch-1',
          userId: 'user-1',
          packageId: 'pkg-1',
          packageNameSnapshot: 'Paket Test',
          priceRpSnapshot: 500000,
          sessionCountSnapshot: 4,
          durationDaysSnapshot: 14,
          status: 'APPROVED',
          submittedAt: '2026-07-25T08:00:00.000Z',
          decidedAt: '2026-07-25T08:30:00.000Z',
          customer: { id: 'c-1', displayName: 'Budi', phoneMasked: '+62•••' },
          branch: { id: 'b-1', code: 'SBY', name: 'Surabaya', timezone: 'Asia/Jakarta' },
          paymentProof: null,
          activationSummary: null,
          auditReference: 'AUD-002',
          version: 2,
        },
        timeline: {
          submittedAt: '2026-07-25T08:00:00.000Z',
          proofFinalizedAt: '2026-07-25T08:10:00.000Z',
          decidedAt: '2026-07-25T08:30:00.000Z',
        },
        decisionActorMasked: 'Staf •999999',
        activation: {
          customerPackageId: 'cpkg-9',
          packageId: 'pkg-1',
          packageName: 'Paket Test',
          status: 'ACTIVE',
          sessionCount: 4,
          activationDate: '2026-07-25T08:30:00.000Z',
          expiryAt: '2026-08-08T08:30:00.000Z',
          ledgerEntryId: 'led-9',
        },
        balance: null,
        usageHistory: { items: [], page: { nextCursor: null } },
      };

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(mockResponse(mockDetail));

      const result = await browserPurchaseReviewClient.detail('purch-1');
      expect(result.purchase.submittedAt).toBeInstanceOf(Date);
      expect(result.timeline.submittedAt).toBeInstanceOf(Date);
      expect(result.timeline.proofFinalizedAt).toBeInstanceOf(Date);
      expect(result.timeline.decidedAt).toBeInstanceOf(Date);
      expect(result.activation?.activationDate).toBeInstanceOf(Date);
      expect(result.activation?.expiryAt).toBeInstanceOf(Date);
    });
  });
  describe("purchaseFailure error translation", () => {
    it("maps PAYMENT_PROOF_REQUIRED accurately from ApiError", () => {
      const error = {
        name: "ApiError",
        status: 409,
        code: "PAYMENT_PROOF_REQUIRED",
        data: { error: { code: "PAYMENT_PROOF_REQUIRED" } },
      };
      expect(purchaseFailure(error)).toBe(
        "Bukti transfer belum diunggah oleh pelanggan. Minta pelanggan mengunggah bukti atau unggah bukti manual melalui menu Periksa Detail sebelum menyetujui.",
      );
    });

    it("maps PAYMENT_EXPIRED accurately from ApiError", () => {
      const error = {
        name: "ApiError",
        status: 409,
        code: "PAYMENT_EXPIRED",
        data: { error: { code: "PAYMENT_EXPIRED" } },
      };
      expect(purchaseFailure(error)).toBe(
        "Batas waktu pembayaran telah kedaluwarsa. Transaksi transfer bank ini tidak dapat disetujui.",
      );
    });

    it("maps PURCHASE_ALREADY_DECIDED accurately", () => {
      const error = {
        name: "ApiError",
        status: 409,
        code: "PURCHASE_ALREADY_DECIDED",
        data: { error: { code: "PURCHASE_ALREADY_DECIDED" } },
      };
      expect(purchaseFailure(error)).toBe(
        "Purchase ini sudah memiliki keputusan atau sudah disetujui sebelumnya.",
      );
    });

    it("maps CONCURRENCY_CONFLICT accurately", () => {
      const error = {
        name: "ApiError",
        status: 409,
        code: "CONCURRENCY_CONFLICT",
        data: { error: { code: "CONCURRENCY_CONFLICT" } },
      };
      expect(purchaseFailure(error)).toBe(
        "Terjadi konflik transaksi bersamaan. Silakan coba kembali.",
      );
    });

    it("falls back to generic 409 message when code is unrecognized", () => {
      const error = {
        name: "ApiError",
        status: 409,
        code: "UNKNOWN_CONFLICT",
      };
      expect(purchaseFailure(error)).toBe("Purchase atau bukti mengalami konflik. Muat ulang.");
    });
  });
});
