import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PurchaseClient, PurchaseReviewClient } from '@/api-clients/purchase-client';
import type { SessionClient } from '@/api-clients/session-client';
import { PurchaseView } from '@/purchases/purchase-view';
import { paymentRowState, PurchaseReviewView } from '@/purchases/purchase-review-view';
import { PaymentReviewDetailView } from '@/workspace/payments/[id]/payment-review-detail-view';
import { SessionProvider } from '../session-context';
import { AppFeedbackProvider } from '../components/app-feedback';

const routerPush = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: routerPush, replace: vi.fn() }),
  usePathname: () => '/workspace/payments/purchase-1',
  useSearchParams: () => new URLSearchParams(),
}));

const branch = { id: 'branch-1', name: 'Jakarta', timezone: 'Asia/Jakarta' };
const purchase = {
  id: 'purchase-1',
  branchId: 'branch-1',
  userId: 'customer-1',
  packageId: 'package-1',
  paymentProofId: 'proof-1',
  packageNameSnapshot: 'Ten Sessions',
  priceRpSnapshot: 2_000_000,
  sessionCountSnapshot: 10,
  durationDaysSnapshot: 30,
  status: 'PENDING' as const,
  submittedAt: new Date('2026-07-23T02:00:00Z'),
  version: 0,
};
const proof = {
  id: 'proof-1',
  uploadStatus: 'FINALIZED' as const,
  scanStatus: 'CLEAN' as const,
  fileName: 'proof.png',
  mimeType: 'image/png',
  sizeBytes: 1024,
  version: 0,
};
const submissionFake = (overrides: Partial<PurchaseClient> = {}): PurchaseClient => ({
  list: vi.fn().mockResolvedValue({
    items: [
      {
        id: 'package-1',
        branchId: 'branch-1',
        classTypeId: 'class-1',
        classTypeScopes: [
          {
            id: 'package-class-scope-1',
            classTypeId: 'class-1',
            active: true,
          },
        ],
        businessKey: 'PKG-10',
        name: 'Ten Sessions',
        sessionCount: 10,
        durationDays: 30,
        priceRp: 2_000_000,
        status: 'ACTIVE',
        effectiveFrom: new Date('2026-01-01'),
        effectiveUntil: null,
        version: 0,
      },
    ],
    nextCursor: null,
  }),
  issue: vi.fn().mockResolvedValue({ ...proof, uploadStatus: 'ISSUED', scanStatus: 'PENDING' }),
  finalize: vi.fn().mockResolvedValue(proof),
  status: vi.fn().mockResolvedValue(proof),
  replace: vi.fn().mockResolvedValue(undefined),
  submit: vi.fn().mockResolvedValue(purchase),
  ...overrides,
});

