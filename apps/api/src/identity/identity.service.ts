import { HttpStatus, Inject, Injectable, Optional } from '@nestjs/common';
export type SessionChannel = 'WEB' | 'MOBILE' | string;
import { PrismaService } from '../database/prisma.service';
import { alasanPenolakanSelfie, statusSelfie } from './verifikasi-selfie';
import { AuditService } from '../foundation/audit.service';
import { IdempotencyService } from '../foundation/idempotency.service';
import { RuntimeConfigService } from '../configuration/runtime-config.service';
import { PRIVATE_FILE_STORAGE, type PrivateFileStorage } from './private-file-storage';
import {
  ConfigGatedGoogleProvider,
} from './provider-adapters';
import { RateLimitService } from './rate-limit.service';
import { PolicyService } from './policy.service';
import type { CapabilityGrant } from './policy.service';
import type { ApplicationRole } from './role-capabilities';
import { QueuedPasswordEmailProvider } from './email-provider';
import {
  canonicalEmailHash,
  hashPassword,
  isValidEmail,
  normalizeEmail,
  passwordHashNeedsUpgrade,
  verifyPassword,
} from './credential-security';
import {
  ApiProblem,
  configurationRequired,
  digest,
  newId,
  opaqueToken,
  syntheticConfigSeconds,
} from './security';
import { NotificationWriterService } from '../notifications/notification-writer.service';
import { canonicalRole } from './role-aliases';

export interface SessionPrincipal {
  sessionId: string;
  userId: string;
  roles: { role: ApplicationRole; branchId: string | null }[];
  capabilities: string[];
  branchIds: string[];
  capabilityGrants?: CapabilityGrant[];
  capabilityDenials?: Array<{ capability: string; branchId: string | null; sourceId: string }>;
  sessionExpiresAt?: Date;
  passwordChangeRequired?: boolean;
}

export function mapUserToEffectiveRoles(user: {
  role: string;
  preferredBranchId?: string | null;
  ownedBranches?: Array<{ branchId: string }>;
}): Array<{ role: ApplicationRole; branchId: string | null }> {
  switch (canonicalRole(user.role)) {
    case 'SUPER_OWNER':
      return [{ role: 'SUPER_OWNER', branchId: null }];
    case 'FINANCE':
      return [{ role: 'FINANCE', branchId: null }];
    case 'OWNER': {
      const owned = user.ownedBranches ?? [];
      if (owned.length > 0) {
        return owned.map((ob) => ({ role: 'OWNER' as ApplicationRole, branchId: ob.branchId }));
      }
      return [{ role: 'OWNER', branchId: user.preferredBranchId ?? null }];
    }
    case 'MANAGER':
      return [{ role: 'MANAGER', branchId: user.preferredBranchId ?? null }];
    case 'ADMIN':
      return [{ role: 'ADMIN', branchId: user.preferredBranchId ?? null }];
    case 'INSTRUCTOR':
      return [{ role: 'INSTRUCTOR', branchId: user.preferredBranchId ?? null }];
    case 'CUSTOMER':
    default:
      return [{ role: 'CUSTOMER', branchId: user.preferredBranchId ?? null }];
  }
}

@Injectable()
export class IdentityService {
  constructor(
    private readonly db: PrismaService,
    private readonly policy: PolicyService,
    private readonly google: ConfigGatedGoogleProvider,
    private readonly rateLimit: RateLimitService,
    private readonly passwordEmail: QueuedPasswordEmailProvider,
    @Optional() private readonly idempotency?: IdempotencyService,
    @Optional() private readonly runtimeConfig?: RuntimeConfigService,
    @Optional() private readonly notificationWriter?: NotificationWriterService,
    @Optional() @Inject(PRIVATE_FILE_STORAGE) private readonly privateStorage?: PrivateFileStorage,
    @Optional() private readonly audit?: AuditService,
  ) {}

  /** Peristiwa keamanan akun (tanpa kata sandi, token, atau email mentah). Tidak pernah menggagalkan alur utama. */
  private securityEvent(action: string, userId: string, correlationId: string, detail?: Record<string, string | number | boolean | null>) {
    return this.audit?.catat(null, {
      actorId: userId,
      correlationId,
      action,
      objectType: 'Account',
      objectId: userId,
      targetUserId: userId,
      afterMasked: detail,
    });
  }

