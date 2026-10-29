import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  StreamableFile,
  UploadedFile,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor, FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import type { ApplicationRole } from './role-capabilities';
import type { AssignmentType } from './assignment.service';

export type SessionChannel = 'WEB' | 'MOBILE' | string;
export type IdentityDocumentKind = 'SELFIE' | 'KTP_FRONT';
import { Public, SelfService } from './route-access';
import { AuthGuard, type AuthenticatedRequest } from './auth.guard';
import { IdentityService } from './identity.service';
import { ApiProblem } from './security';
import { HttpStatus } from '@nestjs/common';
import { CustomerProfileService } from './customer-profile.service';
import { IdentityReviewQueryService } from './identity-review-query.service';
import { IdentityDocumentAccessService } from './identity-document-access.service';
import { AssignmentService } from './assignment.service';
import { IdentityDocumentWorkflowService } from './identity-document-workflow.service';
import { UserAdministrationService } from './user-administration.service';

interface MemoryUpload {
  originalname: string;
  mimetype: string;
  buffer: Buffer;
}

const multipartLimits = { fileSize: 8_000_000, files: 2 };

@Controller()
export class IdentityController {
  constructor(
    private readonly identities: IdentityService,
    private readonly customerProfiles: CustomerProfileService,
    private readonly identityReviews: IdentityReviewQueryService,
    private readonly identityDocuments: IdentityDocumentAccessService,
    private readonly assignments: AssignmentService,
    private readonly identityDocumentWorkflow: IdentityDocumentWorkflowService,
    private readonly users: UserAdministrationService,
  ) {}

