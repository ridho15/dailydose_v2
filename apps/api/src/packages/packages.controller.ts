import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { SelfService } from '../identity/route-access';
import { AuthGuard, type AuthenticatedRequest } from '../identity/auth.guard';
import { CustomerOrderService } from './pembelian-paket.service';
import { PackageCatalogService } from './katalog-paket.service';
import { PaymentAccountService } from './rekening-pembayaran.service';
import { PaymentReviewService } from './verifikasi-pembayaran.service';
import { PaymentProofService } from './bukti-pembayaran.service';
import { VoucherService } from './voucher.service';
import { PackagePromotionService } from './package-promotion.service';
import { ApiProblem } from '../identity/security';
import { HttpStatus } from '@nestjs/common';
/** Hasil `IdempotencyService.execute` berbentuk `{ status, body, replay }`; klien hanya butuh isinya. */
const unwrap = <T>(result: T): T extends { body: infer B } ? B : T => ((result as any)?.body ?? result) as any;

@Controller()
@UseGuards(AuthGuard)
export class PackagesController {
  constructor(
    private readonly customerOrders: CustomerOrderService,
    private readonly catalog: PackageCatalogService,
    private readonly paymentAccountsService: PaymentAccountService,
    private readonly paymentReview: PaymentReviewService,
    private readonly paymentProof: PaymentProofService,
    private readonly vouchers: VoucherService,
    private readonly promotions: PackagePromotionService,
  ) {}
  @Get('vouchers') listVouchers(
    @Req() r: AuthenticatedRequest,
    @Query('q') q?: string,
    @Query('status') status?: string,
    @Query('branchId') branchId?: string,
    @Query('cursor') cursor?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('limit') limit?: string,
    @Query('from') from?: string,
    @Query('until') until?: string,
    @Query('includeHistorical') includeHistorical?: string,
  ) {
    return this.vouchers.list(r.principal, {
      q,
      status,
      branchId,
      cursor,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
      limit,
      from,
      until,
      includeHistorical: includeHistorical === 'true',
    });
  }
  @Get('vouchers/:id') getVoucher(@Req() r: AuthenticatedRequest, @Param('id') id: string) {
    return this.vouchers.detail(r.principal, id);
  }
  @Post('vouchers') async createVoucher(
    @Req() r: AuthenticatedRequest,
    @Headers('idempotency-key') key: string,
    @Body() body: any,
  ) {
    return unwrap(await this.vouchers.create(r.principal, body, key, r.correlationId ?? 'unknown'));
  }
  @Patch('vouchers/:id') async updateVoucher(
    @Req() r: AuthenticatedRequest,
    @Headers('idempotency-key') key: string,
    @Param('id') id: string,
    @Body() body: any,
  ) {
    return unwrap(await this.vouchers.update(r.principal, id, body, key, r.correlationId ?? 'unknown'));
  }
  @Get('vouchers/:id/redemptions') voucherRedemptions(
    @Req() r: AuthenticatedRequest,
    @Param('id') id: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.vouchers.redemptions(r.principal, id, cursor, limit);
  }
  @Post('vouchers/:id/:action') async transitionVoucher(
    @Req() r: AuthenticatedRequest,
    @Param('id') id: string,
    @Param('action') action: 'activate' | 'pause' | 'archive',
    @Headers('idempotency-key') key: string,
    @Body() body: { expectedVersion: number; reason: string },
  ) {
    const statuses = { activate: 'ACTIVE', pause: 'PAUSED', archive: 'ARCHIVED' } as const;
    const status = statuses[action];
    if (!status) throw new ApiProblem('VALIDATION_ERROR', HttpStatus.BAD_REQUEST);
    return unwrap(
      await this.vouchers.transition(r.principal, id, status, body, key, r.correlationId ?? 'unknown'),
    );
  }
  @SelfService()
  @Post('checkout/voucher-preview') previewVoucher(
    @Req() r: AuthenticatedRequest,
    @Body() body: { packageId: string; branchId: string; classTypeId: string; code: string },
  ) {
    return this.vouchers.preview(r.principal, body);
  }
  @Get('packages') list(
    @Req() r: AuthenticatedRequest,
    @Query('branchId') branchId?: string,
    @Query('classTypeId') classTypeId?: string,
    @Query('status') status?: string,
    @Query('effectiveState') effectiveState?: string,
    @Query('q') q?: string,
    @Query('from') from?: string,
    @Query('until') until?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
    @Query('includeHistorical') includeHistorical?: string,
  ) {
    return this.catalog.list(r.principal, {
      branchId,
      classTypeId,
      status,
      effectiveState,
      q,
      from,
      until,
      cursor,
      limit,
      includeHistorical: includeHistorical === 'true',
    });
  }
  @Get('packages/:id') packageDetail(@Req() r: AuthenticatedRequest, @Param('id') id: string) {
    return this.promotions.packageDetail(r.principal, id);
  }
  @Get('packages/:id/promotions') packagePromotions(
    @Req() r: AuthenticatedRequest,
    @Param('id') id: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
    @Query('includeHistorical') includeHistorical?: string,
  ) {
    return this.promotions.list(r.principal, id, cursor, limit);
  }
  @Post('packages/:id/promotions') async createPackagePromotion(
    @Req() r: AuthenticatedRequest,
    @Param('id') id: string,
    @Headers('idempotency-key') key: string,
    @Body() body: any,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.promotions.create(r.principal, id, body, key, r.correlationId ?? 'unknown');
    response.status(result.status);
    response.setHeader('Idempotency-Replayed', String(result.replay));
    return result.body;
  }
  @Patch('package-promotions/:id') async updatePackagePromotion(
    @Req() r: AuthenticatedRequest,
    @Param('id') id: string,
    @Headers('idempotency-key') key: string,
    @Body() body: any,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.promotions.update(r.principal, id, body, key, r.correlationId ?? 'unknown');
    response.status(result.status);
    response.setHeader('Idempotency-Replayed', String(result.replay));
    return result.body;
  }
  @Post('package-promotions/:id/:action') @HttpCode(200) async transitionPackagePromotion(
    @Req() r: AuthenticatedRequest,
    @Param('id') id: string,
    @Param('action') action: 'activate' | 'pause' | 'archive',
    @Headers('idempotency-key') key: string,
    @Body() body: { expectedVersion: number; reason: string },
    @Res({ passthrough: true }) response: Response,
  ) {
    const statuses = { activate: 'ACTIVE', pause: 'PAUSED', archive: 'ARCHIVED' } as const;
    const status = statuses[action];
    if (!status) throw new ApiProblem('VALIDATION_ERROR', HttpStatus.BAD_REQUEST);
    const result = await this.promotions.transition(
      r.principal,
      id,
      status,
      body,
      key,
      r.correlationId ?? 'unknown',
    );
    response.status(result.status);
    response.setHeader('Idempotency-Replayed', String(result.replay));
    return result.body;
  }
  @Get('package-promotions/:id/orders') packagePromotionOrders(
    @Req() r: AuthenticatedRequest,
    @Param('id') id: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.promotions.orders(r.principal, id, cursor, limit);
  }
  @Post('packages') async create(
    @Req() r: AuthenticatedRequest,
    @Headers('idempotency-key') key: string,
    @Body() b: any,
  ) {
    const result = await this.catalog.create(r.principal, b, key, r.correlationId ?? 'unknown');
    return (result as any).body ?? result;
  }
  @Patch('packages/:id') async updatePackage(
    @Req() r: AuthenticatedRequest,
    @Param('id') id: string,
    @Headers('idempotency-key') key: string,
    @Body() body: any,
  ) {
    const result = await this.catalog.update(r.principal, id, body, key, r.correlationId ?? 'unknown');
    return (result as any).body ?? result;
  }
  @Post('packages/:id/revisions') async createPackageRevision(
    @Req() r: AuthenticatedRequest,
    @Param('id') id: string,
    @Headers('idempotency-key') key: string,
    @Body() body: any,
  ) {
    const result = await this.catalog.revise(r.principal, id, body, key, r.correlationId ?? 'unknown');
    return (result as any).body ?? result;
  }
  @Put('packages/:id/scopes') async replacePackageScopes(
    @Req() r: AuthenticatedRequest,
    @Param('id') id: string,
    @Headers('idempotency-key') key: string,
    @Body()
    body: {
      branchIds: string[];
      classTypeIds: string[];
      expectedVersion: number;
      reason: string;
    },
  ) {
    const result = await this.catalog.replaceScopes(r.principal, id, body, key, r.correlationId ?? 'unknown');
    return (result as any).body ?? result;
  }
  @Post('packages/:id/:action') async transitionPackage(
    @Req() r: AuthenticatedRequest,
    @Param('id') id: string,
    @Param('action') action: 'deactivate' | 'reactivate',
    @Headers('idempotency-key') key: string,
    @Body() body: { expectedVersion: number; reason: string },
  ) {
    const statuses = { deactivate: 'INACTIVE', reactivate: 'ACTIVE' } as const;
    const status = statuses[action];
    if (!status) throw new ApiProblem('VALIDATION_ERROR', HttpStatus.BAD_REQUEST);
    const result = await this.catalog.transition(
      r.principal,
      id,
      status,
      body,
      key,
      r.correlationId ?? 'unknown',
    );
    return (result as any).body ?? result;
  }
  @Get('payment-accounts') paymentAccounts(
    @Req() r: AuthenticatedRequest,
    @Query('branchId') branchId?: string,
  ) {
    return this.paymentAccountsService.list(r.principal, branchId);
  }
  @Get('payment-accounts/:id') paymentAccountDetail(
    @Req() r: AuthenticatedRequest,
    @Param('id') id: string,
  ) {
    return this.paymentAccountsService.detail(r.principal, id);
  }
  @Post('payment-accounts') createPaymentAccount(
    @Req() r: AuthenticatedRequest,
    @Body() body: any,
  ) {
    return this.paymentAccountsService.create(r.principal, body, r.correlationId ?? 'unknown');
  }
  @Patch('payment-accounts/:id') updatePaymentAccount(
    @Req() r: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: any,
  ) {
    return this.paymentAccountsService.update(r.principal, id, body, r.correlationId ?? 'unknown');
  }
  @Post('payment-accounts/:id/deactivate') @HttpCode(200) deactivatePaymentAccount(
    @Req() r: AuthenticatedRequest,
    @Param('id') id: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body() body: any,
  ) {
    return key
      ? this.paymentAccountsService.deactivateIdempotent(
          r.principal,
          id,
          body,
          key,
          r.correlationId ?? 'unknown',
        )
      : this.paymentAccountsService.deactivate(r.principal, id, body, r.correlationId ?? 'unknown');
  }
  @Post('payment-accounts/:id/reactivate') @HttpCode(200) reactivatePaymentAccount(
    @Req() r: AuthenticatedRequest,
    @Param('id') id: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body() body: { expectedVersion: number; reason: string },
  ) {
    return this.paymentAccountsService.reactivate(
      r.principal,
      id,
      body,
      key,
      r.correlationId ?? 'unknown',
    );
  }
  @SelfService()
  @Get('checkout/options') checkout(
    @Req() r: AuthenticatedRequest,
    @Query('packageId') packageId: string,
    @Query('branchId') branchId?: string,
  ) {
    return this.customerOrders.checkoutOptions(r.principal, packageId, branchId);
  }
  @SelfService()
  @Post('orders') async createOrder(
    @Req() r: AuthenticatedRequest,
    @Headers('idempotency-key') key: string,
    @Body() body: any,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.customerOrders.createOrder(
      r.principal,
      body,
      key,
      r.correlationId ?? 'unknown',
    );
    response.status(result.status);
    response.setHeader('Idempotency-Replayed', String(result.replay));
    return result.body;
  }
  @SelfService()
  @Get('orders') orders(
    @Req() r: AuthenticatedRequest,
    @Query('status') status?: string,
    @Query('q') q?: string,
    @Query('from') from?: string,
    @Query('until') until?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
    @Query('includeHistorical') includeHistorical?: string,
  ) {
    return this.customerOrders.listOrders(r.principal, {
      status,
      q,
      from,
      until,
      cursor,
      limit,
      includeHistorical: includeHistorical === 'true',
    });
  }
  @SelfService()
  @Get('orders/:id') order(@Req() r: AuthenticatedRequest, @Param('id') id: string) {
    return this.customerOrders.orderDetail(r.principal, id);
  }
  @SelfService()
  @Post('orders/:id/payment-proof') @HttpCode(200) attachOrderProof(
    @Req() r: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: any,
  ) {
    return this.customerOrders.attachOrderProof(
      r.principal,
      id,
      body,
      r.correlationId ?? 'unknown',
    );
  }
  @Post('orders/:id/payment-proof/view-authorizations') authorizeOwnOrderProof(
    @Req() r: AuthenticatedRequest,
    @Param('id') id: string,
  ) {
    return this.paymentReview.authorizeOwnOrderProof(r.principal, id, r.correlationId ?? 'unknown');
  }
  @Post('uploads/payment-proofs') issue(@Req() r: AuthenticatedRequest, @Body() b: any) {
    return this.paymentProof.issue(r.principal, b, r.correlationId ?? 'unknown');
  }
  @Put('uploads/payment-proofs/:id/content') uploadContent(
    @Req() r: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: Buffer,
  ) {
    return this.paymentProof.uploadContent(r.principal, id, body);
  }
  @SelfService()
  @Post('uploads/payment-proofs/:id/finalize') @HttpCode(202) finalize(
    @Req() r: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: { sha256: string; sizeBytes: number },
  ) {
    return this.paymentProof.finalize(r.principal, id, body, r.correlationId ?? 'unknown');
  }
  @Get('uploads/payment-proofs/:id') status(
    @Req() r: AuthenticatedRequest,
    @Param('id') id: string,
  ) {
    return this.paymentProof.status(r.principal, id);
  }
  @Get('purchases') listPurchases(
    @Req() r: AuthenticatedRequest,
    @Query('branchId') branchId?: string,
    @Query('status') status?: string,
    @Query('cursor') cursor?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('limit') limit?: string,
    @Query('q') q?: string,
    @Query('from') from?: string,
    @Query('until') until?: string,
    @Query('purchaseId') purchaseId?: string,
    @Query('includeHistorical') includeHistorical?: string,
  ) {
    return this.paymentReview.list(r.principal, {
      branchId,
      status,
      cursor,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
      limit,
      q,
      from,
      until,
      purchaseId,
      includeHistorical: includeHistorical === 'true',
    });
  }
  @Get('purchases/:id') getPurchaseReview(
    @Req() r: AuthenticatedRequest,
    @Param('id') id: string,
    @Query('usageCursor') usageCursor?: string,
  ) {
    return this.paymentReview.get(r.principal, id, usageCursor);
  }
  @Post('purchases/expire-stale') async expireStalePurchases(
    @Req() r: AuthenticatedRequest,
    @Query('olderThanHours') olderThanHours?: string,
  ) {
    // Angka dikirim apa adanya (NaN bila bukan bilangan) supaya service yang menolak nilai tidak sah.
    const hours = olderThanHours === undefined || olderThanHours === '' ? 24 : Number(olderThanHours);
    return this.customerOrders.expireStaleOrders(r.principal, hours);
  }
  // Penjualan manual di meja (staf mencatat atas nama pelanggan; disetujui penyetuju lain).
  @Post('purchases/assisted') async recordAssistedSale(
    @Req() r: AuthenticatedRequest,
    @Headers('idempotency-key') key: string,
    @Body() b: any,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.customerOrders.recordAssistedSale(
      r.principal,
      b,
      key,
      r.correlationId ?? 'unknown',
    );
    response.status(result.status);
    response.setHeader('Idempotency-Replayed', String(result.replay));
    return result.body;
  }
  @SelfService()
  @Post('purchases') async submit(
    @Req() r: AuthenticatedRequest,
    @Headers('idempotency-key') key: string,
    @Body() b: any,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.customerOrders.submit(
      r.principal,
      b,
      key,
      r.correlationId ?? 'unknown',
    );
    response.status(result.status);
    response.setHeader('Idempotency-Replayed', String(result.replay));
    return result.body;
  }
  @Post('purchases/:id/payment-proof-replacements') @HttpCode(202) replace(
    @Req() r: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() b: any,
  ) {
    return this.paymentProof.replace(r.principal, id, b, r.correlationId ?? 'unknown');
  }
  @Post('uploads/payment-proofs/:id/download-authorizations') authorizeDownload(
    @Req() r: AuthenticatedRequest,
    @Param('id') id: string,
  ) {
    return this.paymentReview.authorizeProofDownload(r.principal, id, r.correlationId ?? 'unknown');
  }
  @Get('uploads/payment-proofs/view-authorizations/:id/content') async viewProof(
    @Req() r: AuthenticatedRequest,
    @Param('id') id: string,
    @Res() response: Response,
  ) {
    const result = await this.paymentReview.viewProofContent(
      r.principal,
      id,
      r.correlationId ?? 'unknown',
    );
    response.setHeader('Content-Type', result.mimeType);
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('Content-Disposition', 'inline');
    // Gambar pengganti SVG tidak boleh menjalankan skrip bila dibuka langsung di tab.
    if (result.mimeType === 'image/svg+xml')
      response.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.send(result.bytes);
  }
  @Post('purchases/:id/approve') async approve(
    @Req() r: AuthenticatedRequest,
    @Param('id') id: string,
    @Headers('idempotency-key') key: string,
    @Body() body: { reasonCode?: string; expectedVersion?: number; note?: string },
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.paymentReview.decide(
      r.principal,
      id,
      'APPROVED',
      body,
      key,
      r.correlationId ?? 'unknown',
    );
    response.setHeader('Idempotency-Replayed', String(result.replay));
    return { ...(result.body as object), idempotentReplay: result.replay };
  }
  @Post('purchases/:id/reject') async reject(
    @Req() r: AuthenticatedRequest,
    @Param('id') id: string,
    @Headers('idempotency-key') key: string,
    @Body() body: { reasonCode?: string; expectedVersion?: number; note?: string },
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.paymentReview.decide(
      r.principal,
      id,
      'REJECTED',
      body,
      key,
      r.correlationId ?? 'unknown',
    );
    response.setHeader('Idempotency-Replayed', String(result.replay));
    return result.body;
  }
}