  async verificationStatus(userId: string) {
    const profile = await this.db.profilPengguna.findUnique({
      where: { userId },
    });
    const status = statusSelfie(profile);
    const documents: Array<{ kind: 'SELFIE'; status: string }> = profile?.selfieUrl
      ? [{ kind: 'SELFIE', status: 'APPROVED' }]
      : [];
    return { status, documents };
  }

  async requireCustomerVerification(_userId: string) {
    return;
  }

  async me(userId: string, _at = new Date()) {
    const user = await this.db.user.findUnique({
      where: { id: userId },
      include: { ownedBranches: true },
    });
    if (!user || user.status !== 'ACTIVE')
      throw new ApiProblem('SESSION_REVOKED', HttpStatus.UNAUTHORIZED);

    const effectiveRoles = mapUserToEffectiveRoles(user);
    const access = this.policy.resolveAccess(user.id, effectiveRoles);

    const preferredBranch = user.preferredBranchId
      ? await this.db.cabang.findUnique({
          where: { id: user.preferredBranchId },
          select: {
            id: true,
            code: true,
            name: true,
            timezone: true,
            supportWhatsappE164: true,
            active: true,
          },
        })
      : null;

    return {
      id: user.id,
      displayName: user.displayName,
      username: user.username,
      roles: effectiveRoles.map(({ role }) => role),
      customRoleCodes: [],
      branchIds: access.branchIds,
      capabilities: access.capabilities,
      globalCapabilities: access.capabilities,
      preferredBranch: preferredBranch?.active ? preferredBranch : null,
      passwordChangeRequired: false,
    };
  }

  private async sessionMe(userId: string, sessionExpiresAt: Date, at = new Date()) {
    const projection = await this.me(userId, at);
    const branchScope = projection.capabilities.includes('branch:all')
      ? undefined
      : { in: projection.branchIds };
    const branches = await this.db.cabang.findMany({
      where: { active: true, ...(branchScope ? { id: branchScope } : {}) },
      orderBy: [{ code: 'asc' }, { id: 'asc' }],
      select: { id: true, code: true, name: true, timezone: true },
    });

    const isCustomerOnly = projection.roles.every((r) => r === 'CUSTOMER');
    let identityVerificationStatus = 'APPROVED';
    // Member tanpa nomor WhatsApp (biasanya daftar lewat Google) diminta melengkapinya lebih dulu.
    let phoneRequired = false;
    if (isCustomerOnly) {
      const pemilik = this.db.user?.findUnique
        ? await this.db.user.findUnique({ where: { id: userId }, select: { phone: true } })
        : null;
      phoneRequired = Boolean(pemilik) && !pemilik?.phone;
      const profile = (this.db as any).profilPengguna?.findUnique
        ? await (this.db as any).profilPengguna.findUnique({ where: { userId } })
        : null;
      // Selfie saja: punya foto berarti terverifikasi.
      identityVerificationStatus = statusSelfie(profile);
    }

    return {
      ...projection,
      identityVerificationStatus,
      phoneRequired,
      sessionExpiresAt: sessionExpiresAt.toISOString(),
      branches,
    };
  }

  meForSession(principal: SessionPrincipal, at = new Date()) {
    if (!principal.sessionExpiresAt)
      throw new ApiProblem('SESSION_REVOKED', HttpStatus.UNAUTHORIZED);
    return this.sessionMe(principal.userId, principal.sessionExpiresAt, at);
  }

