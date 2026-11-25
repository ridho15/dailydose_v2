import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard, type AuthenticatedRequest } from './auth.guard';
import { PetugasCheckinService } from './petugas-checkin.service';

/** Akun Petugas Check-in (sales/OB): Manager cabang dan Super Owner. */
@Controller('checkin-staff')
@UseGuards(AuthGuard)
export class PetugasCheckinController {
  constructor(private readonly petugas: PetugasCheckinService) {}

  @Get()
  daftar(@Req() req: AuthenticatedRequest, @Query('branchId') branchId?: string) {
    return this.petugas.daftar(req.principal, { branchId });
  }

  @Post()
  buat(@Req() req: AuthenticatedRequest, @Body() body: Record<string, unknown>) {
    return this.petugas.buat(req.principal, body ?? {});
  }

  @Post(':userId/password')
  gantiPassword(@Req() req: AuthenticatedRequest, @Param('userId') userId: string, @Body() body: { password?: unknown }) {
    return this.petugas.gantiPassword(req.principal, userId, body ?? {});
  }

  @Post(':userId/deactivate')
  nonaktifkan(@Req() req: AuthenticatedRequest, @Param('userId') userId: string) {
    return this.petugas.ubahStatus(req.principal, userId, false);
  }

  @Post(':userId/reactivate')
  aktifkan(@Req() req: AuthenticatedRequest, @Param('userId') userId: string) {
    return this.petugas.ubahStatus(req.principal, userId, true);
  }
}
