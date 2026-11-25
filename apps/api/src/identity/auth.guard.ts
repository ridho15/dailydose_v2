import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { IdentityService, type SessionPrincipal } from './identity.service';
import { ApiProblem } from './security';
import { HttpStatus } from '@nestjs/common';
import { pastikanRutePetugas } from './rute-petugas-checkin';

export type AuthenticatedRequest = Request & {
  principal: SessionPrincipal;
  correlationId?: string;
};

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly identities: IdentityService) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    // AccessGuard global sudah mengautentikasi; hindari pencarian sesi kedua per permintaan.
    if (request.principal) return true;
    const authorization = request.header('authorization') ?? '';
    const bearer = /^Bearer ([A-Za-z0-9_-]+)$/.exec(authorization)?.[1];
    const cookie = /(?:^|;\s*)dd_session=([A-Za-z0-9_-]+)/.exec(
      request.header('cookie') ?? '',
    )?.[1];
    const token = bearer ?? cookie;
    if (!token) throw new ApiProblem('AUTHENTICATION_REQUIRED', HttpStatus.UNAUTHORIZED);
    request.principal = await this.identities.authenticateBearer(token);
    // Akun Petugas Check-in hanya boleh memakai rute layar check-in.
    pastikanRutePetugas(request.principal, request.method, request.path, request.query as Record<string, unknown>);
    if (request.principal.passwordChangeRequired) {
      const allowed = ['/me', '/auth/security', '/auth/password/change', '/auth/logout'].some(
        (path) => request.path === path || request.path.endsWith(path),
      );
      if (!allowed) throw new ApiProblem('PASSWORD_CHANGE_REQUIRED', HttpStatus.FORBIDDEN);
    }
    return true;
  }
}