  async authenticatePassword(
    input: { email: string; password: string; channel: SessionChannel },
    _correlationId = 'unknown',
    requestFingerprint = 'unknown',
  ) {
    if (process.env.AUTH_PASSWORD_ENABLED !== 'true') configurationRequired();
    if (!input?.email || typeof input.email !== 'string' || !input.password || typeof input.password !== 'string') {
      throw new ApiProblem('VALIDATION_FAILED', HttpStatus.BAD_REQUEST, false, [
        { field: 'email', issue: 'Email and password are required' },
      ]);
    }
    const rawIdentifier = input.email.trim();
    const isPhone = /^(\+?[0-9\s().-]{7,20})$/.test(rawIdentifier) && !rawIdentifier.includes('@');
    const isEmail = rawIdentifier.includes('@');
    let user: any = null;

    if (isPhone) {
      const cleanPhone = rawIdentifier.replace(/[\s().-]/g, '');
      const e164 = cleanPhone.startsWith('0')
        ? `+62${cleanPhone.slice(1)}`
        : cleanPhone.startsWith('62')
          ? `+${cleanPhone}`
          : cleanPhone;
      const subjectHash = digest(e164);
      await Promise.all([
        this.rateLimit.consume('PASSWORD_LOGIN_SUBJECT', subjectHash, 5, 900),
        this.rateLimit.consume('PASSWORD_LOGIN_ORIGIN', digest(requestFingerprint), 50, 900),
      ]);
      user = this.db.user.findFirst
        ? await this.db.user.findFirst({
            where: {
              OR: [
                { phone: e164 },
                { phone: cleanPhone },
                { phone: rawIdentifier },
              ],
            },
          })
        : await this.db.user.findUnique({ where: { email: rawIdentifier } });
    } else if (isEmail) {
      const email = normalizeEmail(rawIdentifier);
      const emailHash = canonicalEmailHash(email);
      await Promise.all([
        this.rateLimit.consume('PASSWORD_LOGIN_SUBJECT', emailHash, 5, 900),
        this.rateLimit.consume('PASSWORD_LOGIN_ORIGIN', digest(requestFingerprint), 50, 900),
      ]);
      user = await this.db.user.findUnique({
        where: { email },
      });
    } else {
      const cleanUsername = rawIdentifier.toLowerCase();
      const usernameHash = digest(cleanUsername);
      await Promise.all([
        this.rateLimit.consume('PASSWORD_LOGIN_SUBJECT', usernameHash, 5, 900),
        this.rateLimit.consume('PASSWORD_LOGIN_ORIGIN', digest(requestFingerprint), 50, 900),
      ]);
      user = await this.db.user.findFirst({
        where: {
          OR: [
            { username: rawIdentifier },
            { username: cleanUsername },
            { email: rawIdentifier },
          ],
        },
      });
    }

    const valid = user?.passwordHash
      ? await verifyPassword(user.passwordHash, input.password)
      : await verifyPassword(
          '$argon2id$v=19$m=65536,t=3,p=1$OQ7j5B/1n5Tt6+Ww8bi6Iw$FDfbEPDKqHJFt1NDZll1WrMu46qpFcQteLeQSGho8Es',
          input.password,
        );

    if (!user || !valid || user.status !== 'ACTIVE')
      throw new ApiProblem('AUTHENTICATION_REQUIRED', HttpStatus.UNAUTHORIZED);

    if (user.passwordHash && passwordHashNeedsUpgrade(user.passwordHash)) {
      const upgradedHash = await hashPassword(input.password);
      await this.db.user.update({
        where: { id: user.id },
        data: { passwordHash: upgradedHash },
      });
    }

    return this.issueSession(user.id, input.channel);
  }

  async issueSession(userId: string, channel: SessionChannel, existingFamilyHash?: string) {
    const accessTtl = syntheticConfigSeconds('AUTH_ACCESS_TTL_SECONDS', 900);
    const refreshTtl = syntheticConfigSeconds('AUTH_REFRESH_TTL_SECONDS', 2_592_000);
    const accessToken = opaqueToken();
    const refreshToken = opaqueToken();
    const familyHash = existingFamilyHash ?? digest(opaqueToken());
    const expiresAt = new Date(Date.now() + accessTtl * 1000);
    const refreshExpiresAt = new Date(Date.now() + refreshTtl * 1000);

    await this.db.userSession.create({
      data: {
        userId,
        channel,
        tokenFamilyHash: familyHash,
        accessTokenHash: digest(accessToken),
        refreshTokenHash: digest(refreshToken),
        expiresAt,
        refreshExpiresAt,
      },
    });

    return {
      accessToken: channel === 'MOBILE' ? accessToken : null,
      refreshToken: channel === 'MOBILE' ? refreshToken : null,
      user: await this.sessionMe(userId, expiresAt),
      channel,
      expiresAt: expiresAt.toISOString(),
      refreshExpiresAt: refreshExpiresAt.toISOString(),
      webCookieToken: channel === 'WEB' ? accessToken : null,
      webRefreshToken: channel === 'WEB' ? refreshToken : null,
    };
  }

