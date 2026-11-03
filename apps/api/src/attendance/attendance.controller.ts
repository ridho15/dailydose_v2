import { Body, Controller, Get, Headers, Param, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard, type AuthenticatedRequest } from '../identity/auth.guard';
import { Roles } from '../identity/roles.decorator';
import { RolesGuard } from '../identity/roles.guard';
import { AttendanceService } from './kehadiran.service';
import { buildPass } from './check-in-pass';
import { SelfService } from '../identity/route-access';

@Controller()
@UseGuards(AuthGuard)
export class AttendanceController {
  constructor(private readonly attendance: AttendanceService) {}

  /**
   * QR tetap milik akun yang sedang masuk. Member dan instruktur menyimpannya di ponsel sekali,
   * lalu memindainya di tablet studio setiap datang tanpa perlu masuk ke aplikasi.
   */
  @SelfService()
  @Get('me/check-in-pass')
  myCheckInPass(@Req() request: AuthenticatedRequest) {
    return { pass: buildPass(request.principal.userId) };
  }

  @Post('bookings/:id/customer-check-in-links')
  issue(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Headers('idempotency-key') idempotencyKey?: string,
    @Body() body?: { expectedVersion?: number },
  ) {
    return this.attendance.issue(
      request.principal,
      id,
      body ?? {},
      idempotencyKey || `key-checkin-${id}-${Date.now()}`,
      request.correlationId ?? 'unknown',
    );
  }

  @Post('class-slots/:id/customer-check-in-links/bulk')
  issueBulk(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Headers('idempotency-key') idempotencyKey: string,
    @Body() body: { bookingIds?: string[] },
  ) {
    return this.attendance.issueBulk(
      request.principal,
      id,
      body,
      idempotencyKey,
      request.correlationId ?? 'unknown',
    );
  }

  @Post('class-slots/:id/instructor-check-in-tokens')
  issueInstructor(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Headers('idempotency-key') idempotencyKey: string,
  ) {
    return this.attendance.issueInstructor(
      request.principal,
      id,
      idempotencyKey,
      request.correlationId ?? 'unknown',
    );
  }

  @Post('class-slots/:id/instructor-attendance')
  verifyInstructorAttendance(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: { notes?: string },
  ) {
    return this.attendance.verifyInstructorAttendance(request.principal, id, body);
  }

  @Get('check-in-tokens/:id')
  status(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    return this.attendance.status(request.principal, id);
  }

  @Post('check-in-tokens/:id/revoke')
  revoke(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: { expectedVersion: number; reason: string },
  ) {
    return this.attendance.revoke(request.principal, id, body, request.correlationId ?? 'unknown');
  }

  @Post('check-ins/customers')
  consume(
    @Req() request: AuthenticatedRequest,
    @Headers('idempotency-key') idempotencyKey: string,
    @Body() body: { token: string },
  ) {
    return this.attendance.consume(
      request.principal,
      body,
      idempotencyKey,
      request.correlationId ?? 'unknown',
    );
  }

  @Post('check-ins/customers/backfill')
  async backfillCustomer(
    @Req() request: AuthenticatedRequest,
    @Headers('idempotency-key') idempotencyKey: string,
    @Body() body: { bookingId: string; reason: string; expectedVersion: number },
  ) {
    const result = await this.attendance.backfillCustomer(
      request.principal,
      body,
      idempotencyKey,
      request.correlationId ?? 'unknown',
    );
    return { ...(result.body as object), idempotentReplay: result.replay };
  }

  @Post('bookings/:id/status-correction')
  @UseGuards(RolesGuard)
  @Roles('SUPER_OWNER')
  async correctStatus(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Headers('idempotency-key') idempotencyKey: string,
    @Body() body: { toStatus?: string; reason?: string },
  ) {
    const result = await this.attendance.correctStatus(
      request.principal,
      id,
      body,
      idempotencyKey,
      request.correlationId ?? 'unknown',
    );
    return { ...(result.body as object), idempotentReplay: result.replay };
  }

  @Post('check-ins/instructors')
  consumeInstructor(
    @Req() request: AuthenticatedRequest,
    @Headers('idempotency-key') idempotencyKey: string,
    @Body() body: { token: string; latitude?: number; longitude?: number },
  ) {
    return this.attendance.consumeInstructor(
      request.principal,
      body,
      idempotencyKey,
      request.correlationId ?? 'unknown',
    );
  }
}
