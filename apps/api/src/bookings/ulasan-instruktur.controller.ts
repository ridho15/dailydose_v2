import { Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard, type AuthenticatedRequest } from '../identity/auth.guard';
import { SelfService } from '../identity/route-access';
import { UlasanInstrukturService, type KirimUlasan } from './ulasan-instruktur.service';

@Controller()
@UseGuards(AuthGuard)
export class UlasanInstrukturController {
  constructor(private readonly ulasan: UlasanInstrukturService) {}

  /** Kelas yang sudah dihadiri dan belum diulas; dipakai beranda member dan lembar booking. */
  @SelfService()
  @Get('me/instructor-reviews/pending')
  tertunda(@Req() req: AuthenticatedRequest) {
    return this.ulasan.tertunda(req.principal);
  }

  @SelfService()
  @Post('me/instructor-reviews')
  kirim(@Req() req: AuthenticatedRequest, @Body() body: KirimUlasan) {
    return this.ulasan.kirim(req.principal, body ?? {});
  }

  /** Laporan internal untuk Owner, Manager, dan Super Owner. */
  @Get('instructor-reviews')
  laporan(
    @Req() req: AuthenticatedRequest,
    @Query('branchId') branchId?: string,
    @Query('from') from?: string,
    @Query('until') until?: string,
  ) {
    return this.ulasan.laporan(req.principal, { branchId, from, until });
  }
}