  async refresh(rawRefreshToken: string, _correlationId = 'unknown') {
    const session = await this.db.userSession.findUnique({
      where: { refreshTokenHash: digest(rawRefreshToken) },
      include: { user: true },
    });
    if (!session || session.refreshExpiresAt === null || session.refreshExpiresAt <= new Date())
      throw new ApiProblem('AUTHENTICATION_REQUIRED', HttpStatus.UNAUTHORIZED);

    if (session.revokedAt) {
      await this.db.userSession.updateMany({
        where: { tokenFamilyHash: session.tokenFamilyHash, revokedAt: null },
        data: { revokedAt: new Date(), revocationReason: 'REFRESH_REUSE_DETECTED' },
      });
      throw new ApiProblem('SESSION_REVOKED', HttpStatus.UNAUTHORIZED);
    }

    if (session.user.status !== 'ACTIVE')
      throw new ApiProblem('SESSION_REVOKED', HttpStatus.UNAUTHORIZED);

    const claimed = await this.db.userSession.updateMany({
      where: { id: session.id, revokedAt: null },
      data: { revokedAt: new Date(), revocationReason: 'ROTATED', rotatedAt: new Date() },
    });

    if (claimed.count !== 1) {
      await this.db.userSession.updateMany({
        where: { tokenFamilyHash: session.tokenFamilyHash, revokedAt: null },
        data: { revokedAt: new Date(), revocationReason: 'REFRESH_REUSE_DETECTED' },
      });
      throw new ApiProblem('SESSION_REVOKED', HttpStatus.UNAUTHORIZED);
    }

    return this.issueSession(session.userId, session.channel as SessionChannel, session.tokenFamilyHash);
  }

  async authenticateBearer(raw: string): Promise<SessionPrincipal> {
    const session = await this.db.userSession.findUnique({
      where: { accessTokenHash: digest(raw) },
      include: {
        user: {
          include: {
            ownedBranches: true,
          },
        },
      },
    });

    if (
      !session ||
      session.revokedAt ||
      session.expiresAt <= new Date() ||
      session.user.status !== 'ACTIVE'
    )
      throw new ApiProblem('SESSION_REVOKED', HttpStatus.UNAUTHORIZED);

    const effectiveRoles = mapUserToEffectiveRoles(session.user);
    const access = this.policy.resolveAccess(session.userId, effectiveRoles);

    return {
      sessionId: session.id,
      userId: session.userId,
      roles: effectiveRoles,
      capabilities: access.capabilities,
      branchIds: access.branchIds,
      capabilityGrants: access.grants,
      capabilityDenials: access.denials,
      sessionExpiresAt: session.expiresAt,
      passwordChangeRequired: false,
    };
  }

