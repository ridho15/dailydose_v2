import { Controller, Get, HttpStatus, Logger, Post, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Public } from './route-access';
import { ApiProblem, safeEqual } from './security';
import { pasangCookieSesi } from './identity.controller';
import { HrGroupService, HrgLoginError, type HrgErrorCode } from './hr-group.service';
import {
  HRG_APP,
  HRG_COOKIE_PATH,
  HRG_FLOW_COOKIE,
  HRG_FLOW_TTL_SECONDS,
  hrGroupConfig,
  openFlow,
  readCookie,
  sealFlow,
  verifyHrgSignature,
} from './hr-group';

type HrgRequest = Request & { correlationId?: string };

const flowCookieOptions = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV !== 'development',
  sameSite: 'lax' as const,
  path: HRG_COOKIE_PATH,
});

/**
 * Masuk dengan Akun HR Group (OIDC) dan credential bridge untuk migrasi akun.
 * Semua rute publik: start/callback adalah awal sesi; verify-credentials hanya menjawab permintaan
 * bertanda tangan HMAC `HRG_BRIDGE_SECRET`. Seluruhnya 404 bila fitur mati (lihat `hrGroupConfig`).
 */
@Public()
@Controller()
export class HrGroupController {
  private readonly logger = new Logger(HrGroupController.name);

  constructor(private readonly hrGroup: HrGroupService) {}

  @Get('auth/hr-group/start')
  async start(@Query('returnTo') returnTo: string | undefined, @Res() response: Response) {
    const config = hrGroupConfig();
    if (!config) throw new ApiProblem('NOT_FOUND', HttpStatus.NOT_FOUND);
    try {
      const { url, flow } = await this.hrGroup.beginLogin(config, returnTo);
      response.cookie(HRG_FLOW_COOKIE, sealFlow(flow, config.clientSecret), {
        ...flowCookieOptions(),
        maxAge: HRG_FLOW_TTL_SECONDS * 1000,
      });
      response.set('Cache-Control', 'no-store');
      return response.redirect(302, url);
    } catch (error) {
      this.logger.error(`Gagal memulai login HR Group: ${(error as Error).message}`);
      return response.redirect(302, '/sign-in?hrg_error=server');
    }
  }

  @Get('auth/hr-group/callback')
  async callback(
    @Req() request: HrgRequest,
    @Res() response: Response,
    @Query('code') code?: string,
    @Query('state') state?: string,
    @Query('error') providerError?: string,
  ) {
    const config = hrGroupConfig();
    if (!config) throw new ApiProblem('NOT_FOUND', HttpStatus.NOT_FOUND);
    const correlationId = request.correlationId ?? 'unknown';
    const flow = openFlow(readCookie(request.header('cookie'), HRG_FLOW_COOKIE), config.clientSecret);
    response.clearCookie(HRG_FLOW_COOKIE, flowCookieOptions());
    response.set('Cache-Control', 'no-store');
    const fail = (codeName: HrgErrorCode) => response.redirect(302, `/sign-in?hrg_error=${codeName}`);

    if (providerError) return fail('cancelled');
    if (!flow || typeof state !== 'string' || !safeEqual(state, flow.state) || typeof code !== 'string' || !code)
      return fail('state');

    try {
      const claims = await this.hrGroup.exchange(config, code, flow);
      const { userId } = await this.hrGroup.resolveUser(claims, correlationId);
      const session = await this.hrGroup.issueSession(userId);
      pasangCookieSesi(response, session);
      if (claims.hrg_links?.[HRG_APP] !== userId) void this.hrGroup.notifyLink(config, claims.sub, userId);
      return response.redirect(302, flow.returnTo);
    } catch (error) {
      const codeName = error instanceof HrgLoginError ? error.code : 'server';
      this.logger.warn(`Login HR Group gagal (${codeName}, ${correlationId}): ${(error as Error).message}`);
      return fail(codeName);
    }
  }

  @Post('integrations/hr-group/verify-credentials')
  async verifyCredentials(@Req() request: HrgRequest, @Res() response: Response) {
    const config = hrGroupConfig();
    if (!config) return response.status(404).json({ error: 'not_found' });
    const invalid = () => response.status(401).json({ error: 'invalid_credentials' });

    // Badan mentah disiapkan main.ts (express.raw) untuk jalur ini; tanpa itu tanda tangan tidak bisa diperiksa.
    const raw = request.body;
    if (!Buffer.isBuffer(raw)) {
      this.logger.error('verify-credentials menerima body yang sudah diurai; periksa middleware raw di main.ts.');
      return invalid();
    }
    const check = verifyHrgSignature(
      config.bridgeSecret,
      request.header('x-hrg-timestamp'),
      request.header('x-hrg-signature'),
      raw,
    );
    if (check !== 'ok') {
      this.logger.warn(`verify-credentials ditolak: ${check}.`);
      return invalid();
    }

    let body: { identifier?: unknown; password?: unknown };
    try {
      body = JSON.parse(raw.toString('utf8'));
    } catch {
      return response.status(400).json({ error: 'invalid_request' });
    }
    if (
      typeof body?.identifier !== 'string' ||
      typeof body.password !== 'string' ||
      !body.identifier.trim() ||
      body.identifier.length > 191 ||
      !body.password ||
      body.password.length > 256
    )
      return response.status(400).json({ error: 'invalid_request' });

    try {
      const result = await this.hrGroup.verifyCredentials(body.identifier, body.password);
      if (!result) return invalid();
      return response.status(200).json(result);
    } catch (error) {
      if (error instanceof ApiProblem && error.code === 'RATE_LIMITED')
        return response.status(429).json({ error: 'rate_limited' });
      throw error;
    }
  }
}
