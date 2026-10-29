import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { AuthGuard, type AuthenticatedRequest } from '../identity/auth.guard';
import { SelfService } from '../identity/route-access';
import { KoreksiJamService } from './koreksi-jam.service';
import { PayrollInstrukturService } from './payroll-instruktur.service';
import { RingkasanKeuanganService } from './ringkasan-keuangan.service';
import { SettlementOwnerService } from './settlement-owner.service';
import { TransferHonorService } from './transfer-honor.service';
import { ModalSesiService } from './modal-sesi.service';

@Controller()
@UseGuards(AuthGuard)
export class RingkasanKeuanganController {
  constructor(
    private readonly ringkasan: RingkasanKeuanganService,
    private readonly koreksiJam: KoreksiJamService,
    private readonly payroll: PayrollInstrukturService,
    private readonly settlement: SettlementOwnerService,
    private readonly transferHonor: TransferHonorService,
    private readonly modalSesi: ModalSesiService,
  ) {}

  /** Super Owner aktif untuk pilihan "Dibayar oleh" di form pengeluaran. */
  @Get('owner-settlement/owners')
  ownerSettlementOwners(@Req() req: AuthenticatedRequest) {
    return this.settlement.daftarOwner(req.principal);
  }

  /** Porsi laba tiap Super Owner per cabang. */
  @Get('owner-settlement/shares')
  ownerSettlementShares(@Req() req: AuthenticatedRequest) {
    return this.settlement.porsi(req.principal);
  }

  @Put('owner-settlement/shares/:branchId')
  simpanOwnerSettlementShares(
    @Req() req: AuthenticatedRequest,
    @Param('branchId') branchId: string,
    @Body() body: { porsi?: { ownerId: string; persen: number }[] },
  ) {
    return this.settlement.simpanPorsi(req.principal, branchId, body ?? {});
  }

  /** Settlement satu bulan: hak laba + reimburse yang dibayar cabang ke tiap Super Owner. */
  @Get('owner-settlement')
  ownerSettlement(@Req() req: AuthenticatedRequest, @Query('period') period?: string) {
    return this.settlement.settlement(req.principal, { period });
  }

  /** Modal per sesi per cabang dan tipe kelas, dasar perhitungan laba. */
  @Get('session-costs')
  daftarModalSesi(@Req() req: AuthenticatedRequest) {
    return this.modalSesi.daftar(req.principal);
  }

  @Post('session-costs')
  simpanModalSesi(@Req() req: AuthenticatedRequest, @Body() body: Record<string, unknown>) {
    return this.modalSesi.simpan(req.principal, body ?? {});
  }

  @Delete('session-costs/:id')
  hapusModalSesi(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.modalSesi.hapus(req.principal, id);
  }

  /** Honor instruktur yang akan ditransfer: tanggal 1 sampai hari ini (tanggal 1: bulan lalu). */
  @Get('instructor-transfers')
  daftarTransferHonor(
    @Req() req: AuthenticatedRequest,
    @Query('from') from?: string,
    @Query('until') until?: string,
  ) {
    return this.transferHonor.ringkasan(req.principal, { from, until });
  }

  /** Berkas Excel Multi Payroll KlikBCA Bisnis (base64). */
  @Post('instructor-transfers/export')
  unduhTransferHonor(@Req() req: AuthenticatedRequest, @Body() body: { from?: string; until?: string }) {
    return this.transferHonor.unduh(req.principal, body ?? {});
  }

  @Put('instructor-transfers/accounts/:instructorId')
  simpanRekeningInstruktur(
    @Req() req: AuthenticatedRequest,
    @Param('instructorId') instructorId: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.transferHonor.simpanRekening(req.principal, instructorId, body ?? {});
  }

  /** Payroll instruktur yang sedang masuk: kelas terverifikasi dan koreksi jam satu bulan. */
  @SelfService()
  @Get('me/payroll')
  payrollSaya(@Req() req: AuthenticatedRequest, @Query('period') period?: string) {
    return this.payroll.milikSaya(req.principal, { period });
  }

  /** Omzet, payroll, pengeluaran, dan laba satu bulan: total dan per cabang. */
  @Get('finance/owner-month')
  bulanan(@Req() req: AuthenticatedRequest, @Query('period') period?: string) {
    return this.ringkasan.ringkasanBulanan(req.principal, { period });
  }

  /** Jurnal kas sederhana: uang masuk dari paket lunas, uang keluar dari pengeluaran cabang. */
  @Get('cash-journal')
  jurnal(
    @Req() req: AuthenticatedRequest,
    @Query('branchId') branchId?: string,
    @Query('period') period?: string,
  ) {
    return this.ringkasan.jurnalKas(req.principal, { branchId, period });
  }

  /** Koreksi jam mengajar satu kelas, wajib alasan dan berkas bukti. */
  @Post('instructor-hour-adjustments')
  @UseInterceptors(FileInterceptor('evidence', { limits: { fileSize: 8_000_000, files: 1 } }))
  koreksi(
    @Req() req: AuthenticatedRequest,
    @Body() body: { classSlotId?: string; instructorId?: string; hours?: string; reason?: string },
    @UploadedFile() evidence?: { buffer?: Buffer },
  ) {
    return this.koreksiJam.koreksi(req.principal, body, evidence);
  }

  @Get('instructor-hour-adjustments')
  daftarKoreksi(
    @Req() req: AuthenticatedRequest,
    @Query('branchId') branchId?: string,
    @Query('limit') limit?: string,
  ) {
    return this.koreksiJam.daftar(req.principal, {
      branchId,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get('instructor-hour-adjustments/:id/evidence')
  async buktiKoreksi(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const file = await this.koreksiJam.bukti(req.principal, id);
    response.set({
      'Cache-Control': 'private, no-store, max-age=0',
      'Content-Type': file.mimeType,
      'Content-Disposition': 'inline; filename="bukti-koreksi-jam"',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
    });
    return new StreamableFile(file.stream);
  }
}
