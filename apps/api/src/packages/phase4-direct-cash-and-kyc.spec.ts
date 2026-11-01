import { PolicyService } from '../identity/policy.service';
import { PackageAccessService } from './package-access.service';
import { PaymentReviewService } from './verifikasi-pembayaran.service';
import { IdentityDocumentWorkflowService } from '../identity/identity-document-workflow.service';
import { IdentityReviewQueryService } from '../identity/identity-review-query.service';
import { ROLE_CAPABILITIES } from '../identity/role-capabilities';

const branchGandaria = '00000000-0000-4000-8000-000000000002';
const branchSurabaya = '00000000-0000-4000-8000-000000000003';
const customerId = '00000000-0000-4000-8000-000000000010';
const staffAdminId = '00000000-0000-4000-8000-000000000020';
const staffManagerId = '00000000-0000-4000-8000-000000000030';
const packageId = '00000000-0000-4000-8000-000000000040';

describe('Fase 4: Otorisasi Pembayaran Kasir Tunai/EDC & Delegasi KYC Cabang', () => {
  const policy = new PolicyService();

  const adminPrincipal = {
    sessionId: 'sess-admin',
    userId: staffAdminId,
    roles: [{ role: 'ADMIN' as const, branchId: branchGandaria }],
    capabilities: policy.capabilities([{ role: 'ADMIN', branchId: branchGandaria }]),
    branchIds: [branchGandaria],
  };

  const managerPrincipal = {
    sessionId: 'sess-mgr',
    userId: staffManagerId,
    roles: [{ role: 'MANAGER' as const, branchId: branchGandaria }],
    capabilities: policy.capabilities([{ role: 'MANAGER', branchId: branchGandaria }]),
    branchIds: [branchGandaria],
  };

  describe('Poin 3: Otorisasi Pembayaran Kasir Tunai/EDC', () => {
    function setupPaymentReview(purchaseRow: Record<string, unknown>) {
      const tx = {
        pembelian: {
          findUnique: jest.fn().mockResolvedValue(purchaseRow),
          update: jest.fn().mockImplementation(async ({ data }) => ({ ...purchaseRow, ...data })),
        },
        paketPelanggan: {
          findUnique: jest.fn().mockResolvedValue(null),
          create: jest.fn().mockImplementation(async ({ data }) => ({ id: 'new-pkg-1', ...data })),
        },
        sessionLedger: { create: jest.fn().mockResolvedValue({}) },
      };

      const idempotency = {
        execute: jest.fn(async (_c: unknown, action: (t: typeof tx) => Promise<unknown>) => action(tx)),
      };

      const access = new PackageAccessService(
        {} as never,
        policy,
        { record: jest.fn() } as never,
      );

      const service = new PaymentReviewService(
        {} as never,
        idempotency as never,
        access,
        {} as never,
        { record: jest.fn() } as never,
      );

      return { service, tx };
    }

    it('Happy Path: Admin cabang yang mencatat pembayaran kasir CASH dapat langsung memutuskannya', async () => {
      const cashPurchase = {
        id: 'order-cash-1',
        userId: customerId,
        recordedById: staffAdminId, // Dicatat oleh admin ini di kasir
        branchId: branchGandaria,
        packageId,
        paymentMethod: 'CASH',
        status: 'PENDING',
        invoiceNumber: 'INV-CASH-1',
        package: { id: packageId, sessionCount: 10, validityDays: 30 },
        branch: { name: 'Gandaria Studio' },
        paymentProof: null,
      };

      const { service, tx } = setupPaymentReview(cashPurchase);

      const result = await service.decide(
        adminPrincipal,
        cashPurchase.id,
        'APPROVED',
        { expectedVersion: 1 },
        'key-idemp-1',
        'corr-1',
      );

      expect(result).toBeDefined();
      expect(tx.pembelian.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: cashPurchase.id },
          data: expect.objectContaining({
            status: 'PAID',
            verifiedById: staffAdminId,
          }),
        }),
      );
      expect(tx.paketPelanggan.create).toHaveBeenCalled();
    });

    it('Happy Path: Manager cabang yang mencatat pembayaran EDC/CARD dapat langsung memutuskannya', async () => {
      const cardPurchase = {
        id: 'order-card-1',
        userId: customerId,
        recordedById: staffManagerId, // Dicatat oleh manager di kasir
        branchId: branchGandaria,
        packageId,
        paymentMethod: 'CARD',
        status: 'PENDING',
        invoiceNumber: 'INV-CARD-1',
        package: { id: packageId, sessionCount: 5, validityDays: 30 },
        branch: { name: 'Gandaria Studio' },
        paymentProof: null,
      };

      const { service, tx } = setupPaymentReview(cardPurchase);

      const result = await service.decide(
        managerPrincipal,
        cardPurchase.id,
        'APPROVED',
        { expectedVersion: 1 },
        'key-idemp-2',
        'corr-2',
      );

      expect(result).toBeDefined();
      expect(tx.pembelian.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: cardPurchase.id },
          data: expect.objectContaining({ status: 'PAID' }),
        }),
      );
    });

    it('No Happy Path: Non-kasir (BANK_TRANSFER) tetap menolak pencatat yang ingin menyetujui sendiri (Maker-Checker)', async () => {
      const transferPurchase = {
        id: 'order-transfer-1',
        userId: customerId,
        recordedById: staffManagerId,
        branchId: branchGandaria,
        packageId,
        paymentMethod: 'BANK_TRANSFER',
        status: 'WAITING_VERIFICATION',
        invoiceNumber: 'INV-TRF-1',
        package: { id: packageId, sessionCount: 10, validityDays: 30 },
        branch: { name: 'Gandaria Studio' },
        paymentProof: { id: 'proof-1', scanStatus: 'CLEAN' },
      };

      const { service } = setupPaymentReview(transferPurchase);

      // Admin cabang tidak boleh menyetujui transfer bank yang dia catat sendiri
      await expect(
        service.decide(
          managerPrincipal,
          transferPurchase.id,
          'APPROVED',
          { expectedVersion: 1 },
          'key-idemp-3',
          'corr-3',
        ),
      ).rejects.toMatchObject({
        code: 'SEPARATION_OF_DUTIES_VIOLATION',
      });
    });

    it('No Happy Path: Menolak staf cabang menyetujui transaksi dari cabang lain', async () => {
      const offBranchPurchase = {
        id: 'order-surabaya-1',
        userId: customerId,
        recordedById: 'other-staff',
        branchId: branchSurabaya, // Cabang Surabaya
        packageId,
        paymentMethod: 'CASH',
        status: 'PENDING',
        invoiceNumber: 'INV-SBY-1',
        package: { id: packageId, sessionCount: 10, validityDays: 30 },
        branch: { name: 'Surabaya Studio' },
        paymentProof: null,
      };

      const { service } = setupPaymentReview(offBranchPurchase);

      // Admin Gandaria dilarang menyetujui kasir Surabaya
      await expect(
        service.decide(
          adminPrincipal,
          offBranchPurchase.id,
          'APPROVED',
          { expectedVersion: 1 },
          'key-idemp-4',
          'corr-4',
        ),
      ).rejects.toMatchObject({
        code: 'RESOURCE_NOT_FOUND',
      });
    });
  });

  describe('Poin 6: Delegasi Verifikasi Dokumen KYC ke Role Manager', () => {
    it('Happy Path: Role MANAGER memegang kapabilitas identity-verification:read dan decide', () => {
      expect(ROLE_CAPABILITIES.MANAGER).toContain('identity-verification:read');
      expect(ROLE_CAPABILITIES.MANAGER).toContain('identity-verification:decide');
      // Penghapusan dokumen tetap milik Super Owner
      expect(ROLE_CAPABILITIES.MANAGER).not.toContain('identity-verification:delete');
    });

    it('Happy Path: Manager cabang dapat memutuskan verifikasi KYC member', async () => {
      const dbMock = {
        profilPengguna: {
          findUnique: jest.fn().mockResolvedValue({ userId: customerId, notes: '' }),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
      } as any;

      const workflowService = new IdentityDocumentWorkflowService(
        dbMock,
        policy,
        {} as never,
        { catat: jest.fn() } as never,
      );

      const decisionResult = await workflowService.decideIdentityDocument(
        managerPrincipal,
        `doc-ktp-${customerId}`,
        'APPROVED',
        { expectedVersion: 1 },
        'corr-kyc-1',
      );

      expect(decisionResult).toMatchObject({
        status: 'APPROVED',
      });
      expect(dbMock.profilPengguna.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: customerId },
          data: expect.objectContaining({
            notes: expect.stringContaining('KYC_APPROVED'),
          }),
        }),
      );
    });

    it('No Happy Path: Role ADMIN biasa tetap tidak memiliki wewenang verifikasi KYC', async () => {
      const dbMock = {
        profilPengguna: { findUnique: jest.fn() },
      } as any;

      const workflowService = new IdentityDocumentWorkflowService(
        dbMock,
        policy,
        {} as never,
        { catat: jest.fn() } as never,
      );

      await expect(
        workflowService.decideIdentityDocument(
          adminPrincipal,
          `doc-ktp-${customerId}`,
          'APPROVED',
          { expectedVersion: 1 },
          'corr-kyc-2',
        ),
      ).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
    });
  });
});