const reviewPurchase = {
  ...purchase,
  auditReference: null,
  customer: {
    id: 'customer-1',
    displayName: 'Pelanggan Synthetic',
    phoneMasked: '+62••••1234',
  },
  branch: { id: 'branch-1', code: 'JKT', name: 'Jakarta', timezone: 'Asia/Jakarta' },
  paymentProof: {
    id: 'proof-1',
    uploadStatus: 'FINALIZED' as const,
    scanStatus: 'CLEAN' as const,
    mimeType: 'image/png',
    sizeBytes: 1024,
  },
  activationSummary: null,
};
const reviewFake = (overrides: Partial<PurchaseReviewClient> = {}): PurchaseReviewClient => ({
  list: vi.fn().mockResolvedValue({
    items: [reviewPurchase],
    summary: {
      pending: 1,
      actionRequired: 0,
      approved: 0,
      rejected: 0,
      expired: 0,
      totalAmountRp: 2_000_000,
      agingOver24Hours: 0,
    },
    generatedAt: new Date('2026-07-23T03:00:00Z'),
    page: { nextCursor: null, hasMore: false },
  }),
  detail: vi.fn().mockResolvedValue({
    purchase: reviewPurchase,
    timeline: {
      submittedAt: reviewPurchase.submittedAt,
      proofFinalizedAt: new Date('2026-07-23T02:05:00Z'),
      decidedAt: null,
    },
    decisionActorMasked: null,
    activation: null,
    balance: null,
    usageHistory: { items: [], page: { nextCursor: null, hasMore: false } },
  }),
  loadProof: vi.fn().mockResolvedValue(new Blob(['proof'], { type: 'image/png' })),
  approve: vi.fn().mockResolvedValue({
    purchase: {
      ...purchase,
      status: 'APPROVED',
      version: 1,
      auditReference: 'audit-approval',
    },
    customerPackage: {
      id: 'customer-package-1',
      branchId: 'branch-1',
      customerUserId: 'customer-1',
      packageId: 'package-1',
      classTypeId: 'class-1',
      packageName: 'Ten Sessions',
      branchName: 'Jakarta',
      status: 'ACTIVE',
      activationDate: new Date('2026-07-23'),
      expiryAt: new Date('2026-08-22T00:00:00Z'),
      ledgerBalance: 10,
      reserved: 0,
      available: 10,
      salePriceRp: 2_000_000,
      sessionCountSnapshot: 10,
      durationDaysSnapshot: 30,
      projectionRateRp: 200_000,
      version: 0,
    },
    ledgerEntry: {
      id: 'ledger-1',
      customerPackageId: 'customer-package-1',
      type: 'PURCHASE',
      quantity: 10,
      referenceType: 'PURCHASE',
      referenceId: 'purchase-1',
      occurredAt: new Date('2026-07-23T03:00:00Z'),
    },
    idempotentReplay: false,
  }),
  reject: vi.fn().mockResolvedValue({
    ...purchase,
    status: 'REJECTED',
    version: 1,
    auditReference: 'audit-rejection',
  }),
  ...overrides,
});

beforeEach(() => {
  window.history.replaceState({}, '', '/workspace/payments');
});

