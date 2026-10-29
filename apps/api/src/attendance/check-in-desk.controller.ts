import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { AuthGuard, type AuthenticatedRequest } from '../identity/auth.guard';
import { CheckInDeskService } from './check-in-desk.service';
import { StudioCheckInService } from './studio-check-in.service';

@Controller()
@UseGuards(AuthGuard)
export class CheckInDeskController {
  constructor(
    private readonly desk: CheckInDeskService,
    private readonly studioCheckIn: StudioCheckInService,
  ) {}

  /**
   * Staf memindai QR tetap milik member atau instruktur (kamera atau barcode scanner) di meja
   * check-in cabangnya. Menggantikan tablet kiosk ber-PIN.
   */
  @Post('attendance/desk/scan')
  pindai(@Req() req: AuthenticatedRequest, @Body() body: { branchId?: string; pass?: unknown }) {
    return this.studioCheckIn.pindai(req.principal, body?.branchId, body?.pass);
  }

  /** Kelas hari ini, kehadiran yang sudah tercatat, dan kelas yang perlu diputuskan atau ditutup. */
  @Get('attendance/desk')
  meja(@Req() req: AuthenticatedRequest, @Query('branchId') branchId?: string) {
    return this.desk.meja(req.principal, { branchId });
  }

  /** Kelas tetap berjalan walau di bawah kuota minimum; dicatat dan dilaporkan ke Super Owner. */
  @Post('attendance/desk/:classSlotId/continue-below-quota')
  tetapJalan(
    @Req() req: AuthenticatedRequest,
    @Param('classSlotId') classSlotId: string,
    @Body() body: { reason?: string },
  ) {
    return this.desk.tetapJalan(req.principal, classSlotId, body ?? {});
  }

  /** Foto selfie member yang punya kelas di cabang ini hari ini, untuk kartu check-in. */
  @Get('attendance/desk/members/:userId/photo')
  async foto(
    @Req() req: AuthenticatedRequest,
    @Param('userId') userId: string,
    @Query('branchId') branchId: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    const file = await this.desk.fotoMember(req.principal, { userId, branchId });
    response.set({
      'Cache-Control': 'private, no-store, max-age=0',
      'Content-Type': file.mimeType,
      'Content-Disposition': 'inline; filename="selfie"',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
    });
    return new StreamableFile(file.stream);
  }
}
