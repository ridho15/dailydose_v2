import { Controller, Param, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard, type AuthenticatedRequest } from '../identity/auth.guard';
import { KirimQrService } from './kirim-qr.service';

@Controller()
@UseGuards(AuthGuard)
export class KirimQrController {
  constructor(private readonly kirimQr: KirimQrService) {}

  /** Staf mengirim QR kehadiran ke WhatsApp member atau instruktur. */
  @Post('users/:id/check-in-qr/whatsapp')
  kirim(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.kirimQr.kirimManual(req.principal, id);
  }
}
