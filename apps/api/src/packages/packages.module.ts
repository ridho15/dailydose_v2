import { PenyesuaianBuktiController } from './penyesuaian-bukti.controller';
import { KoreksiJamService } from './koreksi-jam.service';
import { PayrollInstrukturService } from './payroll-instruktur.service';
import { RingkasanKeuanganController } from './ringkasan-keuangan.controller';
import { RingkasanKeuanganService } from './ringkasan-keuangan.service';
import { PenyesuaianBuktiService } from './penyesuaian-bukti.service';
import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { FoundationModule } from '../foundation/foundation.module';
import { IdentityModule } from '../identity/identity.module';
import { PackagesController } from './packages.controller';
import { CustomerOrderService } from './pembelian-paket.service';
import {
  ConfigGatedMalwareScanProvider,
  ConfigGatedObjectStorageProvider,
} from './proof-providers';
import { PackageAccessService } from './package-access.service';
import { PackageCatalogService } from './katalog-paket.service';
import { PaymentAccountService } from './rekening-pembayaran.service';
import { PaymentReviewService } from './verifikasi-pembayaran.service';
import { PaymentProofService } from './bukti-pembayaran.service';
import { VoucherService } from './voucher.service';
import { PackagePricingService } from './kalkulasi-harga-paket.service';
import { PackagePromotionService } from './package-promotion.service';

import { LedgerController } from './ledger.controller';
import { LedgerService } from './ledger.service';
import { FinanceController } from './finance.controller';
import { AntreanTertinggalController, RetentionController } from './retention.controller';
import { AntreanTertinggalService } from './antrean-tertinggal.service';
import { TargetController } from './target.controller';
import { TargetService } from './target.service';
import { RetentionService } from './retention.service';
import { FinanceService } from './finance.service';
import { SettlementOwnerService } from './settlement-owner.service';
import { TransferHonorService } from './transfer-honor.service';
import { ModalSesiService } from './modal-sesi.service';

import { PaymentExpirationWorkerService } from './payment-expiration-worker';

@Module({
  imports: [DatabaseModule, FoundationModule, IdentityModule],
  controllers: [
    PackagesController,
    LedgerController,
    PenyesuaianBuktiController,
    RingkasanKeuanganController,
    FinanceController,
    RetentionController,
    AntreanTertinggalController,
    TargetController,
  ],
  providers: [
    SettlementOwnerService,
    TransferHonorService,
    ModalSesiService,
    PenyesuaianBuktiService,
    KoreksiJamService,
    PayrollInstrukturService,
    RingkasanKeuanganService,
    CustomerOrderService,
    PackageAccessService,
    PackageCatalogService,
    PaymentAccountService,
    PaymentReviewService,
    PaymentProofService,
    ConfigGatedObjectStorageProvider,
    ConfigGatedMalwareScanProvider,
    VoucherService,
    PackagePricingService,
    PackagePromotionService,
    LedgerService,
    FinanceService,
    RetentionService,
    AntreanTertinggalService,
    TargetService,
    PaymentExpirationWorkerService,
  ],
  exports: [LedgerService, FinanceService, PaymentExpirationWorkerService],
})
export class PackagesModule {}
