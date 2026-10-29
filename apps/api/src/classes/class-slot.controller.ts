import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { AuthGuard, type AuthenticatedRequest } from '../identity/auth.guard';
import { ClassSlotService, type ClassSlotCancellationReason } from './slot-kelas.service';

@Controller('class-slots')
@UseGuards(AuthGuard)
export class ClassSlotController {
  constructor(private readonly slots: ClassSlotService) {}

  @Get()
  list(
    @Req() req: AuthenticatedRequest,
    @Query('branchId') branchId?: string,
    @Query('status') status?: string,
    @Query('from') from?: string,
    @Query('until') until?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
    @Query('includeHistorical') includeHistorical?: string,
  ) {
    return this.slots.list(req.principal, {
      branchId,
      status,
      from,
      until,
      cursor,
      limit: limit ? Number(limit) : undefined,
      includeHistorical: includeHistorical === 'true',
    });
  }

  @Post()
  create(
    @Req() req: AuthenticatedRequest,
    @Headers('idempotency-key') key: string,
    @Body()
    body: {
      branchId: string;
      classTypeId: string;
      studioId: string;
      roomId?: string;
      instructorUserId?: string;
      startAt: string;
      endAt: string;
    },
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.respond(
      res,
      this.slots.create(req.principal, body, key, req.correlationId ?? 'unknown'),
    );
  }

  @Post(':id/assign-instructor')
  assign(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Headers('idempotency-key') key: string,
    @Body() body: { instructorUserId: string; expectedVersion?: number },
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.respond(
      res,
      this.slots.assign(req.principal, id, body, key, req.correlationId ?? 'unknown'),
    );
  }

  @Patch(':id')
  update(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Headers('idempotency-key') key: string,
    @Body()
    body: {
      classTypeId: string;
      studioId?: string;
      roomId?: string | null;
      instructorUserId?: string | null;
      startAt: string;
      endAt: string;
      expectedVersion?: number;
      reason: string;
    },
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.respond(
      res,
      this.slots.update(req.principal, id, body, key, req.correlationId ?? 'unknown'),
    );
  }

  @Post(':id/publish')
  publish(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Headers('idempotency-key') key: string,
    @Body() body: { expectedVersion: number },
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.respond(
      res,
      this.slots.publish(req.principal, id, body, key, req.correlationId ?? 'unknown'),
    );
  }

  @Post(':id/cancel')
  cancel(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Headers('idempotency-key') key: string,
    @Body() body: { reasonCode: ClassSlotCancellationReason; expectedVersion: number },
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.respond(
      res,
      this.slots.cancel(req.principal, id, body, key, req.correlationId ?? 'unknown'),
    );
  }

  @Post(':id/complete')
  complete(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Headers('idempotency-key') key: string,
    @Body() body: { expectedVersion?: number; controlHash?: string; reason?: string },
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.respond(
      res,
      this.slots.complete(req.principal, id, body, key, req.correlationId ?? 'unknown'),
    );
  }

  @Get(':id/completion-control')
  completionControl(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.slots.completionControl(req.principal, id);
  }

  private async respond(res: Response, promise: ReturnType<ClassSlotService['create']>) {
    const result = await promise;
    res.status(result.status);
    res.setHeader('Idempotency-Replayed', String(result.replay));
    return { ...(result.body as object), idempotentReplay: result.replay };
  }
}
