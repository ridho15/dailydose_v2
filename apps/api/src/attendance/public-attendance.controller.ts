import { Public } from '../identity/route-access';
import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { AttendanceService } from './kehadiran.service';

@Public()
@Controller('check-ins')
export class PublicAttendanceController {
  constructor(private readonly attendance: AttendanceService) {}

  @Get('customer-link-info')
  getCustomerLinkInfo(@Query('token') token: string) {
    return this.attendance.getCustomerLinkInfo(token);
  }

  @Post('customers/confirm-link')
  confirmCustomerLink(@Body() body: { token: string }) {
    return this.attendance.confirmCustomerLink(body.token);
  }
}
