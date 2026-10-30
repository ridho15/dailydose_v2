import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard, type AuthenticatedRequest } from '../identity/auth.guard';
import { LedgerService } from './ledger.service';

@Controller()
@UseGuards(AuthGuard)
export class LedgerController {
  constructor(private readonly ledger: LedgerService) {}

  @Get('customer-packages')
  listCustomerPackages(
    @Req() req: AuthenticatedRequest,
    @Query('branchId') branchId?: string,
    @Query('cursor') cursor?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('customerUserId') customerUserId?: string,
  ) {
    return this.ledger.listCustomerPackages(req.principal, {
      branchId,
      cursor,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
      search,
      status,
      customerUserId,
    });
  }

  @Get('customer-packages/:id/ledger')
  getPackageLedger(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.ledger.getPackageLedger(req.principal, id, cursor);
  }

  // Perpanjang masa berlaku, bekukan, atau buka kembali paket pelanggan (izin `customer-package:manage`).
  @Post('customer-packages/:id/:action')
  manageCustomerPackage(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Param('action') action: string | undefined,
    @Body() body: { days?: number; reason?: string; expectedValidUntil?: string },
  ) {
    return this.ledger.manageCustomerPackage(req.principal, id, action, body);
  }

  @Get('customer-packages/:id/members')
  listPackageMembers(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
  ) {
    return this.ledger.listPackageMembers(req.principal, id);
  }

  @Post('customer-packages/:id/members')
  addPackageMember(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: { userId: string; relationship?: string },
  ) {
    return this.ledger.addPackageMember(req.principal, id, body);
  }

  @Delete('customer-packages/:id/members/:userId')
  removePackageMember(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Param('userId') userId: string,
  ) {
    return this.ledger.removePackageMember(req.principal, id, userId);
  }

  @Get('session-adjustments')
  listAdjustments(
    @Req() req: AuthenticatedRequest,
    @Query('branchId') branchId?: string,
    @Query('status') status?: string,
    @Query('cursor') cursor?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('q') q?: string,
    @Query('customerUserId') customerUserId?: string,
    @Query('from') from?: string,
    @Query('until') until?: string,
    @Query('limit') limit?: string,
  ) {
    return this.ledger.listAdjustments(req.principal, {
      branchId,
      status,
      cursor,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
      q,
      customerUserId,
      from,
      until,
      limit,
    });
  }

  @Get('session-adjustments/:id')
  getAdjustment(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
  ) {
    return this.ledger.getAdjustment(req.principal, id);
  }

  @Post('session-adjustments')
  requestAdjustment(
    @Req() req: AuthenticatedRequest,
    @Body()
    body: {
      customerPackageId?: string;
      quantity?: number;
      reasonCode?: string;
      note?: string;
      direct?: boolean;
    },
  ) {
    return this.ledger.requestAdjustment(req.principal, body);
  }

  // Eksekusi langsung penyesuaian sesi (Direct Adjustment 1-Klik) untuk Manager, Super Owner, Superadmin.
  @Post('session-adjustments/direct')
  directAdjustment(
    @Req() req: AuthenticatedRequest,
    @Body()
    body: {
      customerPackageId?: string;
      quantity?: number;
      reasonCode?: string;
      note?: string;
    },
  ) {
    return this.ledger.directAdjustment(req.principal, body);
  }

  // Kontrak generated client (`decideSessionAdjustment`): POST /session-adjustments/{id}/{approve|reject}.
  @Post('session-adjustments/:id/:decision')
  decideAdjustment(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Param('decision') decision: string | undefined,
    @Body() body: { reasonCode?: string; note?: string; expectedVersion?: number },
  ) {
    return this.ledger.decideAdjustment(req.principal, id, decision, body);
  }
}