describe('purchase submission workspace', () => {
  it('requires an explicit branch', () => {
    render(
      <PurchaseView client={submissionFake()} access={{ isCustomer: true, canSubmit: true }} />,
    );
    expect(screen.getByText('Cabang aktif wajib dipilih secara eksplisit.')).toBeVisible();
  });

  it('selects a package, hashes a real file and submits one stable intent accessibly', async () => {
    const client = submissionFake();
    const view = render(
      <PurchaseView
        client={client}
        branchOverride={branch}
        digestFile={vi.fn().mockResolvedValue('a'.repeat(64))}
        access={{ isCustomer: true, canSubmit: true }}
      />,
    );
    const user = userEvent.setup();
    const loadPackages = screen.getByRole('button', { name: 'Muat paket' });
    expect(loadPackages).toHaveClass(
      'min-h-11',
      'border-dd-forest/25',
      'bg-white',
      'text-dd-forest',
    );
    await user.click(loadPackages);
    await user.click(await screen.findByRole('radio', { name: /Ten Sessions/ }));
    await user.upload(
      screen.getByLabelText('Bukti pembayaran'),
      new File(['proof'], 'proof.png', { type: 'image/png' }),
    );
    const upload = screen.getByRole('button', { name: 'Unggah dan periksa' });
    expect(upload).toHaveClass('min-h-11', 'bg-dd-forest', 'text-white');
    await user.click(upload);
    expect(await screen.findByText('Bersih')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Kirim pengajuan' }));
    expect(client.submit).toHaveBeenCalledWith(
      'package-1',
      'proof-1',
      'branch-1',
      'class-1',
      expect.any(String),
    );
    expect(await screen.findByText(/Status pembelian: Sedang diperiksa/)).toBeVisible();
    expect((await axe(view.container)).violations).toHaveLength(0);
  });

  it('polls pending proof and never enables submit before CLEAN', async () => {
    const client = submissionFake({
      finalize: vi.fn().mockResolvedValue({ ...proof, scanStatus: 'PENDING' }),
    });
    render(
      <PurchaseView
        client={client}
        branchOverride={branch}
        digestFile={vi.fn().mockResolvedValue('a'.repeat(64))}
        access={{ isCustomer: true, canSubmit: true }}
      />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Muat paket' }));
    await user.click(await screen.findByRole('radio', { name: /Ten Sessions/ }));
    await user.upload(
      screen.getByLabelText('Bukti pembayaran'),
      new File(['proof'], 'proof.png', { type: 'image/png' }),
    );
    await user.click(screen.getByRole('button', { name: 'Unggah dan periksa' }));
    expect(screen.queryByRole('button', { name: 'Kirim pengajuan' })).not.toBeInTheDocument();
    const scanStatus = await screen.findByRole('button', { name: 'Periksa status scan' });
    expect(scanStatus).toHaveClass('min-h-10', 'border-dd-forest/25', 'bg-white');
    await user.click(scanStatus);
    expect(await screen.findByRole('button', { name: 'Kirim pengajuan' })).toBeEnabled();
  });

  it('styles cursor pagination as a secondary action', async () => {
    const client = submissionFake({
      list: vi.fn().mockResolvedValue({
        items: [],
        nextCursor: 'next-page',
      }),
    });
    render(
      <PurchaseView
        client={client}
        branchOverride={branch}
        access={{ isCustomer: true, canSubmit: true }}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Muat paket' }));
    expect(await screen.findByRole('button', { name: 'Muat paket berikutnya' })).toHaveClass(
      'min-h-11',
      'border-dd-forest/25',
      'bg-white',
      'text-dd-forest',
    );
  });
});

describe('purchase internal review workspace', () => {
  it('links queue rows to dedicated detail and supports private preview plus quick approval', async () => {
    const client = reviewFake();
    const createObjectURL = vi.fn().mockReturnValue('blob:proof');
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL });
    const view = render(<PurchaseReviewView client={client} branchOverride={branch} />);
    const user = userEvent.setup();
    const detailLinks = await screen.findAllByRole('link', { name: 'Periksa detail' });
    expect(detailLinks[0]).toHaveAttribute(
      'href',
      expect.stringContaining('/workspace/payments/purchase-1?returnTo='),
    );
    await user.click((await screen.findAllByRole('button', { name: 'Preview bukti' }))[0]!);
    expect(client.loadProof).toHaveBeenCalledWith('proof-1');
    const dialog = screen.getByRole('dialog', { name: 'Bukti pembayaran Pelanggan Synthetic' });
    expect(
      await within(dialog).findByRole('img', { name: 'Bukti pembayaran Pelanggan Synthetic' }),
    ).toBeVisible();
    await user.click((await screen.findAllByRole('button', { name: 'Setujui' }))[0]!);
    expect(client.approve).toHaveBeenCalledWith('purchase-1', 0, expect.any(String));
    expect((await axe(view.container)).violations).toHaveLength(0);
    expect(createObjectURL).toHaveBeenCalled();
  });

  it('supports quick approval directly from queue for WAITING_VERIFICATION status', async () => {
    const waitingItem = {
      ...reviewPurchase,
      id: 'purchase-waiting-quick',
      status: 'WAITING_VERIFICATION' as const,
    };
    const client = reviewFake({
      list: vi.fn().mockResolvedValue({
        items: [waitingItem],
        summary: {
          pending: 1,
          actionRequired: 0,
          approved: 0,
          rejected: 0,
          expired: 0,
          totalAmountRp: 2_000_000,
          agingOver24Hours: 0,
        },
        generatedAt: new Date('2026-07-23T03:00:00Z'),
        page: { nextCursor: null, hasMore: false },
      }),
    });
    render(<PurchaseReviewView client={client} branchOverride={branch} />);
    const user = userEvent.setup();
    const approveButtons = await screen.findAllByRole('button', { name: 'Setujui' });
    expect(approveButtons[0]).toBeVisible();
    // Bukti transfer wajib dibuka dulu: tombol terkunci sampai Preview bukti dibuka.
    expect(approveButtons[0]).toBeDisabled();
    await user.click(approveButtons[0]!);
    expect(client.approve).not.toHaveBeenCalled();
    await user.click((await screen.findAllByRole('button', { name: 'Preview bukti' }))[0]!);
    expect(client.loadProof).toHaveBeenCalledWith('proof-1');
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Setujui' })[0]).toBeEnabled());
    await user.click(screen.getAllByRole('button', { name: 'Setujui' })[0]!);
    expect(client.approve).toHaveBeenCalledWith('purchase-waiting-quick', 0, expect.any(String));
  });

  it('displays transaction summary and enables in-modal approval only after checking the verification checkbox', async () => {
    const waitingItem = {
      ...reviewPurchase,
      id: 'purchase-modal-test',
      status: 'WAITING_VERIFICATION' as const,
    };
    const client = reviewFake({
      list: vi.fn().mockResolvedValue({
        items: [waitingItem],
        summary: {
          pending: 1,
          actionRequired: 0,
          approved: 0,
          rejected: 0,
          expired: 0,
          totalAmountRp: 2_000_000,
          agingOver24Hours: 0,
        },
        generatedAt: new Date('2026-07-23T03:00:00Z'),
        page: { nextCursor: null, hasMore: false },
      }),
    });
    render(<PurchaseReviewView client={client} branchOverride={branch} />);
    const user = userEvent.setup();
    await user.click((await screen.findAllByRole('button', { name: 'Preview bukti' }))[0]!);
    expect(await screen.findByText('Konfirmasi Pemeriksaan:')).toBeVisible();
    const modalApproveBtn = screen.getByRole('button', { name: /Setujui dan Aktifkan Paket/i });
    expect(modalApproveBtn).toBeDisabled();
    const checkbox = screen.getByRole('checkbox');
    await user.click(checkbox);
    expect(modalApproveBtn).toBeEnabled();
    await user.click(modalApproveBtn);
    expect(client.approve).toHaveBeenCalledWith('purchase-modal-test', 0, expect.any(String));
  });

  it('keeps approval enabled for purchases without a transfer proof', async () => {
    const noProof = { ...reviewPurchase, id: 'purchase-no-proof', paymentProof: null };
    const client = reviewFake({
      list: vi.fn().mockResolvedValue({
        items: [noProof],
        summary: {
          pending: 1,
          actionRequired: 0,
          approved: 0,
          rejected: 0,
          expired: 0,
          totalAmountRp: 2_000_000,
          agingOver24Hours: 0,
        },
        generatedAt: new Date('2026-07-23T03:00:00Z'),
        page: { nextCursor: null, hasMore: false },
      }),
    });
    render(<PurchaseReviewView client={client} branchOverride={branch} />);
    expect((await screen.findAllByRole('button', { name: 'Setujui' }))[0]).toBeEnabled();
  });

  it('uses authoritative package state for semantic row color precedence', () => {
    const active = {
      ...reviewPurchase,
      status: 'APPROVED' as const,
      activationSummary: {
        customerPackageId: 'customer-package-1',
        status: 'ACTIVE' as const,
        activationDate: new Date('2026-07-01'),
        expiryAt: new Date('2026-08-01T00:00:00Z'),
        sessionCount: 10,
        ledgerBalance: 0,
        reserved: 0,
        available: 0,
        used: 10,
      },
    };
    expect(paymentRowState(active, new Date('2026-07-20T00:00:00Z'))).toBe('success');
    expect(
      paymentRowState(
        { ...active, activationSummary: { ...active.activationSummary, status: 'EXPIRED' } },
        new Date('2026-08-02T00:00:00Z'),
      ),
    ).toBe('danger');
    expect(paymentRowState(reviewPurchase, new Date('2026-07-20T00:00:00Z'))).toBe('warning');
    expect(
      paymentRowState(
        { ...reviewPurchase, status: 'AWAITING_PAYMENT' },
        new Date('2026-07-20T00:00:00Z'),
      ),
    ).toBe('neutral');
  });

  it('renders a dedicated decision page with system timeline and controlled rejection', async () => {
    const client = reviewFake();
    render(
      <PaymentReviewDetailView
        id="purchase-1"
        returnTo="/workspace/payments?status=PENDING"
        client={client}
        decisionDelayMs={0}
        authorityOverride={{ canReview: true, canDecide: true }}
      />,
    );
    const user = userEvent.setup();
    expect(await screen.findByRole('heading', { name: 'Detail pembayaran' })).toBeVisible();
    expect(screen.getByText('Bukti dikirim')).toBeVisible();
    expect(screen.getByText('Pemeriksaan file selesai')).toBeVisible();
    expect(screen.queryByText('Tanggal pembayaran')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Kembali ke antrean' })).toHaveAttribute(
      'href',
      '/workspace/payments?status=PENDING',
    );
    await user.selectOptions(screen.getByLabelText('Alasan perbaikan'), 'AMOUNT_MISMATCH');
    await user.click(screen.getByRole('button', { name: 'Minta perbaikan bukti' }));
    await waitFor(() =>
      expect(client.reject).toHaveBeenCalledWith(
        'purchase-1',
        0,
        'AMOUNT_MISMATCH',
        expect.any(String),
        undefined,
      ),
    );
  });

  it('renders decision actions for WAITING_VERIFICATION status', async () => {
    const waitingPurchase = {
      ...reviewPurchase,
      status: 'WAITING_VERIFICATION' as const,
    };
    const client = reviewFake({
      detail: vi.fn().mockResolvedValue({
        purchase: waitingPurchase,
        timeline: {
          submittedAt: waitingPurchase.submittedAt,
          proofFinalizedAt: new Date('2026-07-23T02:05:00Z'),
          decidedAt: null,
        },
        decisionActorMasked: null,
        activation: null,
        balance: null,
        usageHistory: { items: [], page: { nextCursor: null, hasMore: false } },
      }),
    });
    render(
      <PaymentReviewDetailView
        id="purchase-waiting"
        returnTo="/workspace/payments?status=WAITING_VERIFICATION"
        client={client}
        authorityOverride={{ canReview: true, canDecide: true }}
      />,
    );
    expect(await screen.findByRole('heading', { name: 'Detail pembayaran' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Setujui pembayaran' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Minta perbaikan bukti' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Tolak sebagai duplikat' })).toBeVisible();
  });

  it('renders a safe configuration failure for the queue', async () => {
    const failing = reviewFake({
      list: vi.fn().mockRejectedValue({ response: { status: 503 } }),
    });
    render(<PurchaseReviewView client={failing} branchOverride={branch} />);
    expect(
      await screen.findByText('Bukti pembayaran sementara belum dapat diproses.'),
    ).toBeVisible();
  });

  it('navigates pagination cleanly with cursorHistory and without trail parameters', async () => {
    const pagedClient = reviewFake({
      list: vi
        .fn()
        .mockResolvedValueOnce({
          items: [reviewPurchase],
          summary: {
            pending: 1,
            actionRequired: 0,
            approved: 0,
            rejected: 0,
            expired: 0,
            totalAmountRp: 100000,
            agingOver24Hours: 0,
          },
          page: { hasMore: true, nextCursor: 'cursor-page-2' },
          generatedAt: new Date(),
        })
        .mockResolvedValueOnce({
          items: [{ ...reviewPurchase, id: 'purchase-2' }],
          summary: {
            pending: 1,
            actionRequired: 0,
            approved: 0,
            rejected: 0,
            expired: 0,
            totalAmountRp: 100000,
            agingOver24Hours: 0,
          },
          page: { hasMore: false, nextCursor: null },
          generatedAt: new Date(),
        }),
    });
    render(<PurchaseReviewView client={pagedClient} branchOverride={branch} />);
    const user = userEvent.setup();
    const nextButton = await screen.findByRole('button', { name: 'Berikutnya' });
    expect(nextButton).toBeEnabled();
    await user.click(nextButton);
    expect(pagedClient.list).toHaveBeenCalledTimes(2);
    expect(pagedClient.list).toHaveBeenLastCalledWith(
      expect.objectContaining({ cursor: 'cursor-page-2' }),
    );
    expect(window.location.search).not.toContain('trail');
  });

  it('renders Semua Status summary card and switches status to ALL on click', async () => {
    const client = reviewFake({
      list: vi.fn().mockResolvedValue({
        items: [reviewPurchase],
        summary: {
          pending: 0,
          actionRequired: 0,
          approved: 14067,
          rejected: 12,
          expired: 5,
          total: 14084,
          totalAmountRp: 28_000_000_000,
          agingOver24Hours: 0,
        },
        page: { nextCursor: null, hasMore: false },
        generatedAt: new Date(),
      }),
    });
    render(<PurchaseReviewView client={client} branchOverride={branch} />);
    const user = userEvent.setup();
    const allCard = await screen.findByRole('button', { name: /Semua status/ });
    expect(allCard).toHaveTextContent('14.084');
    await user.click(allCard);
    expect(client.list).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: undefined }),
    );
  });

  it('renders helpful empty state when PENDING queue is empty with CTA to view all transactions', async () => {
    const emptyClient = reviewFake({
      list: vi.fn().mockResolvedValue({
        items: [],
        summary: {
          pending: 0,
          actionRequired: 0,
          approved: 50,
          rejected: 2,
          expired: 1,
          total: 53,
          totalAmountRp: 100_000_000,
          agingOver24Hours: 0,
        },
        page: { nextCursor: null, hasMore: false },
        generatedAt: new Date(),
      }),
    });
    render(<PurchaseReviewView client={emptyClient} branchOverride={branch} />);
    const user = userEvent.setup();
    expect(await screen.findByText('Antrean pembayaran kosong')).toBeVisible();
    expect(
      screen.getByText(
        'Tidak ada transaksi baru yang menunggu verifikasi saat ini. Anda dapat memeriksa riwayat seluruh transaksi yang telah diproses.',
      ),
    ).toBeVisible();
    const ctaButton = screen.getByRole('button', { name: 'Lihat Riwayat Semua Transaksi' });
    expect(ctaButton).toBeVisible();
    await user.click(ctaButton);
    expect(emptyClient.list).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: undefined }),
    );
  });

  it('does not flash an error banner while loading the payment review detail', () => {
    const pendingPromise = new Promise<never>(() => {});
    const client = reviewFake({
      detail: vi.fn().mockReturnValue(pendingPromise),
    });
    render(
      <PaymentReviewDetailView
        id="purchase-1"
        client={client}
        authorityOverride={{ canReview: true, canDecide: true }}
      />,
    );
    expect(screen.queryByText('Detail pembayaran belum tersedia')).not.toBeInTheDocument();
    expect(
      screen.getByRole('status', { name: 'Memuat detail pembayaran' }),
    ).toBeInTheDocument();
  });

  it('blocks approval and displays Pemeriksaan Silang Staf banner when reviewer recorded the payment (non-happy path)', async () => {
    const sessionClient: SessionClient = {
      me: vi.fn().mockResolvedValue({
        id: 'staff-recorder-1',
        displayName: 'Staff Kasir',
        roles: ['ADMIN'],
        branchIds: ['branch-1'],
        capabilities: ['payment:review', 'payment:decide', 'purchase:review', 'purchase:decide'],
        branches: [{ id: 'branch-1', name: 'Jakarta', code: 'JKT', timezone: 'Asia/Jakarta' }],
        sessionExpiresAt: new Date(Date.now() + 3600_000),
        passwordChangeRequired: false,
      }),
      logout: vi.fn().mockResolvedValue(undefined),
    };

    const recordedPurchase = {
      ...reviewPurchase,
      recordedById: 'staff-recorder-1',
      paymentProof: proof,
    };

    const client = reviewFake({
      detail: vi.fn().mockResolvedValue({
        purchase: recordedPurchase,
        timeline: {
          submittedAt: recordedPurchase.submittedAt,
          proofFinalizedAt: new Date(),
          decidedAt: null,
        },
        decisionActorMasked: null,
        activation: null,
        balance: null,
        usageHistory: { items: [], page: { nextCursor: null, hasMore: false } },
      }),
    });

    render(
      <SessionProvider client={sessionClient}>
        <AppFeedbackProvider>
          <PaymentReviewDetailView
            id="purchase-1"
            client={client}
            authorityOverride={{ canReview: true, canDecide: true }}
          />
        </AppFeedbackProvider>
      </SessionProvider>,
    );

    expect(await screen.findByText('Pemeriksaan Silang Staf:')).toBeVisible();
    expect(
      screen.getByText(/Anda mencatat transaksi ini. Untuk menjaga transparansi/i),
    ).toBeVisible();
    expect(screen.queryByRole('button', { name: /Setujui dan aktifkan paket/i })).not.toBeInTheDocument();
  });
});

