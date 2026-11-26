import {
  Body,
  Controller,
  Delete,
  Get,
  Patch,
  Param,
  Post,
  Query,
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
import { FinanceService } from './finance.service';

@Controller()
@UseGuards(AuthGuard)
export class FinanceController {
  constructor(private readonly finance: FinanceService) {}

  @Get('finance/reconciliation/overview')
  overview(
    @Req() req: AuthenticatedRequest,
    @Query('branchId') branchId?: string,
    @Query('from') from?: string,
    @Query('until') until?: string,
  ) {
    return this.finance.overview(req.principal, { branchId, from, until });
  }

  @Get('finance/owner-branch-performance')
  ownerBranchPerformance(
    @Req() req: AuthenticatedRequest,
    @Query('branchId') branchId?: string,
    @Query('from') from?: string,
    @Query('until') until?: string,
    @Query('period') period?: string,
  ) {
    return this.finance.ownerBranchPerformance(req.principal, { branchId, from, until, period });
  }

  // ============================================================================
  // LAPORAN KEUANGAN PER RENTANG TANGGAL (from/until; period=YYYY-MM sebagai singkatan satu bulan)
  // ============================================================================

  @Get('finance/reports/omset')
  omsetReport(
    @Req() req: AuthenticatedRequest,
    @Query('branchId') branchId?: string,
    @Query('from') from?: string,
    @Query('until') until?: string,
    @Query('period') period?: string,
  ) {
    return this.finance.omsetReport(req.principal, { branchId, from, until, period });
  }

  @Get('finance/reports/instructor-cost-realtime')
  instructorCostRealtime(
    @Req() req: AuthenticatedRequest,
    @Query('branchId') branchId?: string,
    @Query('from') from?: string,
    @Query('until') until?: string,
    @Query('period') period?: string,
  ) {
    return this.finance.realtimeInstructorCostReport(req.principal, { branchId, from, until, period });
  }

  @Get('finance/reports/other-costs')
  otherCostReport(
    @Req() req: AuthenticatedRequest,
    @Query('branchId') branchId?: string,
    @Query('from') from?: string,
    @Query('until') until?: string,
    @Query('period') period?: string,
  ) {
    return this.finance.otherCostReport(req.principal, { branchId, from, until, period });
  }

  @Get('finance/reports/profit-summary')
  profitSummary(
    @Req() req: AuthenticatedRequest,
    @Query('branchId') branchId?: string,
    @Query('from') from?: string,
    @Query('until') until?: string,
    @Query('period') period?: string,
  ) {
    return this.finance.profitReport(req.principal, { branchId, from, until, period });
  }

  // ============================================================================
  // BIAYA OPERASIONAL LAIN (BERTANGGAL)
  // ============================================================================

  /** Multipart: isian pengeluaran plus berkas `nota` (wajib, foto atau PDF, maks 8 MB). */
  @Post(['other-costs', 'finance/other-costs'])
  @UseInterceptors(FileInterceptor('nota', { limits: { fileSize: 8_000_000, files: 1 } }))
  createOtherCost(
    @Req() req: AuthenticatedRequest,
    @Body()
    body: {
      branchId: string;
      incurredOn?: string;
      period?: string;
      category: string;
      description: string;
      amountRp: number | string;
      dibayarOlehId?: string | null;
    },
    @UploadedFile() nota?: { buffer?: Buffer; size?: number },
  ) {
    // Isian multipart selalu teks: nominal dijadikan angka, pembayar kosong berarti kas cabang.
    return this.finance.createOtherCost(
      req.principal,
      { ...body, amountRp: Number(body?.amountRp), dibayarOlehId: body?.dibayarOlehId || null },
      nota,
    );
  }

  @Get(['other-costs/:id/nota', 'finance/other-costs/:id/nota'])
  async nota(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const file = await this.finance.notaPengeluaran(req.principal, id);
    response.set({
      'Cache-Control': 'private, no-store, max-age=0',
      'Content-Type': file.mimeType,
      'Content-Disposition': 'inline; filename="nota-pengeluaran"',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
    });
    return new StreamableFile(file.stream);
  }

  @Patch(['other-costs/:id', 'finance/other-costs/:id'])
  updateOtherCost(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body()
    body: {
      incurredOn?: string;
      category?: string;
      categoryCode?: string;
      description?: string;
      amountRp?: number;
    },
  ) {
    return this.finance.updateOtherCost(req.principal, id, body);
  }

  @Delete(['other-costs/:id', 'finance/other-costs/:id'])
  deleteOtherCost(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body?: { reason?: string },
  ) {
    return this.finance.deleteOtherCost(req.principal, id, body?.reason);
  }

  @Get(['other-costs', 'finance/other-costs'])
  otherCosts(
    @Req() req: AuthenticatedRequest,
    @Query('from') from?: string,
    @Query('until') until?: string,
    @Query('period') period?: string,
    @Query('branchId') branchId?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.finance.otherCosts(req.principal, { from, until, period, branchId, cursor });
  }

  @Post('finance-exports')
  exportReport(
    @Req() req: AuthenticatedRequest,
    @Body() body: { branchId?: string; from?: string; until?: string },
  ) {
    return this.finance.exportReport(req.principal, body);
  }

  // ============================================================================
  // LEGACY / RECONCILIATION ENDPOINTS
  // ============================================================================

  @Get('finance/reconciliation/anomalies')
  anomalies(
    @Req() req: AuthenticatedRequest,
    @Query('branchId') branchId?: string,
    @Query('from') from?: string,
    @Query('until') until?: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.finance.anomalies(req.principal, {
      branchId,
      from,
      until,
      limit: limit ? Number(limit) : undefined,
      cursor,
    });
  }

  @Get(['finance/reconciliation/legacy-cashflow', 'finance/legacy-cashflow'])
  legacyCashflow(
    @Req() req: AuthenticatedRequest,
    @Query('branchId') branchId?: string,
    @Query('from') from?: string,
    @Query('until') until?: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.finance.legacyCashflow(req.principal, {
      branchId,
      from,
      until,
      limit: limit ? Number(limit) : undefined,
      cursor,
    });
  }

  @Get('reports/:reportType')
  reports(
    @Req() req: AuthenticatedRequest,
    @Param('reportType') reportType: string,
    @Query('from') from?: string,
    @Query('until') until?: string,
    @Query('period') period?: string,
    @Query('branchId') branchId?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.finance.reports(req.principal, reportType, { from, until, period, branchId, cursor });
  }
}
