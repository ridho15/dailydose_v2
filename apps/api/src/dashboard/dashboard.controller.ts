import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { SelfService } from '../identity/route-access';
import { AuthGuard, type AuthenticatedRequest } from '../identity/auth.guard';
import { DashboardService } from './dashboard.service';

@Controller('dashboard')
@UseGuards(AuthGuard)
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get('overview')
  overview(
    @Req() request: AuthenticatedRequest,
    @Query('branchId') branchId?: string,
    @Query('from') from?: string,
    @Query('until') until?: string,
  ) {
    return this.dashboard.overview(request.principal, { branchId, from, until });
  }
}

@Controller('me')
@UseGuards(AuthGuard)
export class CustomerDashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  /** `?segar=1` setelah member booking/batal/pindah jadwal: lewati cache 20 detik agar angkanya baru. */
  @SelfService()
  @Get('dashboard')
  overview(@Req() request: AuthenticatedRequest, @Query('segar') segar?: string) {
    return this.dashboard.customerOverview(request.principal, { forceRefresh: segar === '1' });
  }
}
