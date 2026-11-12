import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ApiProblem } from '../identity/security';

@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemDetailsFilter.name);

  catch(error: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();

    const request = http.getRequest<Request & { correlationId?: string }>();

    const response = http.getResponse<Response>();

    const isConcurrencyConflict = (error as any)?.code === 'P2034';
    // Klik ganda / permintaan bersamaan yang menabrak kunci unik atau baris yang sudah terhapus
    // adalah konflik dari sisi pengguna, bukan kesalahan server.
    const isDuplicate = (error as any)?.code === 'P2002';
    const isGone = (error as any)?.code === 'P2025';
    // Tabel/kolom baru belum dibuat di server (SQL di docs/DEPLOY.md belum dijalankan): sebutkan
    // dengan jelas, jangan 500 umum yang menyuruh pengguna mencoba lagi.
    const isSchemaMissing = ['P2021', 'P2022'].includes((error as any)?.code);

    const status = isSchemaMissing
      ? HttpStatus.SERVICE_UNAVAILABLE
      : isConcurrencyConflict || isDuplicate
      ? HttpStatus.CONFLICT
      : isGone
        ? HttpStatus.NOT_FOUND
        : error instanceof HttpException
        ? error.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const code = isSchemaMissing
      ? 'DATABASE_TABLE_MISSING'
      : isConcurrencyConflict
      ? 'CONCURRENCY_CONFLICT'
      : isDuplicate
        ? 'DUPLICATE_REQUEST'
        : isGone
          ? 'RESOURCE_NOT_FOUND'
          : error instanceof ApiProblem
        ? error.code
        : error instanceof HttpException
          ? `HTTP_${status}`
          : 'INTERNAL_ERROR';

    // Cetak detail error server ke terminal
    if (status >= 500) {
      const message = error instanceof Error ? error.message : String(error);

      const stack = error instanceof Error ? error.stack : undefined;

      this.logger.error(
        [
          `${request.method} ${request.originalUrl}`,
          `Status: ${status}`,
          `Code: ${code}`,
          `Correlation ID: ${request.correlationId ?? 'unknown'}`,
          `Message: ${message}`,
        ].join(' | '),
        stack,
      );
    }

    response
      .status(status)
      .type('application/problem+json')
      .send({
        error: {
          code,
          message: isConcurrencyConflict
            ? 'Terjadi konflik konkurensi pada transaksi. Silakan coba kembali.'
            : status >= 500
              ? 'Terjadi kesalahan internal.'
              : 'Permintaan tidak dapat diproses.',
          correlationId: request.correlationId ?? 'unknown',
          details: error instanceof ApiProblem ? error.details : [],
          retryable: isConcurrencyConflict || (error instanceof ApiProblem ? error.retryable : status >= 500),
        },
      });
  }
}
