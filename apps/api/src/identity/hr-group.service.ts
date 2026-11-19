import { Injectable, Logger, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../foundation/audit.service';
import { bacaOpsional, tabelOpsionalAda } from '../foundation/tabel-opsional';
import { IdentityService } from './identity.service';
import { PolicyService } from './policy.service';
import type { ApplicationRole } from './role-capabilities';
import { RateLimitService } from './rate-limit.service';
import { canonicalRole } from './role-aliases';
import { normalizeEmail, verifyPassword } from './credential-security';
import { digest, newId } from './security';
import {
  HRG_APP,
  HRG_FLOW_TTL_SECONDS,
  type HrGroupConfig,
  type HrgFlow,
  phoneVariants,
  pkceChallenge,
  randomToken,
  safeReturnTo,
  signHrg,
} from './hr-group';

const TABEL_TAUTAN = 'akun_grup_tautan';
const NETWORK_TIMEOUT_MS = 10_000;
/** Hash argon2id tiruan agar waktu respons sama saat identifier tidak dikenal. */
const DUMMY_HASH =
  '$argon2id$v=19$m=65536,t=3,p=1$OQ7j5B/1n5Tt6+Ww8bi6Iw$FDfbEPDKqHJFt1NDZll1WrMu46qpFcQteLeQSGho8Es';

/** Kode galat callback; web memetakan `?hrg_error=<kode>` ke pesan Indonesia. */
export type HrgErrorCode = 'cancelled' | 'state' | 'token' | 'ambiguous' | 'inactive' | 'server';

export class HrgLoginError extends Error {
  constructor(readonly code: HrgErrorCode, detail?: string) {
    super(detail ?? code);
  }
}

export interface HrgClaims {
  sub: string;
  name?: string;
  phone_number?: string;
  phone_number_verified?: boolean;
  email?: string | null;
  email_verified?: boolean;
  hrg_links?: Record<string, string>;
  roles?: string[];
}

export function mapKeycloakBaseRole(roles?: string[]): ApplicationRole | null {
  if (!roles || roles.length === 0) return null;
  if (roles.includes('super-owner') || roles.includes('SUPER_OWNER')) return 'SUPER_OWNER';
  if (roles.includes('owner') || roles.includes('OWNER')) return 'OWNER';
  if (roles.includes('studio-manager') || roles.includes('MANAGER')) return 'MANAGER';
  if (roles.includes('admin') || roles.includes('ADMIN')) return 'ADMIN';
  if (roles.includes('finance') || roles.includes('FINANCE')) return 'FINANCE';
  if (roles.includes('instructor') || roles.includes('INSTRUCTOR')) return 'INSTRUCTOR';
  if (roles.includes('member') || roles.includes('CUSTOMER')) return 'CUSTOMER';
  return null;
}

export type HrgMatchStep = 'link' | 'hrg_links' | 'phone' | 'email' | 'created';

interface Discovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  userinfo_endpoint?: string;
}

type LocalUser = { id: string; role: string; status: string };

const E164 = /^\+[1-9]\d{7,14}$/u;

@Injectable()
export class HrGroupService {
  private readonly logger = new Logger(HrGroupService.name);
  private discovery?: { issuer: string; value: Discovery; at: number };
  private jwks?: { uri: string; set: ReturnType<typeof createRemoteJWKSet> };

  constructor(
    private readonly db: PrismaService,
    private readonly identities: IdentityService,
    private readonly rateLimit: RateLimitService,
    @Optional() private readonly audit?: AuditService,
    @Optional() private readonly policy?: PolicyService,
  ) { }

  // ---------------------------------------------------------------- OIDC

  private async discover(config: HrGroupConfig): Promise<Discovery> {
    const cached = this.discovery;
    if (cached && cached.issuer === config.issuer && Date.now() - cached.at < 3_600_000) return cached.value;
    const response = await fetch(`${config.issuer}/.well-known/openid-configuration`, {
      signal: AbortSignal.timeout(NETWORK_TIMEOUT_MS),
    });
    if (!response.ok) throw new HrgLoginError('server', `discovery HTTP ${response.status}`);
    const value = (await response.json()) as Discovery;
    if (value.issuer?.replace(/\/+$/u, '') !== config.issuer)
      throw new HrgLoginError('server', `issuer discovery ${value.issuer} tidak sama dengan HRG_ISSUER`);
    if (!value.authorization_endpoint || !value.token_endpoint || !value.jwks_uri)
      throw new HrgLoginError('server', 'discovery tidak lengkap');
    this.discovery = { issuer: config.issuer, value, at: Date.now() };
    return value;
  }

