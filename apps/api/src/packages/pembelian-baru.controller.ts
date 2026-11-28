import { Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard, type AuthenticatedRequest } from '../identity/auth.guard';
import { PembelianBaruService } from './pembelian-baru.service';

/** Pembelian baru di meja depan: kirim Syarat & Ketentuan lewat WhatsApp ke member. */
@Controller('purchase-followups')
@UseGuards(AuthGuard)
export class PembelianBaruController {
  constructor(private readonly pembelianBaru: PembelianBaruService) {}

  @Get()
  daftar(@Req() req: AuthenticatedRequest, @Query('branchId') branchId?: string) {
    return this.pembelianBaru.daftar(req.principal, { branchId });
  }

  @Post(':purchaseId/sent')
  terkirim(@Req() req: AuthenticatedRequest, @Param('purchaseId') purchaseId: string) {
    return this.pembelianBaru.tandaiTerkirim(req.principal, purchaseId, req.correlationId);
  }
}