  private deliverSession(
    response: Response,
    session: Awaited<ReturnType<IdentityService['issueSession']>>,
  ) {
    if (session.webCookieToken)
      response.cookie('dd_session', session.webCookieToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV !== 'development',
        sameSite: 'lax',
        path: '/',
      });
    if (session.webRefreshToken)
      response.cookie('dd_refresh', session.webRefreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV !== 'development',
        sameSite: 'lax',
        path: '/api/v1/auth',
      });
    const { webCookieToken: _private, webRefreshToken: _privateRefresh, ...body } = session;
    return body;
  }

  @Public()
  @Post('auth/google')
  async authenticateGoogle(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
    @Body() body: { idToken: string; nonce: string; channel: SessionChannel },
  ) {
    return this.deliverSession(
      response,
      await this.identities.authenticateGoogle(body, request.correlationId ?? 'unknown'),
    );
  }

  @Public()
  @Post('auth/password/sessions')
  @HttpCode(200)
  async authenticatePassword(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
    @Body() body: { email: string; password: string; channel: SessionChannel },
  ) {
    return this.deliverSession(
      response,
      await this.identities.authenticatePassword(
        body,
        request.correlationId ?? 'unknown',
        `${request.ip}:${request.header('user-agent') ?? ''}`,
      ),
    );
  }

  @Public()
  @Post('auth/customer-registrations')
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'selfie', maxCount: 1 },
        { name: 'ktp', maxCount: 1 },
      ],
      { limits: multipartLimits },
    ),
  )
  async registerCustomer(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
    @Body()
    body: {
      displayName: string;
      phone: string;
      email: string;
      password: string;
      consent: string | boolean;
    },
    @UploadedFiles() files: { selfie?: MemoryUpload[]; ktp?: MemoryUpload[] },
  ) {
    const selfie = files?.selfie?.[0];
    const ktp = files?.ktp?.[0];
    return this.deliverSession(
      response,
      await this.identities.registerCustomer(
        {
          ...body,
          consent: body.consent === true || body.consent === 'true',
          selfie: selfie
            ? {
                originalName: selfie.originalname,
                claimedMimeType: selfie.mimetype,
                buffer: selfie.buffer,
              }
            : undefined,
          ktp: ktp
            ? {
                originalName: ktp.originalname,
                claimedMimeType: ktp.mimetype,
                buffer: ktp.buffer,
              }
            : undefined,
        },
        request.correlationId ?? 'unknown',
        `${request.ip}:${request.header('user-agent') ?? ''}`,
      ),
    );
  }

  @SelfService()
  @UseGuards(AuthGuard)
  @Get('identity-verification/me')
  myVerification(@Req() request: AuthenticatedRequest) {
    return this.identities.myVerification(request.principal);
  }

  @SelfService()
  @UseGuards(AuthGuard)
  @Get('me/profile')
  myProfile(@Req() request: AuthenticatedRequest) {
    return this.customerProfiles.get(request.principal);
  }

  /** Nomor WhatsApp untuk akun yang belum punya (mis. daftar lewat Google). */
  @SelfService()
  @UseGuards(AuthGuard)
  @Post('me/phone')
  @HttpCode(200)
  setMyPhone(@Req() request: AuthenticatedRequest, @Body() body: { phone?: string }) {
    return this.customerProfiles.setPhone(
      request.principal,
      body ?? {},
      request.correlationId ?? 'unknown',
    );
  }

  @SelfService()
  @UseGuards(AuthGuard)
  @Patch('me/profile')
  updateMyProfile(
    @Req() request: AuthenticatedRequest,
    @Body()
    body: { displayName: string; preferredBranchId?: string | null; expectedVersion: number },
  ) {
    return this.customerProfiles.update(
      request.principal,
      body,
      request.correlationId ?? 'unknown',
    );
  }

  @UseGuards(AuthGuard)
  @Post('identity-verification/me/documents/:kind/view-authorizations')
  authorizeMyIdentityDocument(
    @Req() request: AuthenticatedRequest,
    @Param('kind') kind: IdentityDocumentKind,
  ) {
    return this.identityDocuments.authorizeSelf(
      request.principal,
      kind,
      request.correlationId ?? 'unknown',
    );
  }

  @SelfService()
  @UseGuards(AuthGuard)
  @Post('identity-verification/me/documents/:kind/replacements')
  @UseInterceptors(FileInterceptor('replacement', { limits: { fileSize: 8_000_000, files: 1 } }))
  replaceIdentityDocument(
    @Req() request: AuthenticatedRequest,
    @Param('kind') kind: IdentityDocumentKind,
    @Body() body: { expectedVersion: string | number },
    @UploadedFile() replacement?: MemoryUpload,
  ) {
    const expectedVersion = Number(body.expectedVersion);
    if (!replacement || !Number.isInteger(expectedVersion))
      throw new ApiProblem('VALIDATION_ERROR', HttpStatus.UNPROCESSABLE_ENTITY);
    return this.identityDocumentWorkflow.replaceIdentityDocument(
      request.principal,
      kind,
      {
        originalName: replacement.originalname,
        claimedMimeType: replacement.mimetype,
        buffer: replacement.buffer,
      },
      expectedVersion,
      request.correlationId ?? 'unknown',
    );
  }

  @SelfService()
  @UseGuards(AuthGuard)
  @Post('identity-verification/me/submission')
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'selfie', maxCount: 1 },
        { name: 'ktp', maxCount: 1 },
      ],
      { limits: multipartLimits },
    ),
  )
  async submitMyIdentityVerification(
    @Req() request: AuthenticatedRequest,
    @Body() body: { nik?: string; address?: string },
    @UploadedFiles() files: { selfie?: MemoryUpload[]; ktp?: MemoryUpload[] },
  ) {
    const selfie = files?.selfie?.[0];
    const ktp = files?.ktp?.[0];
    return this.identityDocumentWorkflow.submitKyc(
      request.principal,
      {
        nik: body?.nik,
        address: body?.address,
        selfie: selfie
          ? {
              originalName: selfie.originalname,
              claimedMimeType: selfie.mimetype,
              buffer: selfie.buffer,
            }
          : undefined,
        ktp: ktp
          ? {
              originalName: ktp.originalname,
              claimedMimeType: ktp.mimetype,
              buffer: ktp.buffer,
            }
          : undefined,
      },
      request.correlationId ?? 'unknown',
    );
  }

  @UseGuards(AuthGuard)
  @Get('identity-verifications')
  listIdentityReview(
    @Req() request: AuthenticatedRequest,
    @Query('q') q?: string,
    @Query('status') status?: string,
    @Query('kind') kind?: string,
    @Query('scanStatus') scanStatus?: string,
    @Query('from') from?: string,
    @Query('until') until?: string,
    @Query('cursor') cursor?: string,
    @Query('page') rawPage?: string,
    @Query('limit') rawLimit?: string,
    @Query('customerUserId') customerUserId?: string,
  ) {
    const limit = rawLimit == null ? undefined : Number(rawLimit);
    const page = rawPage == null ? undefined : Number(rawPage);
    return this.identityReviews.list(request.principal, {
      q,
      status,
      kind,
      scanStatus,
      from,
      until,
      cursor,
      page,
      limit,
      customerUserId,
    });
  }

  @UseGuards(AuthGuard)
  @Post('identity-verifications/:id/view-authorizations')
  authorizeIdentityDocument(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    return this.identityDocuments.authorizeReview(
      request.principal,
      id,
      request.correlationId ?? 'unknown',
    );
  }

  @SelfService()
  @UseGuards(AuthGuard)
  @Get('identity-verification-files/:authorizationId/content')
  async readIdentityDocument(
    @Req() request: AuthenticatedRequest,
    @Param('authorizationId') authorizationId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const file = await this.identityDocuments.read(
      request.principal,
      authorizationId,
      request.correlationId ?? 'unknown',
    );
    const extension =
      file.mimeType === 'image/png' ? 'png' : file.mimeType === 'image/webp' ? 'webp' : 'jpg';
    response.set({
      'Cache-Control': 'private, no-store, max-age=0',
      'Content-Disposition': `inline; filename="identity-document.${extension}"`,
      'Content-Type': file.mimeType,
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
    });
    return new StreamableFile(file.stream);
  }

  @UseGuards(AuthGuard)
  @Post('identity-verifications/:id/decisions/:decision')
  decideIdentityDocument(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Param('decision') decision: 'approve' | 'reject',
    @Body() body: { expectedVersion: number; reasonCode?: string; note?: string },
  ) {
    if (!['approve', 'reject'].includes(decision))
      throw new ApiProblem('VALIDATION_ERROR', HttpStatus.UNPROCESSABLE_ENTITY);
    return this.identityDocumentWorkflow.decideIdentityDocument(
      request.principal,
      id,
      decision === 'approve' ? 'APPROVED' : 'REJECTED',
      body,
      request.correlationId ?? 'unknown',
    );
  }

  @UseGuards(AuthGuard)
  @Post('identity-verifications/:id/delete')
  deleteIdentityDocument(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: { expectedVersion: number; reason: string },
  ) {
    return this.identityDocumentWorkflow.deleteIdentityDocument(
      request.principal,
      id,
      body,
      request.correlationId ?? 'unknown',
    );
  }

  @Public()
  @Post('auth/password/activations')
  @HttpCode(200)
  async activatePassword(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
    @Body() body: { token: string; password: string },
  ) {
    return this.deliverSession(
      response,
      await this.identities.activatePassword(
        body.token,
        body.password,
        request.correlationId ?? 'unknown',
      ),
    );
  }

  @Public()
  @Post('auth/password/reset-requests')
  @HttpCode(202)
  requestPasswordReset(@Req() request: AuthenticatedRequest, @Body() body: { email: string }) {
    return this.identities.requestPasswordReset(
      body.email,
      request.correlationId ?? 'unknown',
      `${request.ip}:${request.header('user-agent') ?? ''}`,
    );
  }

  @Public()
  @Post('auth/password/resets')
  @HttpCode(200)
  resetPassword(
    @Req() request: AuthenticatedRequest,
    @Body() body: { token: string; password: string },
  ) {
    return this.identities.resetPassword(
      body.token,
      body.password,
      request.correlationId ?? 'unknown',
    );
  }

  @Public()
  @Post('auth/refresh')
  async refresh(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    const authorization = request.header('authorization') ?? '';
    const match = /^Bearer ([A-Za-z0-9_-]+)$/.exec(authorization);
    const cookie = /(?:^|;\s*)dd_refresh=([A-Za-z0-9_-]+)/.exec(
      request.header('cookie') ?? '',
    )?.[1];
    const refreshToken = match?.[1] ?? cookie;
    if (!refreshToken) throw new ApiProblem('AUTHENTICATION_REQUIRED', HttpStatus.UNAUTHORIZED);
    return this.deliverSession(
      response,
      await this.identities.refresh(refreshToken, request.correlationId ?? 'unknown'),
    );
  }

  @UseGuards(AuthGuard)
  @Get('me')
  me(@Req() request: AuthenticatedRequest) {
    return this.identities.meForSession(request.principal);
  }

  @SelfService()
  @UseGuards(AuthGuard)
  @Post('auth/logout')
  @HttpCode(204)
  async logout(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.identities.logout(request.principal.sessionId, request.correlationId ?? 'unknown');
    response.clearCookie('dd_session', { path: '/' });
    response.clearCookie('dd_refresh', { path: '/api/v1/auth' });
  }

  @SelfService()
  @UseGuards(AuthGuard)
  @Post('auth/sessions/revoke-all')
  @HttpCode(204)
  async revokeAll(
    @Req() request: AuthenticatedRequest,
    @Body() body: { reason: string; exceptCurrent?: boolean },
  ): Promise<void> {
    await this.identities.revokeAll(
      request.principal.userId,
      body.reason,
      body.exceptCurrent ? request.principal.sessionId : undefined,
      request.correlationId ?? 'unknown',
    );
  }

  @SelfService()
  @UseGuards(AuthGuard)
  @Get('auth/security')
  securityStatus(@Req() request: AuthenticatedRequest) {
    return this.identities.passwordSecurityStatus(request.principal);
  }

  @SelfService()
  @UseGuards(AuthGuard)
  @Post('auth/password/change')
  @HttpCode(200)
  changePassword(
    @Req() request: AuthenticatedRequest,
    @Body() body: { currentPassword: string; newPassword: string },
  ) {
    return this.identities.changePassword(
      request.principal,
      body.currentPassword,
      body.newPassword,
      request.correlationId ?? 'unknown',
    );
  }

  @UseGuards(AuthGuard)
  @Get('users')
  listUsers(
    @Req() request: AuthenticatedRequest,
    @Query('branchId') branchId?: string,
    @Query('cursor') cursor?: string,
    @Query('search') search?: string,
    @Query('status') status?: 'PENDING_ACTIVATION' | 'ACTIVE' | 'INACTIVE',
    @Query('role') role?: ApplicationRole,
    @Query('audience') audience?: 'STAFF' | 'CUSTOMER',
    @Query('verificationStatus') verificationStatus?: 'PENDING' | 'ACTION_REQUIRED' | 'APPROVED',
    @Query('includeHistorical') includeHistorical?: string,
  ) {
    return this.users.listUsers(request.principal, {
      branchId,
      cursor,
      search,
      status,
      role,
      audience,
      verificationStatus,
      includeHistorical: includeHistorical === 'true',
    });
  }

  @UseGuards(AuthGuard)
  @Get('lookups/users')
  lookupUsers(
    @Req() request: AuthenticatedRequest,
    @Query('q') q?: string,
    @Query('branchId') branchId?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.users.lookupUsers(request.principal, {
      q,
      branchId,
      cursor,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @UseGuards(AuthGuard)
  @Get('lookups/customers')
  lookupCustomers(
    @Req() request: AuthenticatedRequest,
    @Query('q') q?: string,
    @Query('branchId') branchId?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.users.lookupCustomers(request.principal, {
      q,
      branchId,
      cursor,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @UseGuards(AuthGuard)
  @Get('lookups/instructors')
  lookupInstructors(
    @Req() request: AuthenticatedRequest,
    @Query('q') q?: string,
    @Query('branchId') branchId?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.users.lookupUsers(request.principal, {
      q,
      branchId,
      cursor,
      limit: limit ? Number(limit) : undefined,
      instructorsOnly: true,
    });
  }

  @UseGuards(AuthGuard)
  @Get('users/role-catalog')
  roleCatalog(@Req() request: AuthenticatedRequest) {
    return this.identities.roleCatalog(request.principal);
  }

  @UseGuards(AuthGuard)
  @Get('users/:id')
  getUser(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    return this.users.getUser(request.principal, id);
  }

  @UseGuards(AuthGuard)
  @Get('users/:id/identity-verification')
  async getUserIdentityVerification(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    await this.users.getUser(request.principal, id);
    return this.identityReviews.getByUser(request.principal, id);
  }

  @UseGuards(AuthGuard)
  @Patch('users/:id/profile')
  updateUserProfile(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Body()
    body: {
      displayName: string;
      username?: string | null;
      phoneE164?: string | null;
      expectedVersion: number;
      reason: string;
    },
  ) {
    return this.users.updateUserProfile(
      request.principal,
      id,
      body,
      request.correlationId ?? 'unknown',
    );
  }

  @UseGuards(AuthGuard)
  @Post('users')
  inviteUser(
    @Req() request: AuthenticatedRequest,
    @Body()
    body: {
      email: string;
      displayName?: string;
      phone?: string;
      phoneE164?: string;
      password?: string;
      roles?: ApplicationRole[];
      branchIds?: string[];
      roleAssignments?: {
        role: ApplicationRole;
        branchId?: string | null;
      }[];
    },
  ) {
    return this.users.inviteUser(request.principal, body, request.correlationId ?? 'unknown');
  }

  @UseGuards(AuthGuard)
  @Post('users/:id/direct-password-reset')
  @HttpCode(HttpStatus.OK)
  resetPasswordDirect(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: { newPassword: string },
  ) {
    return this.users.resetPasswordDirect(
      request.principal,
      id,
      body.newPassword,
      request.correlationId ?? 'unknown',
    );
  }

  @UseGuards(AuthGuard)
  @Post('users/:id/password-setup-requests')
  @HttpCode(202)
  requestPasswordSetup(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: { email: string; reason?: string },
  ) {
    return this.identities.requestPasswordSetup(
      request.principal,
      id,
      { email: body.email, reason: body.reason ?? 'Setup kata sandi' },
      request.correlationId ?? 'unknown',
    );
  }

  @UseGuards(AuthGuard)
  @Post('users/:id/roles')
  updateUserRoles(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Headers('idempotency-key') idempotencyKey: string,
    @Body()
    body: {
      roles: { role: ApplicationRole; branchId?: string | null }[];
      expectedVersion?: number;
      reason?: string;
    },
  ) {
    return this.users.updateUserRoles(
      request.principal,
      id,
      body,
      request.correlationId ?? 'unknown',
      idempotencyKey,
    );
  }

  @UseGuards(AuthGuard)
  @Post('users/:id/deactivate')
  deactivate(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body?: { reason?: string; expectedVersion?: number },
  ) {
    return this.users.deactivate(
      request.principal,
      id,
      body?.reason,
      body?.expectedVersion,
      request.correlationId ?? 'unknown',
    );
  }

  @UseGuards(AuthGuard)
  @Post('users/:id/reactivate')
  reactivate(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body?: { reason?: string; expectedVersion?: number },
  ) {
    return this.users.reactivate(
      request.principal,
      id,
      body?.reason,
      body?.expectedVersion,
      request.correlationId ?? 'unknown',
    );
  }

  @UseGuards(AuthGuard)
  @Get('users/:id/audit')
  userAudit(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Query('cursor') cursor?: string,
    @Query('includeHistorical') includeHistorical?: string,
  ) {
    return this.users.listUserAudit(request.principal, id, cursor, includeHistorical === 'true');
  }

  @UseGuards(AuthGuard)
  @Get('audit-logs')
  auditLogs(
    @Req() request: AuthenticatedRequest,
    @Query('actorId') actorId?: string,
    @Query('targetUserId') targetUserId?: string,
    @Query('action') action?: string,
    @Query('branchId') branchId?: string,
    @Query('correlationId') correlationId?: string,
    @Query('objectType') objectType?: string,
    @Query('objectId') objectId?: string,
    @Query('from') from?: string,
    @Query('until') until?: string,
    @Query('cursor') cursor?: string,
    @Query('includeHistorical') includeHistorical?: string,
  ) {
    return this.users.listAuditLogs(request.principal, {
      actorId,
      targetUserId,
      action,
      branchId,
      correlationId,
      objectType,
      objectId,
      from,
      until,
      cursor,
      includeHistorical: includeHistorical === 'true',
    });
  }

  @UseGuards(AuthGuard)
  @Get('assignments')
  listAssignments(
    @Req() request: AuthenticatedRequest,
    @Query('branchId') branchId?: string,
    @Query('q') q?: string,
    @Query('type') type?: AssignmentType,
    @Query('status') status?: 'ACTIVE' | 'ENDED',
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.assignments.list(request.principal, {
      branchId,
      q,
      type,
      status,
      cursor,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @UseGuards(AuthGuard)
  @Post('assignments')
  createAssignment(
    @Req() request: AuthenticatedRequest,
    @Body()
    body: {
      userId: string;
      branchId: string;
      assignmentType: AssignmentType;
      activeFrom: string;
      activeUntil?: string | null;
      reason: string;
    },
  ) {
    return this.assignments.create(request.principal, body, request.correlationId ?? 'unknown');
  }

  @UseGuards(AuthGuard)
  @Post('assignments/:id/end')
  endAssignment(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Headers('idempotency-key') _idempotencyKey: string,
    @Body() body: { effectiveAt: string; reason: string; expectedVersion: number },
  ) {
    return this.assignments.end(request.principal, id, body, request.correlationId ?? 'unknown');
  }
}
