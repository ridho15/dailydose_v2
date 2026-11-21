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

@Injectable()
export class KeycloakJitService {
  private readonly logger = new Logger(KeycloakJitService.name);
  private tokenCache: TokenCache | null = null;

  constructor(private readonly db: PrismaService) {}

  private get baseUrl(): string {
    const raw = process.env.KEYCLOAK_BASE_URL || process.env.HRG_ISSUER || 'http://localhost:8080';
    return raw.replace(/\/realms\/.*$/u, '').replace(/\/+$/u, '');
  }

  private get realm(): string {
    return process.env.KEYCLOAK_REALM || 'hrgroup';
  }

  private get adminUser(): string {
    return process.env.KEYCLOAK_ADMIN_USER || 'admin';
  }

  private get adminPassword(): string {
    return process.env.KEYCLOAK_ADMIN_PASSWORD || 'admin_hrgroup_local';
  }

  /**
   * Mendapatkan Token Admin Keycloak (dengan cache memori)
   */
  private async getAdminToken(): Promise<string | null> {
    const now = Date.now();
    if (this.tokenCache && this.tokenCache.expiresAt > now + 10_000) {
      return this.tokenCache.accessToken;
    }

    try {
      const response = await fetch(`${this.baseUrl}/realms/master/protocol/openid-connect/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: 'admin-cli',
          grant_type: 'password',
          username: this.adminUser,
          password: this.adminPassword,
        }).toString(),
        signal: AbortSignal.timeout(4000),
      });

      if (!response.ok) {
        this.logger.warn(`Gagal otentikasi admin Keycloak (HTTP ${response.status})`);
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
      this.logger.warn(`Koneksi Keycloak Admin gagal: ${(err as Error).message}`);
      return null;
    }
  }

  /**
   * Eksekusi Lazy Migration saat login lokal sukses.
   * Bersifat fail-safe: jika Keycloak tidak dapat dijangkau, tidak akan melempar error ke user.
   */
  async migrateUserJit(user: UserToMigrate, plainPassword: string): Promise<boolean> {
    try {
      // 1. Cek apakah user sudah tertaut ke Keycloak di tabel akun_grup_tautan
      const existingLink = await this.db.akunGrupTautan.findFirst({
        where: { userId: user.id },
      });
      if (existingLink) {
        return true; // Sudah termigrasi sebelumnya
      }

      // 2. Dapatkan token Admin Keycloak
      const token = await this.getAdminToken();
      if (!token) {
        this.logger.warn(`Keycloak JIT tertunda untuk user ${user.id}: Admin token tidak tersedia`);
        return false;
      }

      // 3. Cek apakah user sudah ada di Keycloak (berdasarkan email atau username/phone)
      let keycloakUserId: string | null = null;

      if (user.email) {
        const searchRes = await fetch(
          `${this.baseUrl}/admin/realms/${this.realm}/users?email=${encodeURIComponent(user.email)}&exact=true`,
          {
            headers: { Authorization: `Bearer ${token}` },
            signal: AbortSignal.timeout(4000),
          },
        );
        if (searchRes.ok) {
          const list = (await searchRes.json()) as Array<{ id: string }>;
          if (list && list.length > 0 && list[0]) {
            keycloakUserId = list[0].id;
          }
        }
      }

      const cleanUsername = (user.username || user.email || user.phone || `dd_${user.id.slice(0, 8)}`).trim().toLowerCase();

      if (!keycloakUserId && cleanUsername) {
        const userRes = await fetch(
          `${this.baseUrl}/admin/realms/${this.realm}/users?username=${encodeURIComponent(cleanUsername)}&exact=true`,
          {
            headers: { Authorization: `Bearer ${token}` },
            signal: AbortSignal.timeout(4000),
          },
        );
        if (userRes.ok) {
          const list = (await userRes.json()) as Array<{ id: string }>;
          if (list && list.length > 0 && list[0]) {
            keycloakUserId = list[0].id;
          }
        }
      }

      // 4. Jika user sudah ada di Keycloak, sinkronkan password
      if (keycloakUserId) {
        await fetch(`${this.baseUrl}/admin/realms/${this.realm}/users/${keycloakUserId}/reset-password`, {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            type: 'password',
            value: plainPassword,
            temporary: false,
          }),
          signal: AbortSignal.timeout(4000),
        });
      } else {
        // 5. Jika belum ada di Keycloak, buat akun baru
        const parts = (user.displayName || 'Member').trim().split(/\s+/u);
        const firstName = parts[0] || 'Member';
        const lastName = parts.slice(1).join(' ') || '';

        const createRes = await fetch(`${this.baseUrl}/admin/realms/${this.realm}/users`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            username: cleanUsername,
            email: user.email || undefined,
            firstName,
            lastName: lastName || undefined,
            enabled: true,
            emailVerified: true,
            credentials: [
              {
                type: 'password',
                value: plainPassword,
                temporary: false,
              },
            ],
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
          return false;
        }

        // Ambil User ID Keycloak dari Location header atau query ulang
        const locationHeader = createRes.headers.get('Location');
        if (locationHeader) {
          keycloakUserId = locationHeader.split('/').pop() || null;
        }

        if (!keycloakUserId) {
          const reSearch = await fetch(
            `${this.baseUrl}/admin/realms/${this.realm}/users?username=${encodeURIComponent(cleanUsername)}&exact=true`,
            {
              headers: { Authorization: `Bearer ${token}` },
              signal: AbortSignal.timeout(4000),
            },
          );
          if (reSearch.ok) {
            const reList = (await reSearch.json()) as Array<{ id: string }>;
            if (reList && reList.length > 0 && reList[0]) {
              keycloakUserId = reList[0].id;
            }
          }
        }
      }

      // 6. Simpan tautan ke tabel akun_grup_tautan
      if (keycloakUserId) {
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
          return true;
        } catch (dbErr: any) {
          // Tangani unique constraint P2002 jika ada login concurrent
          if (dbErr?.code === 'P2002') return true;
          this.logger.warn(`Gagal menyimpan tautan lokal: ${dbErr.message}`);
        }
      }

      return false;
    } catch (err: any) {
      this.logger.warn(`Keycloak JIT deferred untuk user ${user.id}: ${err.message}`);
      return false;
    }
  }
}
