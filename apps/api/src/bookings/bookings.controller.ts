import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { SelfService } from '../identity/route-access';
import { AuthGuard, type AuthenticatedRequest } from '../identity/auth.guard';
import {
  BookingsService,
  type BookingCommand,
  type CancelBookingCommand,
  type WalkInCommand,
} from './pemesanan-kelas.service';
import { ReschedulesService } from './ubah-jadwal.service';
import { PembatalanTerlambatService } from './pembatalan-terlambat.service';

@Controller('bookings')
@UseGuards(AuthGuard)
export class BookingsController {
  constructor(
    private readonly bookings: BookingsService,
    private readonly reschedules: ReschedulesService,
    private readonly pembatalan: PembatalanTerlambatService,
  ) {}

  /** Pembatalan setelah batas H-24: admin mengajukan, Manager/Owner memutuskan. */
  @Get('late-cancellations')
  pembatalanTertunda(@Req() request: AuthenticatedRequest, @Query('classSlotId') classSlotId = '') {
    return this.pembatalan.tertunda(request.principal, classSlotId);
  }

  @Post('late-cancellations/:requestId/:decision')
  putuskanPembatalan(
    @Req() request: AuthenticatedRequest,
    @Param('requestId') requestId: string,
    @Param('decision') decision: string,
    @Body() body: { expectedVersion?: number; note?: string },
  ) {
    return this.pembatalan.putuskan(request.principal, requestId, decision, body ?? {});
  }

  @Post(':id/late-cancellation')
  ajukanPembatalan(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: { reason?: string; isMedical?: boolean; releaseSeat?: boolean },
  ) {
    return this.pembatalan.ajukan(request.principal, id, body ?? {});
  }

  @SelfService()
  @Get('options/:classSlotId')
  options(@Req() request: AuthenticatedRequest, @Param('classSlotId') classSlotId: string) {
    return this.bookings.customerOptions(request.principal, classSlotId);
  }

  @Get()
  list(
    @Req() request: AuthenticatedRequest,
    @Query('branchId') branchId?: string,
    @Query('status') status?: string,
    @Query('cursor') cursor?: string,
    @Query('page') page?: string,
    @Query('timeline') timeline?: string,
    @Query('q') q?: string,
    @Query('from') from?: string,
    @Query('until') until?: string,
    @Query('classSlotId') classSlotId?: string,
    @Query('customerId') customerId?: string,
    @Query('limit') limit?: string,
    @Query('includeHistorical') includeHistorical?: string,
  ) {
    return this.bookings.list(request.principal, {
      branchId,
      status,
      cursor,
      page: page ? Number(page) : undefined,
      timeline,
      q,
      from,
      until,
      classSlotId,
      customerId,
      limit: limit ? Number(limit) : undefined,
      includeHistorical: includeHistorical === 'true',
    });
  }

  @Get(':id/reschedule-options')
  rescheduleOptions(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    return this.reschedules.options(request.principal, id);
  }

  @Get(':id/cancellation-options')
  cancellationOptions(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    return this.bookings.cancellationOptions(request.principal, id);
  }

  @Get(':id')
  detail(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    return this.bookings.detail(request.principal, id);
  }

  @Post()
  async create(
    @Req() request: AuthenticatedRequest,
    @Headers('idempotency-key') key: string,
    @Body() body: BookingCommand,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.bookings.create(
      request.principal,
      body,
      key,
      request.correlationId ?? 'unknown',
    );
    response.status(result.status);
    response.setHeader('Idempotency-Replayed', String(result.replay));
    return { ...(result.body as object), idempotentReplay: result.replay };
  }

  @Post(':id/cancel')
  async cancel(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Headers('idempotency-key') key: string,
    @Body() body: CancelBookingCommand,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.bookings.cancel(
      request.principal,
      id,
      body,
      key,
      request.correlationId ?? 'unknown',
    );
    response.status(result.status);
    response.setHeader('Idempotency-Replayed', String(result.replay));
    return { ...(result.body as object), idempotentReplay: result.replay };
  }
  @Post('walk-in')
  async walkIn(
    @Req() request: AuthenticatedRequest,
    @Headers('idempotency-key') key: string,
    @Body() body: WalkInCommand,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.bookings.walkIn(
      request.principal,
      body,
      key,
      request.correlationId ?? 'unknown',
    );
    response.status(result.status);
    response.setHeader('Idempotency-Replayed', String(result.replay));
    return { ...(result.body as object), idempotentReplay: result.replay };
  }
}
