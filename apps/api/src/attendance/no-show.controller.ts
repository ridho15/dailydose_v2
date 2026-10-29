import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard, type AuthenticatedRequest } from '../identity/auth.guard';
import { LaporanOwnerService } from './laporan-owner.service';
import { NoShowService } from './no-show.service';

@Controller()
@UseGuards(AuthGuard)
export class NoShowController {
  constructor(private readonly noShow: NoShowService) {}

  /** Peserta yang tidak hadir dan sesinya hangus pada satu rentang tanggal. */
  @Get('attendance/no-shows')
  report(
    @Req() req: AuthenticatedRequest,
    @Query('branchId') branchId?: string,
    @Query('from') from?: string,
    @Query('until') until?: string,
    @Query('period') period?: string,
  ) {
    return this.noShow.report(req.principal, { branchId, from, until, period });
  }
}

@Controller()
@UseGuards(AuthGuard)
export class LaporanOwnerController {
  constructor(private readonly laporan: LaporanOwnerService) {}

  /** Kelas yang tetap jalan di bawah kuota dan pindaian studio yang ditolak, untuk Owner. */
  // Bukan di bawah `reports/`: rute `reports/:reportType` milik keuangan terdaftar lebih dulu dan
  // akan menjawab alamat itu dengan laporan omzet, sehingga panel Owner menerima bentuk data lain.
  @Get('attendance/owner-exceptions')
  report(
    @Req() req: AuthenticatedRequest,
    @Query('branchId') branchId?: string,
    @Query('from') from?: string,
    @Query('until') until?: string,
    @Query('period') period?: string,
  ) {
    return this.laporan.laporan(req.principal, { branchId, from, until, period });
  }
}
