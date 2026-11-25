import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { newId } from './security';

interface TokenCache {
  accessToken: string;
  expiresAt: number;
}

export interface UserToMigrate {
  id: string;
  email?: string | null;
  phone?: string | null;
  username?: string | null;
  displayName: string;
  preferredBranchId?: string | null;
  role?: string;
}

type GrantResult = 'ok' | 'invalid_grant' | 'error';
export type JitSyncStatus = 'ok' | 'blocked' | 'deferred';

@Injectable()
export class KeycloakJitService {
  private readonly logger = new Logger(KeycloakJitService.name);
  private tokenCache: TokenCache | null = null;
  private clientMetaCache: { uuid: string; memberRole: { id: string; name: string } | null } | null = null;

  constructor(private readonly db: PrismaService) {}

  private get issuerRaw(): string {
    return (process.env.HRG_ISSUER || process.env.KEYCLOAK_BASE_URL || 'http://localhost:8080/realms/hrgroup').trim();
  }

  private get baseUrl(): string {
    return this.issuerRaw.replace(/\/realms\/.*$/u, '').replace(/\/+$/u, '');
  }

  private get realm(): string {
    const match = this.issuerRaw.match(/\/realms\/([^/]+)/u);
    return match?.[1] || process.env.KEYCLOAK_REALM || 'hrgroup';
  }

  private get clientId(): string {
    return process.env.HRG_CLIENT_ID || 'dailydose';
  }

  private get clientSecret(): string {
    return process.env.HRG_CLIENT_SECRET?.trim() || '';
  }

