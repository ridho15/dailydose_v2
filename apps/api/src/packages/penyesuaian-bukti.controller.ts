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
import { PenyesuaianBuktiService } from './penyesuaian-bukti.service';

@Controller()
@UseGuards(AuthGuard)
export class PenyesuaianBuktiController {
  constructor(private readonly penyesuaian: PenyesuaianBuktiService) {}

  /** Penyesuaian sesi yang langsung berlaku, wajib alasan dan berkas bukti. */
  @Post('session-adjustments/with-evidence')
  @UseInterceptors(FileInterceptor('evidence', { limits: { fileSize: 8_000_000, files: 1 } }))
  sesuaikan(
    @Req() req: AuthenticatedRequest,
    @Body()
    body: { customerPackageId?: string; quantity?: string; reason?: string; bookingId?: string; ownerApproved?: string },
    @UploadedFile() evidence?: { buffer?: Buffer; size?: number },
  ) {
    return this.penyesuaian.sesuaikan(req.principal, body, evidence);
  }

  @Get('session-adjustments/:id/evidence')
  async bukti(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const file = await this.penyesuaian.bukti(req.principal, id);
    response.set({
      'Cache-Control': 'private, no-store, max-age=0',
      'Content-Type': file.mimeType,
      'Content-Disposition': 'inline; filename="bukti-penyesuaian"',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
    });
    return new StreamableFile(file.stream);
  }
}
