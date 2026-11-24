import { Body, Controller, Get, Param, Post, Req, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { MAKS_BUKTI_PENGAJUAN_BYTE } from './bukti-pengajuan';
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

  /** JSON biasa atau multipart dengan berkas `evidence` (tidak wajib bagi member). */
  @Post(':id/late-cancellation')
  @UseInterceptors(FileInterceptor('evidence', { limits: { fileSize: MAKS_BUKTI_PENGAJUAN_BYTE, files: 1 } }))
  ajukan(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: { kodeAlasan?: string; lainnya?: string },
    @UploadedFile() evidence?: { buffer?: Buffer; size?: number },
  ) {
    return this.pengajuan.ajukan(request.principal, id, body ?? {}, evidence);
  }
}