describe('payment decision safeguards', () => {
  const renderDetail = (client: PurchaseReviewClient, decisionDelayMs = 10_000) =>
    render(
      <PaymentReviewDetailView
        id="purchase-1"
        returnTo="/workspace/payments?status=PENDING"
        client={client}
        authorityOverride={{ canReview: true, canDecide: true }}
        decisionDelayMs={decisionDelayMs}
      />,
    );

  beforeEach(() => {
    routerPush.mockClear();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => vi.useRealTimers());

  it('puts the requested amount next to the amount read from the proof and writes the difference in words', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderDetail(reviewFake());
    const group = await screen.findByRole('group', { name: 'Perbandingan nominal' });
    expect(within(group).getByText(/2\.000\.000/)).toBeVisible();
    const input = within(group).getByLabelText(/Nominal yang terlihat di bukti/);
    expect(within(group).getByRole('status')).toHaveTextContent(/Isi nominal/);
    await user.type(input, '1.995.000');
    expect(within(group).getByRole('status')).toHaveTextContent(/Kurang Rp\s?5\.000/);
    await user.clear(input);
    await user.type(input, '2.001.500');
    expect(within(group).getByRole('status')).toHaveTextContent(/Lebih Rp\s?1\.500/);
    await user.clear(input);
    await user.type(input, '2000000');
    expect(within(group).getByRole('status')).toHaveTextContent(/sama persis/);
  });

  it('lets the officer zoom and rotate the proof image once it is open', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn().mockReturnValue('blob:proof') });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
    renderDetail(reviewFake());
    await screen.findByRole('group', { name: 'Perbandingan nominal' });
    await user.click(screen.getByRole('button', { name: 'Preview bukti' }));
    const image = await screen.findByRole('img', { name: /Bukti pembayaran Pelanggan Synthetic/ });
    await user.click(screen.getByRole('button', { name: 'Perbesar' }));
    await user.click(screen.getByRole('button', { name: 'Putar' }));
    expect(image.style.transform).toBe('rotate(90deg) scale(1.5)');
    await user.click(screen.getByRole('button', { name: 'Atur ulang' }));
    expect(image.style.transform).toBe('rotate(0deg) scale(1)');
  });

  it('only allows approving after the proof image is actually on screen', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn().mockReturnValue('blob:proof') });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
    renderDetail(reviewFake());
    const approve = await screen.findByRole('button', { name: 'Setujui pembayaran' });
    expect(approve).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Preview bukti' }));
    const image = await screen.findByRole('img', { name: /Bukti pembayaran Pelanggan Synthetic/ });
    expect(approve).toBeDisabled();
    fireEvent.error(image);
    expect(approve).toBeDisabled();
    fireEvent.load(image);
    expect(approve).toBeEnabled();
  });

  it('holds the decision for 10 seconds and sends nothing if the officer cancels', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const client = reviewFake();
    renderDetail(client);
    await user.click(await screen.findByRole('button', { name: 'Minta perbaikan bukti' }));
    const banner = await screen.findByText(/akan dikirim dalam 10 detik/);
    expect(banner).toBeVisible();
    expect(client.reject).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Tolak sebagai duplikat' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Batalkan' }));
    await vi.advanceTimersByTimeAsync(20_000);
    expect(client.reject).not.toHaveBeenCalled();
    expect(screen.queryByText(/akan dikirim dalam/)).toBeNull();
  });

  it('sends after the delay, then opens the next pending proof in the queue', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const client = reviewFake({
      list: vi.fn().mockResolvedValue({
        items: [reviewPurchase, { ...reviewPurchase, id: 'purchase-2' }],
        summary: { pending: 2, actionRequired: 0, approved: 0, rejected: 0, expired: 0, totalAmountRp: 0, agingOver24Hours: 0 },
        generatedAt: new Date('2026-07-23T03:00:00Z'),
        page: { nextCursor: null, hasMore: false },
      }),
    });
    renderDetail(client);
    await user.click(await screen.findByRole('button', { name: 'Minta perbaikan bukti' }));
    await screen.findByText(/akan dikirim dalam/);
    expect(client.reject).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(10_000);
    await waitFor(() => expect(client.reject).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(routerPush).toHaveBeenCalledWith(
        '/workspace/payments/purchase-2?returnTo=%2Fworkspace%2Fpayments%3Fstatus%3DPENDING',
      ),
    );
  });
});
