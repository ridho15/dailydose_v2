import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard, type AuthenticatedRequest } from '../identity/auth.guard';
import { MasterCatalogService } from './master-catalog.service';
import { EffectiveSettingsService, type SettingInput } from './konfigurasi-efektif.service';
import { type PublicProfileInput } from './public-profile-admin.service';

@Controller()
@UseGuards(AuthGuard)
export class MasterController {
  constructor(
    private readonly catalog: MasterCatalogService,
    private readonly settings: EffectiveSettingsService,
  ) {}
  @Get('branches') listBranches(
    @Req() req: AuthenticatedRequest,
    @Query('q') q?: string,
    @Query('status') status?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.catalog.listBranches(req.principal, { q, status, cursor, limit });
  }
  @Get('branches/:id') branchDetail(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.catalog.branchDetail(req.principal, id);
  }
  @Get('branches/:id/studios') listStudios(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Query('includeInactive') includeInactive?: string,
  ) {
    return this.catalog.listStudios(req.principal, id, includeInactive === 'true');
  }
  @Post('branches/:id/studios') createStudio(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body()
    body: {
      code: string;
      name: string;
      equipmentText?: string | null;
      contactPhoneE164?: string | null;
      imageKey?: string | null;
    },
  ) {
    return this.catalog.createStudio(req.principal, id, body, req.correlationId ?? 'unknown');
  }
  @Patch('studios/:id') updateStudio(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body()
    body: {
      name: string;
      equipmentText?: string | null;
      contactPhoneE164?: string | null;
      imageKey?: string | null;
      active?: boolean;
      reason?: string;
    },
  ) {
    return this.catalog.updateStudio(req.principal, id, body, req.correlationId ?? 'unknown');
  }
  @Get('studios/:id/rooms') listRooms(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Query('includeInactive') includeInactive?: string,
  ) {
    return this.catalog.listRooms(req.principal, id, includeInactive === 'true');
  }
  @Post('studios/:id/rooms') createRoom(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: { code: string; name: string; capacity?: number | null },
  ) {
    return this.catalog.createRoom(req.principal, id, body, req.correlationId ?? 'unknown');
  }
  @Patch('rooms/:id') updateRoom(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: { name: string; capacity?: number | null; active?: boolean; reason?: string },
  ) {
    return this.catalog.updateRoom(req.principal, id, body, req.correlationId ?? 'unknown');
  }
  @Post('branches') createBranch(
    @Req() req: AuthenticatedRequest,
    @Headers('idempotency-key') key: string | undefined,
    @Body()
    body: {
      code: string;
      name: string;
      timezone: string;
      supportWhatsappE164?: string | null;
      reason?: string;
    },
  ) {
    return this.catalog.createBranch(req.principal, body, req.correlationId ?? 'unknown', key);
  }
  @Post('branches/:id/deactivate') deactivateBranch(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body() body?: { expectedVersion?: number; reason?: string },
  ) {
    return key
      ? this.catalog.transitionBranch(
          req.principal,
          id,
          'INACTIVE',
          { expectedVersion: body?.expectedVersion ?? 1, reason: body?.reason },
          key,
          req.correlationId ?? 'unknown',
        )
      : this.catalog.deactivateBranch(
          req.principal,
          id,
          body?.expectedVersion,
          req.correlationId ?? 'unknown',
          body?.reason,
        );
  }
  @Post('branches/:id/reactivate') reactivateBranch(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body() body?: { expectedVersion?: number; reason?: string },
  ) {
    return this.catalog.transitionBranch(
      req.principal,
      id,
      'ACTIVE',
      { expectedVersion: body?.expectedVersion ?? 1, reason: body?.reason },
      key,
      req.correlationId ?? 'unknown',
    );
  }
  @Patch('branches/:id') updateBranch(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body()
    body: {
      name?: string;
      timezone?: string;
      supportWhatsappE164?: string | null;
      latitude?: number | null;
      longitude?: number | null;
      geofenceRadiusMeters?: number;
      expectedVersion?: number;
      reason?: string;
    },
  ) {
    return this.catalog.updateBranch(req.principal, id, body, key, req.correlationId ?? 'unknown');
  }
  @Get('class-types') listClassTypes(
    @Req() req: AuthenticatedRequest,
    @Query('branchId') branchId?: string,
    @Query('status') status?: 'ACTIVE' | 'INACTIVE' | 'ARCHIVED' | 'ALL',
  ) {
    return this.catalog.listClassTypes(req.principal, branchId, status);
  }
  @Post('class-types') createClassType(
    @Req() req: AuthenticatedRequest,
    @Body()
    body: {
      code: string;
      name: string;
      description?: string | null;
      modality?: 'GROUP' | 'PRIVATE' | 'HYBRID' | 'UNKNOWN_LEGACY';
      defaultDurationMinutes?: number;
      defaultMinimumQuota?: number;
      defaultCapacity?: number;
      branchIds?: string[];
    },
  ) {
    return this.catalog.createClassType(req.principal, body, req.correlationId ?? 'unknown');
  }
  @Put('class-types/:id/scopes') replaceClassTypeScopes(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: { branchIds: string[]; expectedVersion: number; reason: string },
  ) {
    return this.catalog.replaceClassTypeScopes(
      req.principal,
      id,
      body,
      req.correlationId ?? 'unknown',
    );
  }
  @Post('class-types/:id/deactivate') deactivateClassType(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body() body: { expectedVersion: number; reason?: string },
  ) {
    return key
      ? this.catalog.deactivateClassTypeIdempotent(
          req.principal,
          id,
          {
            expectedVersion: body.expectedVersion,
            reason: body.reason,
          },
          key,
          req.correlationId ?? 'unknown',
        )
      : this.catalog.deactivateClassType(
          req.principal,
          id,
          body.expectedVersion,
          req.correlationId ?? 'unknown',
        );
  }
  @Patch('class-types/:id') updateClassType(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body() body: { name: string; expectedVersion: number; reason: string },
  ) {
    return this.catalog.updateClassType(
      req.principal,
      id,
      body,
      key,
      req.correlationId ?? 'unknown',
    );
  }
  @Post('class-types/:id/reactivate') reactivateClassType(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body() body: { expectedVersion: number; reason: string },
  ) {
    return this.catalog.reactivateClassType(
      req.principal,
      id,
      body,
      key,
      req.correlationId ?? 'unknown',
    );
  }
  @Get('instructor-fees') listFees(
    @Req() req: AuthenticatedRequest,
    @Query('branchId') branchId?: string,
  ) {
    return this.settings.list(req.principal, 'INSTRUCTOR_FEE', branchId);
  }
  @Post('instructor-fees') createFee(@Req() req: AuthenticatedRequest, @Body() body: SettingInput) {
    return this.settings.create(
      req.principal,
      { ...body, kind: 'INSTRUCTOR_FEE' },
      req.correlationId ?? 'unknown',
    );
  }
  @Delete('instructor-fees/:id') deleteFee(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body?: { reason?: string; salahInput?: boolean },
  ) {
    return this.settings.remove(
      req.principal,
      'INSTRUCTOR_FEE',
      id,
      req.correlationId ?? 'unknown',
      body?.reason,
      body?.salahInput === true,
    );
  }
  /** Kelas dan honor yang berubah bila versi tarif ini dihapus. */
  @Get('instructor-fees/:id/impact') feeImpact(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
  ) {
    return this.settings.dampakHapus(req.principal, id);
  }
  @Get('quota-capacity-settings') listQuota(
    @Req() req: AuthenticatedRequest,
    @Query('branchId') branchId?: string,
  ) {
    return this.settings.list(req.principal, 'QUOTA_CAPACITY', branchId);
  }
  @Post('quota-capacity-settings') createQuota(
    @Req() req: AuthenticatedRequest,
    @Body() body: SettingInput,
  ) {
    return this.settings.create(
      req.principal,
      { ...body, kind: 'QUOTA_CAPACITY' },
      req.correlationId ?? 'unknown',
    );
  }
  @Get('min-quota-settings') listMinQuota(
    @Req() req: AuthenticatedRequest,
    @Query('branchId') branchId?: string,
  ) {
    return this.settings.list(req.principal, 'QUOTA_CAPACITY', branchId);
  }
  @Post('min-quota-settings') createMinQuota(
    @Req() req: AuthenticatedRequest,
    @Body() body: SettingInput,
  ) {
    return this.settings.create(
      req.principal,
      { ...body, kind: 'QUOTA_CAPACITY' },
      req.correlationId ?? 'unknown',
    );
  }

  @Get('master/public-profiles')
  listPublicProfiles(@Req() req: AuthenticatedRequest, @Query('branchId') branchId: string) {
    return this.catalog.listPublicProfiles(req.principal, branchId);
  }

  @Patch('master/public-profiles/:kind/:id')
  updatePublicProfile(
    @Req() req: AuthenticatedRequest,
    @Param('kind') kind: 'branch' | 'class' | 'package',
    @Param('id') id: string,
    @Body() body: PublicProfileInput,
  ) {
    return this.catalog.updatePublicProfile(
      req.principal,
      kind,
      id,
      body,
      req.correlationId ?? 'unknown',
    );
  }
}