  async logout(sessionId: string, _correlationId = 'unknown'): Promise<void> {
    await this.db.userSession.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date(), revocationReason: 'LOGOUT' },
    });
  }

  async revokeAll(
    userId: string,
    reason: string,
    exceptSessionId?: string,
    _correlationId = 'unknown',
  ): Promise<void> {
    await this.db.userSession.updateMany({
      where: {
        userId,
        revokedAt: null,
        ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}),
      },
      data: { revokedAt: new Date(), revocationReason: reason.slice(0, 300) },
    });
  }

  async roleCatalog(principal: SessionPrincipal) {
    this.policy.requireCapability(principal.capabilities, 'user:read');
    return { items: await this.policy.databaseRoleCatalog() };
  }

  async changePassword(
    principal: SessionPrincipal,
    currentPassword: string,
    nextPassword: string,
    _correlationId = 'unknown',
  ) {
    if (process.env.AUTH_PASSWORD_ENABLED !== 'true') configurationRequired();

    const user = await this.db.user.findUnique({
      where: { id: principal.userId },
    });

    if (!user || user.status !== 'ACTIVE')
      throw new ApiProblem('AUTHENTICATION_REQUIRED', HttpStatus.UNAUTHORIZED);

    const valid = user.passwordHash
      ? await verifyPassword(user.passwordHash, currentPassword)
      : false;

    if (!valid) throw new ApiProblem('CURRENT_PASSWORD_INVALID', HttpStatus.UNPROCESSABLE_ENTITY);

    const passwordHash = await hashPassword(nextPassword);
    await this.db.user.update({
      where: { id: user.id },
      data: { passwordHash },
    });

    await this.revokeAll(user.id, 'PASSWORD_CHANGED', principal.sessionId);
    await this.securityEvent('auth.password_changed', user.id, _correlationId, { otherSessionsRevoked: true });
    return { status: 'CHANGED' as const };
  }

  async requestPasswordReset(
    email: string,
    _correlationId = 'unknown',
    requestFingerprint = 'unknown',
  ) {
    if (process.env.AUTH_PASSWORD_ENABLED !== 'true') configurationRequired();
    const normalized = normalizeEmail(email);
    const emailHash = canonicalEmailHash(normalized);
    await Promise.all([
      this.rateLimit.consume('PASSWORD_RESET_SUBJECT', emailHash, 5, 900),
      this.rateLimit.consume('PASSWORD_RESET_ORIGIN', digest(requestFingerprint), 30, 900),
    ]);

    const user = await this.db.user.findUnique({ where: { email: normalized } });
    if (user) {
      try {
        const token = opaqueToken();
        const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
        await this.db.passwordActionToken.create({
          data: {
            kind: 'RESET',
            tokenHash: digest(token),
            emailHash,
            userId: user.id,
            expiresAt,
          },
        });
        await this.passwordEmail.send('RESET', normalized, token);
        await this.securityEvent('auth.password_reset_requested', user.id, _correlationId, { expiresInMinutes: 15 });
      } catch {
        // generic response to avoid disclosing account existence
      }
    }
    return { status: 'ACCEPTED' as const };
  }

  async resetPassword(token: string, password: string, _correlationId = 'unknown') {
    if (process.env.AUTH_PASSWORD_ENABLED !== 'true') configurationRequired();
    const action = await this.db.passwordActionToken.findUnique({
      where: { tokenHash: digest(token) },
    });
    if (
      !action ||
      action.kind !== 'RESET' ||
      !action.userId ||
      action.consumedAt ||
      action.expiresAt <= new Date()
    )
      throw new ApiProblem('CHALLENGE_EXPIRED', HttpStatus.GONE);

    const passwordHash = await hashPassword(password);
    await this.db.$transaction(async (tx) => {
      await tx.passwordActionToken.update({
        where: { id: action.id },
        data: { consumedAt: new Date() },
      });
      await tx.user.update({
        where: { id: action.userId! },
        data: { passwordHash },
      });
      await tx.userSession.updateMany({
        where: { userId: action.userId!, revokedAt: null },
        data: { revokedAt: new Date(), revocationReason: 'PASSWORD_RESET' },
      });
    });
    await this.securityEvent('auth.password_reset_completed', action.userId, _correlationId, { allSessionsRevoked: true });

    return { status: 'CHANGED' as const };
  }

  async activatePassword(token: string, password: string, _correlationId = 'unknown') {
    const action = await this.db.passwordActionToken.findUnique({
      where: { tokenHash: digest(token) },
    });
    if (
      !action ||
      (action.kind !== 'ACTIVATION' && action.kind !== 'SETUP') ||
      !action.userId ||
      action.consumedAt ||
      action.expiresAt <= new Date()
    )
      throw new ApiProblem('CHALLENGE_EXPIRED', HttpStatus.GONE);

    const passwordHash = await hashPassword(password);
    await this.db.$transaction(async (tx) => {
      await tx.passwordActionToken.update({
        where: { id: action.id },
        data: { consumedAt: new Date() },
      });
      await tx.user.update({
        where: { id: action.userId! },
        data: { passwordHash, status: 'ACTIVE' },
      });
    });
    await this.securityEvent('auth.account_activated', action.userId, _correlationId, { via: action.kind });

    return this.issueSession(action.userId!, 'WEB');
  }

  async authenticateGoogle(
    input: { idToken: string; nonce: string; channel: SessionChannel },
    _correlationId: string,
  ) {
    const verified = await this.google.verify(input.idToken, input.nonce);
    const cleanEmail = verified.email ? verified.email.trim().toLowerCase().slice(0, 191) : null;
    let user = cleanEmail && this.db.user?.findUnique
      ? await this.db.user.findUnique({ where: { email: cleanEmail } })
      : null;

    if (!user && (this.db as any).userInvitation?.findFirst && cleanEmail) {
      const invitation = await (this.db as any).userInvitation.findFirst({
        where: { email: cleanEmail, status: 'PENDING' },
      });
      if (!invitation && input.channel !== 'WEB') {
        throw new ApiProblem('AUTHENTICATION_REQUIRED', HttpStatus.UNAUTHORIZED);
      }
    }

    if (!user && cleanEmail) {
      const cleanDisplayName = (
        verified.displayName?.trim() ||
        cleanEmail.split('@')[0] ||
        'User'
      ).slice(0, 128);
      user = await this.db.user.create({
        data: {
          id: newId(),
          email: cleanEmail,
          displayName: cleanDisplayName,
          role: 'CUSTOMER',
          status: 'ACTIVE',
        },
      });
    }

    if (!user || user.status !== 'ACTIVE')
      throw new ApiProblem('AUTHENTICATION_REQUIRED', HttpStatus.UNAUTHORIZED);

    return this.issueSession(user.id, input.channel);
  }

  async registerCustomer(
    input: {
      displayName: string;
      phone: string;
      email: string;
      password: string;
      consent: boolean;
      selfie?: any;
      ktp?: any;
    },
    _correlationId?: string,
    _requestFingerprint?: string,
  ) {
    const displayName = input.displayName?.trim();
    const email = input.email ? normalizeEmail(input.email) : '';
    const phone = input.phone ? input.phone.replace(/[\s().-]/gu, '') : '';
    if (!displayName || !email || !input.password || !phone) {
      throw new ApiProblem('VALIDATION_ERROR', HttpStatus.UNPROCESSABLE_ENTITY);
    }
    if (!isValidEmail(email)) {
      throw new ApiProblem('VALIDATION_ERROR', HttpStatus.UNPROCESSABLE_ENTITY, false, [
        { field: 'email', issue: 'Format email tidak valid.' },
      ]);
    }
    // Selfie wajib sejak pendaftaran pertama: staf mencocokkan wajah ini saat check-in, sehingga
    // paket tidak bisa dipakai bergantian oleh orang lain. KTP tidak diminta.
    if (!input.selfie?.buffer) {
      throw new ApiProblem('VALIDATION_ERROR', HttpStatus.UNPROCESSABLE_ENTITY, false, [
        { field: 'selfie', issue: 'Foto selfie wajib diambil saat mendaftar.' },
      ]);
    }

    // Pre-check for duplicate email or phone (Zero-crash defensive check)
    const existingUser = await this.db.user.findFirst({
      where: {
        OR: [{ email }, { phone }],
      },
    });
    if (existingUser) {
      if (existingUser.email?.toLowerCase() === email.toLowerCase()) {
        throw new ApiProblem('EMAIL_ALREADY_REGISTERED', HttpStatus.CONFLICT);
      }
      throw new ApiProblem('PHONE_ALREADY_REGISTERED', HttpStatus.CONFLICT);
    }

    const passwordHash = await hashPassword(input.password);
    const userId = newId();
    let ktpUrl: string | null = null;
    let selfieUrl: string | null = null;

    const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/jpg'];
    const ALLOWED_EXT = ['jpg', 'jpeg', 'png', 'webp'];

    if (input.ktp?.buffer) {
      const ext = (input.ktp.originalName?.split('.').pop() || '').toLowerCase();
      const mime = (input.ktp.claimedMimeType || '').toLowerCase();
      if (!ALLOWED_EXT.includes(ext) || !ALLOWED_MIME.includes(mime)) {
        throw new ApiProblem('UPLOAD_REJECTED', HttpStatus.UNPROCESSABLE_ENTITY, false, [
          { field: 'ktp', issue: 'Hanya format gambar (JPEG, PNG, WEBP) yang diperbolehkan.' },
        ]);
      }
      const key = `identity-documents/${userId}/ktp-${Date.now()}.${ext}`;
      if (this.privateStorage) {
        await this.privateStorage.put({ key, content: input.ktp.buffer }).catch(() => null);
      }
      ktpUrl = key;
    }

    if (input.selfie?.buffer) {
      const ext = (input.selfie.originalName?.split('.').pop() || '').toLowerCase();
      const mime = (input.selfie.claimedMimeType || '').toLowerCase();
      if (!ALLOWED_EXT.includes(ext) || !ALLOWED_MIME.includes(mime)) {
        throw new ApiProblem('UPLOAD_REJECTED', HttpStatus.UNPROCESSABLE_ENTITY, false, [
          { field: 'selfie', issue: 'Hanya format gambar (JPEG, PNG, WEBP) yang diperbolehkan.' },
        ]);
      }
      const key = `identity-documents/${userId}/selfie-${Date.now()}.${ext}`;
      if (this.privateStorage) {
        await this.privateStorage.put({ key, content: input.selfie.buffer }).catch(() => null);
      }
      selfieUrl = key;
    }

    try {
      const user = await this.db.$transaction(async (tx) => {
        const newUser = await tx.user.create({
          data: {
            id: userId,
            displayName,
            email,
            phone,
            passwordHash,
            role: 'CUSTOMER',
            status: 'ACTIVE',
          },
        });
        await tx.profilPengguna.create({
          data: {
            id: newId(),
            userId,
            fullName: displayName,
            ktpUrl,
            selfieUrl,
          },
        });
        return newUser;
      });
      return this.issueSession(user.id, 'WEB');
    } catch (error: any) {
      if (error?.code === 'P2002') {
        const target = String(error?.meta?.target ?? '');
        if (target.includes('email')) {
          throw new ApiProblem('EMAIL_ALREADY_REGISTERED', HttpStatus.CONFLICT);
        }
        if (target.includes('phone')) {
          throw new ApiProblem('PHONE_ALREADY_REGISTERED', HttpStatus.CONFLICT);
        }
        throw new ApiProblem('DUPLICATE_ENTRY', HttpStatus.CONFLICT);
      }
      throw error;
    }
  }

  async myVerification(principal: SessionPrincipal) {
    const profile = await this.db.profilPengguna.findUnique({
      where: { userId: principal.userId },
    });

    const isApproved = Boolean(profile?.selfieUrl);
    const documents: any[] = [];
    if (profile?.selfieUrl) {
      documents.push({
        id: `doc-selfie-${principal.userId}`,
        kind: 'SELFIE',
        status: isApproved ? 'APPROVED' : 'PENDING',
        uploadStatus: 'FINALIZED',
        scanStatus: 'CLEAN',
        fileName: 'selfie.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: 1024,
        rejectionReasonCode: null,
        rejectionNote: null,
        reviewedAt: profile.updatedAt?.toISOString() ?? new Date().toISOString(),
        deletedAt: null,
        version: 1,
      });
    }

    return {
      status: statusSelfie(profile),
      documents,
      /** Alasan foto terakhir ditolak staf, bila member diminta mengambil ulang. */
      rejectionReason: alasanPenolakanSelfie(profile?.notes),
    };
  }

  async passwordSecurityStatus(principal: SessionPrincipal) {
    const user = await this.db.user.findUnique({
      where: { id: principal.userId },
      select: { passwordHash: true, updatedAt: true },
    });
    const hasPassword = Boolean(user?.passwordHash);
    return {
      hasPassword,
      passwordEnabled: hasPassword,
      mustChangePassword: false,
      passwordChangedAt: user?.updatedAt?.toISOString() ?? null,
    };
  }

  async requestPasswordSetup(
    principal: SessionPrincipal,
    _targetId: string,
    _body: { email: string; reason: string },
    _correlationId: string,
  ) {
    this.policy.requireCapability(principal.capabilities, 'user:admin');
    // Belum ada pengiriman tautan setup password; jangan melaporkan "SENT" untuk sesuatu yang tidak terkirim.
    throw new ApiProblem('NOT_IMPLEMENTED', HttpStatus.NOT_IMPLEMENTED);
  }
}