  /** URL otorisasi (code + PKCE S256 + state + nonce) dan isi cookie alur. */
  async beginLogin(config: HrGroupConfig, returnTo: unknown) {
    const discovery = await this.discover(config);
    const flow: HrgFlow = {
      state: randomToken(),
      nonce: randomToken(),
      verifier: randomToken(),
      returnTo: safeReturnTo(returnTo),
      exp: Math.floor(Date.now() / 1000) + HRG_FLOW_TTL_SECONDS,
    };
    const url = new URL(discovery.authorization_endpoint);
    url.search = new URLSearchParams({
      response_type: 'code',
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      scope: 'openid profile email phone',
      state: flow.state,
      nonce: flow.nonce,
      code_challenge: pkceChallenge(flow.verifier),
      code_challenge_method: 'S256',
    }).toString();
    return { url: url.toString(), flow };
  }

  /** Tukar code (client_secret_basic), verifikasi id_token lewat JWKS, lengkapi klaim dari userinfo. */
  async exchange(config: HrGroupConfig, code: string, flow: HrgFlow): Promise<HrgClaims> {
    const discovery = await this.discover(config);
    const basic = Buffer.from(
      `${encodeURIComponent(config.clientId)}:${encodeURIComponent(config.clientSecret)}`,
    ).toString('base64');
    const tokenResponse = await fetch(discovery.token_endpoint, {
      method: 'POST',
      headers: {
        authorization: `Basic ${basic}`,
        'content-type': 'application/x-www-form-urlencoded',
        accept: 'application/json',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: config.redirectUri,
        code_verifier: flow.verifier,
      }).toString(),
      signal: AbortSignal.timeout(NETWORK_TIMEOUT_MS),
    });
    const tokens = (await tokenResponse.json().catch(() => ({}))) as {
      id_token?: string;
      access_token?: string;
      error?: string;
    };
    if (!tokenResponse.ok || !tokens.id_token)
      throw new HrgLoginError('token', `token endpoint HTTP ${tokenResponse.status} ${tokens.error ?? ''}`);

    if (this.jwks?.uri !== discovery.jwks_uri)
      this.jwks = { uri: discovery.jwks_uri, set: createRemoteJWKSet(new URL(discovery.jwks_uri)) };
    let payload: JWTPayload;
    try {
      ({ payload } = await jwtVerify(tokens.id_token, this.jwks.set, {
        issuer: discovery.issuer,
        audience: config.clientId,
        algorithms: ['RS256'],
      }));
    } catch (error) {
      throw new HrgLoginError('token', `id_token ditolak: ${(error as Error).message}`);
    }
    if (payload.nonce !== flow.nonce) throw new HrgLoginError('token', 'nonce id_token tidak cocok');
    if (typeof payload.sub !== 'string' || !payload.sub) throw new HrgLoginError('token', 'id_token tanpa sub');

    let claims = payload as unknown as HrgClaims;
    if (tokens.access_token && discovery.userinfo_endpoint) {
      try {
        const info = await fetch(discovery.userinfo_endpoint, {
          headers: { authorization: `Bearer ${tokens.access_token}`, accept: 'application/json' },
          signal: AbortSignal.timeout(NETWORK_TIMEOUT_MS),
        });
        const extra = info.ok ? ((await info.json()) as Partial<HrgClaims>) : null;
        // Userinfo hanya dipakai bila sub-nya sama dengan id_token yang sudah terverifikasi.
        if (extra?.sub === payload.sub) claims = { ...claims, ...pickDefined(extra), sub: payload.sub };
      } catch (error) {
        this.logger.warn(`Userinfo HR Group gagal dibaca, memakai klaim id_token: ${(error as Error).message}`);
      }
    }

    if (tokens.access_token) {
      try {
        const parts = tokens.access_token.split('.');
        if (parts.length === 3 && parts[1]) {
          const tokenPayload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
          const clientRoles = tokenPayload?.resource_access?.[config.clientId]?.roles;
          if (Array.isArray(clientRoles) && clientRoles.length > 0) {
            claims.roles = clientRoles;
          }
        }
      } catch (error) {
        this.logger.warn(`Gagal membaca resource_access client roles dari access_token: ${(error as Error).message}`);
      }
    }

