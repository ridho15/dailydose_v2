import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard, type AuthenticatedRequest } from '../identity/auth.guard';
import { PembatalanTerlambatMemberService } from './pembatalan-terlambat-member.service';

/** Pengajuan pembatalan kurang dari H-12 oleh member sendiri; diputus Manager/Owner/Super Owner. */
@Controller('me/bookings')
@UseGuards(AuthGuard)
export class PembatalanTerlambatMemberController {
  constructor(private readonly pengajuan: PembatalanTerlambatMemberService) {}

  @Get(':id/late-cancellation')
  status(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    return this.pengajuan.status(request.principal, id);
  }

  @Post(':id/late-cancellation')
  ajukan(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: { kodeAlasan?: string; lainnya?: string },
  ) {
    return this.pengajuan.ajukan(request.principal, id, body ?? {});
  }
}
