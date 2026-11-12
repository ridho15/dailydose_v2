import {
  Body,
  Controller,
  Get,
  Param,
  Post,
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
import { Roles } from '../identity/roles.decorator';
import { RolesGuard } from '../identity/roles.guard';
import { RefundPaketService } from './refund-paket.service';

/** Refund paket member: Admin, Manager, Owner, Super Owner (cakupan cabang diperiksa di service). */
@Controller()
@UseGuards(AuthGuard, RolesGuard)
@Roles('ADMIN', 'MANAGER', 'OWNER', 'SUPER_OWNER')
export class RefundPaketController {
  constructor(private readonly refund: RefundPaketService) {}

  @Get('customer-packages/:id/refund-preview')
  pratinjau(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.refund.pratinjau(req.principal, id);
  }

  @Post('package-refunds/:id')
  @UseInterceptors(FileInterceptor('bukti', { limits: { fileSize: 8_000_000, files: 1 } }))
  proses(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: { bankName?: string; nomorRekening?: string; namaRekening?: string; alasan?: string; batalkanBooking?: string },
    @UploadedFile() bukti?: { buffer?: Buffer; size?: number },
  ) {
    return this.refund.proses(req.principal, id, body ?? {}, bukti);
  }

  @Get('refunds/:id')
  surat(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.refund.surat(req.principal, id);
  }

  @Get('refunds/:id/bukti')
  async bukti(@Req() req: AuthenticatedRequest, @Param('id') id: string, @Res({ passthrough: true }) response: Response) {
    const file = await this.refund.bukti(req.principal, id);
    response.set({
      'Cache-Control': 'private, no-store, max-age=0',
      'Content-Type': file.mimeType,
      'Content-Disposition': 'inline; filename="bukti-refund"',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
    });
    return new StreamableFile(file.stream);
  }
}
