import { Body, Controller, Get, Param, Patch, Post, Query, Req, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AuthGuard, type AuthenticatedRequest } from '../identity/auth.guard';
import { StokMinumanService } from './stok-minuman.service';

/** Master barang minuman, stok per cabang, dan barang masuk/keluar. */
@Controller('drinks')
@UseGuards(AuthGuard)
export class StokMinumanController {
  constructor(private readonly stok: StokMinumanService) {}

  @Get()
  daftar(@Req() req: AuthenticatedRequest, @Query('semua') semua?: string) {
    return this.stok.daftarBarang(req.principal, { semua });
  }

  @Post()
  buat(@Req() req: AuthenticatedRequest, @Body() body: Record<string, unknown>) {
    return this.stok.buatBarang(req.principal, body ?? {});
  }

  @Get('stock')
  stokCabang(@Req() req: AuthenticatedRequest, @Query('branchId') branchId?: string) {
    return this.stok.stok(req.principal, { branchId });
  }

  @Get('movements')
  riwayat(
    @Req() req: AuthenticatedRequest,
    @Query('branchId') branchId?: string,
    @Query('barangId') barangId?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.stok.riwayat(req.principal, { branchId, barangId, cursor, limit });
  }

  /** Multipart; `nota` (foto/PDF) wajib untuk pembelian (MASUK). */
  @Post('movements')
  @UseInterceptors(FileInterceptor('nota', { limits: { fileSize: 8_000_000, files: 1 } }))
  catat(
    @Req() req: AuthenticatedRequest,
    @Body() body: Record<string, unknown>,
    @UploadedFile() nota?: { buffer?: Buffer; size?: number },
  ) {
    return this.stok.catat(req.principal, body ?? {}, new Date(), nota);
  }

  @Patch(':id')
  ubah(@Req() req: AuthenticatedRequest, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.stok.ubahBarang(req.principal, id, body ?? {});
  }
}
