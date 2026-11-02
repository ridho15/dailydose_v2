import 'reflect-metadata';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';

try {
  const envPath = resolve(process.cwd(), '../../.env');
  const directEnvPath = resolve(process.cwd(), '.env');
  if (typeof process.loadEnvFile === 'function') {
    if (existsSync(envPath)) process.loadEnvFile(envPath);
    else if (existsSync(directEnvPath)) process.loadEnvFile(directEnvPath);
  }
} catch {
  // Ignore when env is already provided by container/process
}

import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { CorrelationInterceptor } from './platform/correlation.interceptor';
import { SaringRahasiaInterceptor } from './platform/saring-rahasia.interceptor';
import { ProblemDetailsFilter } from './platform/problem-details.filter';
import type { NextFunction, Request, Response } from 'express';
import { json, raw, urlencoded } from 'express';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
    bodyParser: false,
  });
  app.use(
    '/api/v1/uploads/payment-proofs/:id/content',
    raw({ type: 'application/octet-stream', limit: '12mb' }),
  );
  app.use(json({ limit: '10mb' }));
  app.use(urlencoded({ extended: true, limit: '10mb' }));
  app.use((request: Request, response: Response, next: NextFunction) => {
    if (
      !['GET', 'HEAD', 'OPTIONS'].includes(request.method) &&
      process.env.NODE_ENV === 'production'
    ) {
      const configured = process.env.PUBLIC_WEB_BASE_URL?.trim();
      const expectedOrigin = configured ? new URL(configured).origin : null;
      const origin = request.header('origin');
      if (!expectedOrigin || origin !== expectedOrigin)
        return response.status(403).json({
          type: 'about:blank',
          title: 'Forbidden',
          status: 403,
          code: 'ORIGIN_REJECTED',
        });
    }
    next();
  });
  app.setGlobalPrefix('api/v1');
  app.useGlobalInterceptors(new CorrelationInterceptor(), new SaringRahasiaInterceptor());
  app.useGlobalFilters(new ProblemDetailsFilter());
  app.enableShutdownHooks();
  await app.listen(Number(process.env.PORT ?? 3001));
}
void bootstrap();