    return claims;
  }

  // ---------------------------------------------------------------- pemetaan

  /** Empat langkah kontrak; berhenti di langkah pertama yang cocok. Staf tidak pernah dibuat otomatis. */
  async resolveUser(
    claims: HrgClaims,
    correlationId: string,
  ): Promise<{ userId: string; step: HrgMatchStep; linked: boolean }> {
    const sub = claims.sub;

    // 1. Tautan lokal.
    const link = await bacaOpsional(
      TABEL_TAUTAN,
      () => this.db.akunGrupTautan.findUnique({ where: { hrgSub: sub } }),
      null,
    );
    if (link) {
      const user = await this.findUser(link.userId);
      if (user) return this.accept(user, 'link', claims, correlationId, false);
    }

    // 2. hrg_links.dailydose dari Akun HR Group.
    const hinted = claims.hrg_links?.[HRG_APP];
    if (typeof hinted === 'string' && hinted) {
      const user = await this.findUser(hinted);
      if (user) return this.accept(user, 'hrg_links', claims, correlationId, true);
    }

    // 3. Nomor HP / email terverifikasi.
    const candidates = new Map<string, { user: LocalUser; step: HrgMatchStep }>();
    const phone = verifiedPhone(claims);
    if (phone) {
      const rows = await this.db.user.findMany({
        where: { phone: { in: phoneVariants(phone) } },
        select: { id: true, role: true, status: true },
      });
      for (const user of rows) candidates.set(user.id, { user, step: 'phone' });
    }
    const email = verifiedEmail(claims);
    if (email) {
      const rows = await this.db.user.findMany({
        where: { email },
        select: { id: true, role: true, status: true },
      });
      for (const user of rows) if (!candidates.has(user.id)) candidates.set(user.id, { user, step: 'email' });
    }
    if (candidates.size > 1) {
      const ids = [...candidates.keys()];
      this.logger.warn(`Login HR Group ditolak: sub ${sub} cocok dengan ${ids.length} akun (${ids.join(', ')}).`);
      await this.audit?.catat(null, {
        correlationId,
        action: 'auth.hrg_ambiguous',
        objectType: 'Account',
        objectId: sub,
        afterMasked: { candidateUserIds: ids },
      });
      throw new HrgLoginError('ambiguous');
    }
    const only = [...candidates.values()][0];
    if (only) return this.accept(only.user, only.step, claims, correlationId, true);

    // 4. Customer baru (peran CUSTOMER saja).
    const created = await this.createCustomer(claims, phone, email);
    await this.audit?.catat(null, {
      actorId: created.id,
      correlationId,
      action: 'auth.hrg_customer_created',
      objectType: 'Account',
      objectId: created.id,
      targetUserId: created.id,
      afterMasked: { hrgSub: sub },
    });
    return this.accept(created, 'created', claims, correlationId, true);
  }

  private async findUser(id: string): Promise<LocalUser | null> {
    if (!/^[0-9a-zA-Z_-]{8,40}$/u.test(id)) return null;
    return this.db.user.findUnique({ where: { id }, select: { id: true, role: true, status: true } });
  }

  private async accept(
    user: LocalUser,
    step: HrgMatchStep,
    claims: HrgClaims,
    correlationId: string,
    createLink: boolean,
  ) {
    if (user.status !== 'ACTIVE') throw new HrgLoginError('inactive');
    let linked = false;
    if (createLink) linked = await this.saveLink(claims.sub, user.id, correlationId);

    // Sinkronisasi base role dari Keycloak jika ada
    const mappedRole = mapKeycloakBaseRole(claims.roles);
    if (mappedRole && user.role !== mappedRole) {
      await this.db.user.update({
        where: { id: user.id },
        data: { role: mappedRole as any },
      });
      user.role = mappedRole;
    }

    // Injeksi capability overrides dari client roles Keycloak
    if (claims.roles && this.policy) {
      const customCaps = claims.roles.filter((r) => r.includes(':'));
      this.policy.setUserOverrides(user.id, customCaps);
    }

    await this.audit?.catat(null, {
      actorId: user.id,
      correlationId,
      action: 'auth.hrg_login',
      objectType: 'Account',
      objectId: user.id,
      targetUserId: user.id,
      afterMasked: { step, role: canonicalRole(user.role) },
    });
    return { userId: user.id, step, linked };
  }

  private async saveLink(sub: string, userId: string, correlationId: string): Promise<boolean> {
    if (!(await tabelOpsionalAda(this.db, TABEL_TAUTAN))) return false;
    try {
      await this.db.akunGrupTautan.create({ data: { id: newId(), hrgSub: sub, userId } });
    } catch (error) {
      // Dua callback bersamaan untuk sub yang sama: tautan sudah dibuat oleh yang lain.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return false;
      throw error;
    }
    await this.audit?.catat(null, {
      actorId: userId,
      correlationId,
      action: 'auth.hrg_linked',
      objectType: 'Account',
      objectId: userId,
      targetUserId: userId,
      afterMasked: { hrgSub: sub },
    });
    return true;
  }

  private async createCustomer(claims: HrgClaims, phone: string | null, email: string | null) {
    // Nomor/email yang sudah dipakai akun lain (data lama dengan format lain) tidak disalin.
    const phoneFree = phone
      ? !(await this.db.user.findFirst({ where: { phone: { in: phoneVariants(phone) } }, select: { id: true } }))
      : false;
    const emailFree = email
      ? !(await this.db.user.findFirst({ where: { email }, select: { id: true } }))
      : false;
    const displayName =
      (typeof claims.name === 'string' && claims.name.trim()) ||
      email?.split('@')[0] ||
      'Member HR Group';
    const mappedRole = mapKeycloakBaseRole(claims.roles);
    return this.db.user.create({
      data: {
        id: newId(),
        displayName: displayName.slice(0, 128),
        phone: phoneFree ? phone : null,
        email: emailFree ? email : null,
        role: (mappedRole ?? 'CUSTOMER') as any,
        status: 'ACTIVE',
      },
      select: { id: true, role: true, status: true },
    });
  }

  /** Sesi Daily Dose biasa, sama seperti login password/Google. */
  issueSession(userId: string) {
    return this.identities.issueSession(userId, 'WEB');
  }

  /** Back-channel `POST ${HRG_ISSUER}/api/links`; kegagalan hanya dicatat, login tetap jalan. */
  async notifyLink(config: HrGroupConfig, sub: string, localUserId: string): Promise<void> {
    const body = JSON.stringify({ sub, app: HRG_APP, localUserId });
    const timestamp = String(Math.floor(Date.now() / 1000));
    try {
      const response = await fetch(`${config.issuer}/api/links`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-hrg-timestamp': timestamp,
          'x-hrg-signature': signHrg(config.bridgeSecret, timestamp, body),
        },
        body,
        signal: AbortSignal.timeout(NETWORK_TIMEOUT_MS),
      });
      if (!response.ok)
        this.logger.warn(`Back-channel tautan HR Group gagal (HTTP ${response.status}) untuk user ${localUserId}.`);
    } catch (error) {
      this.logger.warn(`Back-channel tautan HR Group gagal untuk user ${localUserId}: ${(error as Error).message}`);
    }
  }

  // ---------------------------------------------------------------- credential bridge

  /**
   * Migrasi tanpa daftar ulang: Akun HR Group menanyakan nomor/email + password lama. Hanya customer aktif;
   * staf, user tidak ada, dan password salah mendapat jawaban yang sama (null -> 401).
   * Batas 10 percobaan per identifier per 15 menit (jendela tetap).
   */
  async verifyCredentials(identifier: string, password: string, now = Date.now()) {
    const key = identifierKey(identifier);
    const windowStart = Math.floor(now / 900_000);
    await this.rateLimit.consume('HRG_VERIFY_CREDENTIALS', digest(`${key.kind}:${key.value}:${windowStart}`), 10, 900);

    const user =
      key.kind === 'phone'
        ? await this.db.user.findFirst({ where: { phone: { in: phoneVariants(key.value) } } })
        : key.kind === 'email'
          ? await this.db.user.findUnique({ where: { email: key.value } })
          : null;
    const valid = await verifyPassword(user?.passwordHash ?? DUMMY_HASH, password);
    if (!user || !user.passwordHash || !valid) return null;
    if (user.status !== 'ACTIVE' || canonicalRole(user.role) !== 'CUSTOMER') return null;
    return {
      userId: user.id,
      name: user.displayName,
      phone: user.phone ? toE164(user.phone) : null,
      email: user.email ?? null,
      // Daily Dose tidak menyimpan status verifikasi nomor/email; jangan klaim terverifikasi.
      phoneVerified: false,
      emailVerified: false,
    };
  }
}

function pickDefined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined && v !== null)) as Partial<T>;
}

function toE164(raw: string): string | null {
  const compact = raw.replace(/[\s().-]/gu, '');
  const value = compact.startsWith('0') ? `+62${compact.slice(1)}` : compact.startsWith('62') ? `+${compact}` : compact;
  return E164.test(value) ? value : null;
}

function verifiedPhone(claims: HrgClaims): string | null {
  if (claims.phone_number_verified !== true || typeof claims.phone_number !== 'string') return null;
  return toE164(claims.phone_number);
}

function verifiedEmail(claims: HrgClaims): string | null {
  if (claims.email_verified !== true || typeof claims.email !== 'string' || !claims.email.includes('@')) return null;
  return normalizeEmail(claims.email).slice(0, 191);
}

function identifierKey(identifier: string): { kind: 'phone' | 'email' | 'unknown'; value: string } {
  const raw = identifier.trim();
  if (raw.includes('@')) return { kind: 'email', value: normalizeEmail(raw) };
  const phone = /^\+?[0-9\s().-]{7,20}$/u.test(raw) ? toE164(raw) : null;
  return phone ? { kind: 'phone', value: phone } : { kind: 'unknown', value: raw.toLowerCase() };
}
