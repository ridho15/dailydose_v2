import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { OrderDetailView } from './order-detail-view';
import { browserOrderClient, type CustomerOrder } from '@/api-clients/order-client';
import { AppFeedbackProvider } from '../../components/app-feedback';

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
}));

const mockOrder: CustomerOrder = {
  id: '40000000-0000-4000-8000-000000017358',
  branchId: 'branch-surabaya',
  branchName: 'Daily Dose Graha Family Surabaya',
  branchTimezone: 'Asia/Jakarta',
  packageId: 'package-drop-in',
  packageName: 'Drop In Private Class',
  priceRp: 675_000,
  baseAmountRp: 675_000,
  paymentUniqueCode: 376,
  payableAmountRp: 675_376,
  sessionCount: 1,
  durationDays: 30,
  status: 'REJECTED',
  submittedAt: new Date('2026-10-31T06:00:00Z'),
  decidedAt: new Date('2026-10-31T06:30:00Z'),
  expiresAt: new Date('2026-11-01T06:00:00Z'),
  continuationSlotId: null,
  paymentProofId: 'proof-123',
  paymentProofStatus: { uploadStatus: 'FINALIZED', scanStatus: 'CLEAN' },
  decisionReasonCode: 'AMOUNT_MISMATCH',
  timelineComplete: true,
  version: 1,
  activation: null,
  paymentAccount: null,
  timeline: {
    items: [
      {
        id: 'timeline-1',
        type: 'ORDER_CREATED',
        occurredAt: new Date('2026-10-31T06:00:00Z'),
        reasonCode: null,
        derived: false,
      },
      {
        id: 'timeline-2',
        type: 'PROOF_SUBMITTED',
        occurredAt: new Date('2026-10-31T06:15:00Z'),
        reasonCode: null,
        derived: false,
      },
      {
        id: 'timeline-3',
        type: 'PAYMENT_REJECTED',
        occurredAt: new Date('2026-10-31T06:30:00Z'),
        reasonCode: 'AMOUNT_MISMATCH',
        derived: false,
      },
    ],
    page: { hasMore: false, nextCursor: null },
  },
};

describe('OrderDetailView', () => {
  it('renders order summary, rejection banner, recovery actions, and structured timeline for REJECTED order', async () => {
    vi.spyOn(browserOrderClient, 'detail').mockResolvedValueOnce(mockOrder);

    render(
      <AppFeedbackProvider>
        <OrderDetailView id={mockOrder.id} />
      </AppFeedbackProvider>,
    );

    // Header & Order Summary
    expect(await screen.findByRole('heading', { level: 1, name: 'Drop In Private Class' })).toBeVisible();
    expect(screen.getByText('Ditolak')).toBeVisible();

    // Rejection Banner and Timeline
    expect(screen.getAllByText('Pembayaran ditolak').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText(/Nominal transfer tidak sesuai/).length).toBeGreaterThanOrEqual(2);

    // Timeline section
    expect(screen.getByText('Timeline pembayaran')).toBeVisible();
    expect(screen.getByRole('list', { name: 'Timeline pesanan' })).toBeVisible();
    expect(screen.getByText('Pesanan dibuat')).toBeVisible();
    expect(screen.getByText('Bukti pembayaran diterima')).toBeVisible();
    expect(screen.getAllByText('Pembayaran ditolak').length).toBeGreaterThanOrEqual(1);

    // Action buttons
    expect(screen.getByRole('link', { name: 'Buat pesanan baru' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Hubungi studio via WhatsApp' })).toBeVisible();
  });

  it('renders fallback when timeline has no items', async () => {
    vi.spyOn(browserOrderClient, 'detail').mockResolvedValueOnce({
      ...mockOrder,
      timeline: undefined,
    });

    render(
      <AppFeedbackProvider>
        <OrderDetailView id={mockOrder.id} />
      </AppFeedbackProvider>,
    );

    expect(await screen.findByText('Belum ada histori yang dapat ditampilkan.')).toBeVisible();
  });
});