  /**
   * Mendapatkan Service Account Token (client_credentials) memakai HRG_CLIENT_ID & HRG_CLIENT_SECRET.
   */
  private async getServiceToken(): Promise<string | null> {
    if (!this.clientSecret) {
      this.logger.warn('[KeycloakJIT] HRG_CLIENT_SECRET belum diisi; sinkronisasi dilewati.');
      return null;
    }

    const now = Date.now();
    if (this.tokenCache && this.tokenCache.expiresAt > now + 10_000) {
      return this.tokenCache.accessToken;
    }

    try {
      const response = await fetch(`${this.baseUrl}/realms/${this.realm}/protocol/openid-connect/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: this.clientId,
          client_secret: this.clientSecret,
          grant_type: 'client_credentials',
        }).toString(),
        signal: AbortSignal.timeout(4000),
      });

      if (!response.ok) {
        this.logger.warn(`Gagal otentikasi Service Account Keycloak (HTTP ${response.status})`);
        return null;
      }

      const data = (await response.json()) as { access_token?: string; expires_in?: number };
      if (!data.access_token) return null;

      this.tokenCache = {
        accessToken: data.access_token,
        expiresAt: now + (data.expires_in ?? 60) * 1000,
      };

      return data.access_token;
    } catch (err) {
      this.logger.warn(`Koneksi Service Account Keycloak gagal: ${(err as Error).message}`);
      return null;
    }
  }

  /**
   * Membuka sesi aktif dan mencatat event LOGIN di Keycloak via Direct Access Grants.
   */
  private async triggerDirectGrantSession(username: string, plainPassword: string): Promise<GrantResult> {
    if (!this.clientSecret) {
      this.logger.warn('[KeycloakJIT] HRG_CLIENT_SECRET belum diisi; sesi OIDC tidak dibuat.');
      return 'error';
    }

    try {
      const resp = await fetch(`${this.baseUrl}/realms/${this.realm}/protocol/openid-connect/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: this.clientId,
          client_secret: this.clientSecret,
          grant_type: 'password',
          username,
          password: plainPassword,
          scope: 'openid profile email',
        }).toString(),
        signal: AbortSignal.timeout(4000),
      });

      if (resp.ok) {
        this.logger.log(`[KeycloakJIT] Sesi OIDC aktif berhasil dibuat di Keycloak untuk user: ${username}`);
        return 'ok';
      }

      const errBody = (await resp.json().catch(() => ({}))) as { error?: string };
      if ((resp.status === 400 || resp.status === 401) && errBody.error === 'invalid_grant') {
        return 'invalid_grant';
      }

      this.logger.warn(`[KeycloakJIT] Direct grant session status: HTTP ${resp.status} (${errBody.error || 'unknown'})`);
      return 'error';
    } catch (err) {
      this.logger.warn(`[KeycloakJIT] Direct grant deferred: ${(err as Error).message}`);
      return 'error';
    }
  }

  /**
   * Memulihkan sesi bila username/password di Keycloak tidak sinkron dengan login lokal terbaru.
   */
  private async recoverSessionBySub(hrgSub: string, plainPassword: string): Promise<boolean> {
    const token = await this.getServiceToken();
    if (!token) return false;

    const userRes = await fetch(
      `${this.baseUrl}/admin/realms/${this.realm}/users/${encodeURIComponent(hrgSub)}`,
      { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(4000) },
    );
    if (!userRes.ok) return false;

    const kcUser = (await userRes.json()) as { username?: string; email?: string };
    const realUsername = (kcUser.username || kcUser.email || '').trim();
    if (!realUsername) return false;

    const resetRes = await fetch(
      `${this.baseUrl}/admin/realms/${this.realm}/users/${encodeURIComponent(hrgSub)}/reset-password`,
      {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'password', value: plainPassword, temporary: false }),
        signal: AbortSignal.timeout(4000),
      },
    );
    if (!resetRes.ok) return false;

    return (await this.triggerDirectGrantSession(realUsername, plainPassword)) === 'ok';
  }

  private async resolveClientMeta(
    token: string,
  ): Promise<{ uuid: string; memberRole: { id: string; name: string } | null } | null> {
    if (this.clientMetaCache) return this.clientMetaCache;
    try {
      const cRes = await fetch(
        `${this.baseUrl}/admin/realms/${this.realm}/clients?clientId=${encodeURIComponent(this.clientId)}&exact=true`,
        { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(4000) },
      );
      if (!cRes.ok) return null;
      const clients = (await cRes.json()) as Array<{ id: string }>;
      const uuid = clients?.[0]?.id;
      if (!uuid) return null;

      let memberRole: { id: string; name: string } | null = null;
      const rRes = await fetch(
        `${this.baseUrl}/admin/realms/${this.realm}/clients/${uuid}/roles/member`,
        { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(4000) },
      );
      if (rRes.ok) {
        const role = (await rRes.json()) as { id?: string; name?: string };
        if (role?.id && role?.name) memberRole = { id: role.id, name: role.name };
      }

      this.clientMetaCache = { uuid, memberRole };
      return this.clientMetaCache;
    } catch {
      return null;
    }
  }

  private async ensureAppMemberRole(token: string, keycloakUserId: string): Promise<void> {
    const meta = await this.resolveClientMeta(token);
    if (!meta?.memberRole) return;
    await fetch(
      `${this.baseUrl}/admin/realms/${this.realm}/users/${keycloakUserId}/role-mappings/clients/${meta.uuid}`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify([meta.memberRole]),
        signal: AbortSignal.timeout(4000),
      },
    ).catch(() => {});
  }

  private async checkKeycloakAccess(
    token: string,
    keycloakUserId: string,
  ): Promise<'allowed' | 'blocked' | 'unknown'> {
    try {
      const userRes = await fetch(
        `${this.baseUrl}/admin/realms/${this.realm}/users/${encodeURIComponent(keycloakUserId)}`,
        { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(4000) },
      );
      if (userRes.ok) {
        const u = (await userRes.json()) as { enabled?: boolean };
        if (u?.enabled === false) return 'blocked';
      } else if (userRes.status === 404) {
        return 'unknown';
      }

      const meta = await this.resolveClientMeta(token);
      if (!meta) return 'unknown';

      const roleRes = await fetch(
        `${this.baseUrl}/admin/realms/${this.realm}/users/${encodeURIComponent(keycloakUserId)}/role-mappings/clients/${meta.uuid}`,
        { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(4000) },
      );
      if (!roleRes.ok) return 'unknown';
      const roles = (await roleRes.json()) as Array<{ id: string; name: string }>;
      return Array.isArray(roles) && roles.length > 0 ? 'allowed' : 'blocked';
    } catch {
      return 'unknown';
    }
  }

  /**
   * Sinkronisasi dua arah (Opsi B):
   * - User baru: buat/temukan di Keycloak + assign role 'member' pada client aplikasi + buka sesi OIDC.
   * - User tertaut: cek status enabled & akses client di Keycloak ('blocked' jika dinonaktifkan/dicabut).
   */
  async checkAndSyncUser(user: UserToMigrate, plainPassword: string): Promise<JitSyncStatus> {
    try {
      const cleanUsername = (user.username || user.email || user.phone || `dd_${user.id.slice(0, 8)}`)
        .trim()
        .toLowerCase();

      const existingLink = await this.db.akunGrupTautan.findFirst({
        where: { userId: user.id },
      });

      if (existingLink) {
        const token = await this.getServiceToken();
        if (token) {
          const access = await this.checkKeycloakAccess(token, existingLink.hrgSub);
          if (access === 'blocked') {
            this.logger.warn(`[KeycloakJIT] Akses ditolak untuk user ${user.id} (dinonaktifkan/dicabut di HR Group)`);
            return 'blocked';
          }
        }

        const result = await this.triggerDirectGrantSession(cleanUsername, plainPassword);
        if (result === 'ok') return 'ok';
        if (result === 'invalid_grant') {
          return (await this.recoverSessionBySub(existingLink.hrgSub, plainPassword)) ? 'ok' : 'deferred';
        }
        return 'deferred';
      }

      const token = await this.getServiceToken();
      if (!token) {
        this.logger.warn(`Keycloak JIT tertunda untuk user ${user.id}: Service token tidak tersedia`);
        return 'deferred';
      }

      let keycloakUserId: string | null = null;
      let resolvedUsername = cleanUsername;

      if (user.email) {
        const searchRes = await fetch(
          `${this.baseUrl}/admin/realms/${this.realm}/users?email=${encodeURIComponent(user.email)}&exact=true`,
          { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(4000) },
        );
        if (searchRes.ok) {
          const list = (await searchRes.json()) as Array<{ id: string; username?: string }>;
          if (list?.[0]) {
            keycloakUserId = list[0].id;
            if (list[0].username) resolvedUsername = list[0].username;
          }
        }
      }

      if (!keycloakUserId && cleanUsername) {
        const userRes = await fetch(
          `${this.baseUrl}/admin/realms/${this.realm}/users?username=${encodeURIComponent(cleanUsername)}&exact=true`,
          { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(4000) },
        );
        if (userRes.ok) {
          const list = (await userRes.json()) as Array<{ id: string; username?: string }>;
          if (list?.[0]) {
            keycloakUserId = list[0].id;
            if (list[0].username) resolvedUsername = list[0].username;
          }
        }
      }

      if (keycloakUserId) {
        await fetch(`${this.baseUrl}/admin/realms/${this.realm}/users/${keycloakUserId}/reset-password`, {
          method: 'PUT',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'password', value: plainPassword, temporary: false }),
          signal: AbortSignal.timeout(4000),
        });
      } else {
        const parts = (user.displayName || 'Member').trim().split(/\s+/u);
        const firstName = parts[0] || 'Member';
        const lastName = parts.slice(1).join(' ') || '';

        const createRes = await fetch(`${this.baseUrl}/admin/realms/${this.realm}/users`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            username: cleanUsername,
            email: user.email || undefined,
            firstName,
            lastName: lastName || undefined,
            enabled: true,
            emailVerified: true,
            credentials: [{ type: 'password', value: plainPassword, temporary: false }],
            attributes: {
              source_app: ['dailydose'],
              dailydose_user_id: [user.id],
              branch: user.preferredBranchId ? [user.preferredBranchId] : [],
              phone: user.phone ? [user.phone] : [],
            },
          }),
          signal: AbortSignal.timeout(4000),
        });

        if (!createRes.ok && createRes.status !== 409) {
          this.logger.warn(`Gagal membuat user di Keycloak (HTTP ${createRes.status})`);
          return 'deferred';
        }

        const locationHeader = createRes.headers.get('Location');
        if (locationHeader) {
          keycloakUserId = locationHeader.split('/').pop() || null;
        }

        if (!keycloakUserId) {
          const reSearch = await fetch(
            `${this.baseUrl}/admin/realms/${this.realm}/users?username=${encodeURIComponent(cleanUsername)}&exact=true`,
            { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(4000) },
          );
          if (reSearch.ok) {
            const reList = (await reSearch.json()) as Array<{ id: string }>;
            if (reList?.[0]) keycloakUserId = reList[0].id;
          }
        }
      }

      if (keycloakUserId) {
        await this.ensureAppMemberRole(token, keycloakUserId);
        try {
          await this.db.akunGrupTautan.create({
            data: {
              id: newId(),
              hrgSub: keycloakUserId,
              userId: user.id,
            },
          });
          this.logger.log(
            `[KeycloakJIT] Akun ${user.email || user.username || user.id} berhasil dimigrasikan ke Keycloak (sub: ${keycloakUserId})`,
          );
          await this.triggerDirectGrantSession(resolvedUsername, plainPassword);
          return 'ok';
        } catch (dbErr: any) {
          if (dbErr?.code === 'P2002') {
            await this.triggerDirectGrantSession(resolvedUsername, plainPassword);
            return 'ok';
          }
          this.logger.warn(`Gagal menyimpan tautan lokal: ${dbErr.message}`);
        }
      }

      return 'deferred';
    } catch (err: any) {
      this.logger.warn(`Keycloak JIT deferred untuk user ${user.id}: ${err.message}`);
      return 'deferred';
    }
  }

  async migrateUserJit(user: UserToMigrate, plainPassword: string): Promise<boolean> {
    return (await this.checkAndSyncUser(user, plainPassword)) === 'ok';
  }
}
