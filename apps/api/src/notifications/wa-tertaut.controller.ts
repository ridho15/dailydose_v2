import { Controller, Delete, Get, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard, type AuthenticatedRequest } from '../identity/auth.guard';
import { SelfService } from '../identity/route-access';
import { WaTertautService } from './wa-tertaut.service';

/** WhatsApp admin yang ditautkan lewat QR untuk pesan otomatis ke member cabangnya. Hanya Admin. */
// WhatsApp milik penanya sendiri; service menolak selain Admin cabang (WA_LINK_ADMIN_ONLY).
@SelfService()
@Controller('me/whatsapp-link')
@UseGuards(AuthGuard)
export class WaTertautController {
  constructor(private readonly wa: WaTertautService) {}

  @Get()
  status(@Req() req: AuthenticatedRequest) {
    return this.wa.status(req.principal);
  }

  @Post()
  mulai(@Req() req: AuthenticatedRequest) {
    return this.wa.mulai(req.principal);
  }

  @Post('test')
  uji(@Req() req: AuthenticatedRequest) {
    return this.wa.uji(req.principal);
  }

  @Delete()
  putuskan(@Req() req: AuthenticatedRequest) {
    return this.wa.putuskan(req.principal);
  }
}
