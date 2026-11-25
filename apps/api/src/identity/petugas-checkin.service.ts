import { HttpStatus, Injectable, Optional } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../foundation/audit.service';
import { tabelOpsionalAda } from '../foundation/tabel-opsional';
import { hashPassword } from './credential-security';
import type { SessionPrincipal } from './identity.service';
import { PolicyService } from './policy.service';
import { ApiProblem, newId } from './security';

const CAP = 'checkin-staff:manage';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const POLA_USERNAME = /^[a-z0-9][a-z0-9._-]{2,31}$/;

export interface PetugasView {
  userId: string;
  displayName: string;
  username: string | null;
  branchId: string;
  branchName: string | null;
  status: string;
  createdAt: string;
}

const salah = (field: string, issue: string) =>
  new ApiProblem('VALIDATION_ERROR', HttpStatus.UNPROCESSABLE_ENTITY, false, [{ field, issue }]);

/**
 * Akun Petugas Check-in (sales/OB) untuk satu cabang: dibuat, diganti kata sandinya, dan dinonaktifkan oleh
 * Manager cabang itu atau Super Owner (keputusan pemilik 25 November 2026). Akunnya `user.role = ADMIN`
 * dengan baris di `petugas_checkin`; peran efektifnya CHECKIN_STAFF (lihat `mapUserToEffectiveRoles`).
 */
@Injectable()
export class PetugasCheckinService {
  constructor(
    private readonly db: PrismaService,
    private readonly policy: PolicyService,
    @Optional() private readonly audit?: AuditService,
  ) {}

  private boleh(principal: SessionPrincipal, branchId: string) {
    return this.policy.hasCapability(principal, 'branch:all', branchId) || this.policy.hasCapability(principal, CAP, branchId);
  }

  private async pastikanTabel() {
    if (!(await tabelOpsionalAda(this.db, 'petugas_checkin')))
      throw new ApiProblem('CHECKIN_STAFF_UNAVAILABLE', HttpStatus.SERVICE_UNAVAILABLE);
  }

  async daftar(principal: SessionPrincipal, query: { branchId?: string } = {}): Promise<{ items: PetugasView[] }> {
    this.policy.requireCapability(principal.capabilities, CAP);
    if (query.branchId && !this.boleh(principal, query.branchId)) throw new ApiProblem('FORBIDDEN', HttpStatus.FORBIDDEN);
    if (!(await tabelOpsionalAda(this.db, 'petugas_checkin'))) return { items: [] };
    const rows = await this.db.petugasCheckin.findMany({
      where: query.branchId ? { branchId: query.branchId } : {},
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    const terlihat = rows.filter((r) => this.boleh(principal, r.branchId));
    const [users, cabang] = await Promise.all([
      this.db.user.findMany({
        where: { id: { in: terlihat.map((r) => r.userId) } },
        select: { id: true, displayName: true, username: true, status: true },
      }),
      this.db.cabang.findMany({
        where: { id: { in: [...new Set(terlihat.map((r) => r.branchId))] } },
        select: { id: true, name: true },
      }),
    ]);
    const u = new Map(users.map((x) => [x.id, x]));
    const c = new Map(cabang.map((x) => [x.id, x.name]));
    return {
      items: terlihat
        .filter((r) => u.has(r.userId))
        .map((r) => ({
          userId: r.userId,
          displayName: u.get(r.userId)!.displayName,
          username: u.get(r.userId)!.username,
          branchId: r.branchId,
          branchName: c.get(r.branchId) ?? null,
          status: u.get(r.userId)!.status,
          createdAt: r.createdAt.toISOString(),
        })),
    };
  }

  async buat(
    principal: SessionPrincipal,
    input: { displayName?: unknown; username?: unknown; password?: unknown; branchId?: unknown },
  ): Promise<PetugasView> {
    this.policy.requireCapability(principal.capabilities, CAP);
    const displayName = typeof input.displayName === 'string' ? input.displayName.trim() : '';
    const username = typeof input.username === 'string' ? input.username.trim().toLowerCase() : '';
    const password = typeof input.password === 'string' ? input.password : '';
    const branchId = typeof input.branchId === 'string' ? input.branchId : '';
    if (displayName.length < 2 || displayName.length > 80) throw salah('displayName', 'LENGTH');
    if (!POLA_USERNAME.test(username)) throw salah('username', 'FORMAT');
    if (password.trim().length < 8) throw salah('password', 'TOO_SHORT');
    if (!branchId) throw salah('branchId', 'REQUIRED');
    if (!this.boleh(principal, branchId)) throw new ApiProblem('FORBIDDEN', HttpStatus.FORBIDDEN);
    await this.pastikanTabel();
    const cabang = await this.db.cabang.findUnique({ where: { id: branchId }, select: { id: true, name: true, active: true } });
    if (!cabang?.active) throw salah('branchId', 'NOT_FOUND');
    if (await this.db.user.findUnique({ where: { username }, select: { id: true } }))
      throw new ApiProblem('USERNAME_TAKEN', HttpStatus.CONFLICT, false, [{ field: 'username', issue: 'TAKEN' }]);

    const passwordHash = await hashPassword(password.trim());
    const id = newId();
    const dibuat = await this.db.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: { id, username, displayName, passwordHash, role: 'ADMIN', preferredBranchId: branchId, status: 'ACTIVE' },
      });
      const baris = await tx.petugasCheckin.create({ data: { userId: id, branchId, createdById: principal.userId || null } });
      await this.audit?.catat(tx, {
        actorId: principal.userId,
        branchId,
        action: 'checkin_staff.created',
        objectType: 'User',
        objectId: id,
        targetUserId: id,
        afterMasked: { username, branchId },
      });
      return { user, baris };
    });
    return {
      userId: id,
      displayName,
      username,
      branchId,
      branchName: cabang.name,
      status: dibuat.user.status,
      createdAt: dibuat.baris.createdAt.toISOString(),
    };
  }

  private async milikCabang(principal: SessionPrincipal, userId: string) {
    this.policy.requireCapability(principal.capabilities, CAP);
    if (!UUID.test(userId)) throw new ApiProblem('RESOURCE_NOT_FOUND', HttpStatus.NOT_FOUND);
    await this.pastikanTabel();
    const baris = await this.db.petugasCheckin.findUnique({ where: { userId } });
    if (!baris || !this.boleh(principal, baris.branchId)) throw new ApiProblem('RESOURCE_NOT_FOUND', HttpStatus.NOT_FOUND);
    return baris;
  }

  async gantiPassword(principal: SessionPrincipal, userId: string, input: { password?: unknown }) {
    const baris = await this.milikCabang(principal, userId);
    const password = typeof input.password === 'string' ? input.password : '';
    if (password.trim().length < 8) throw salah('password', 'TOO_SHORT');
    const passwordHash = await hashPassword(password.trim());
    await this.db.$transaction(async (tx) => {
      await tx.user.update({ where: { id: userId }, data: { passwordHash } });
      await tx.userSession.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date(), revocationReason: 'CHECKIN_STAFF_PASSWORD_RESET' },
      });
      await this.audit?.catat(tx, {
        actorId: principal.userId,
        branchId: baris.branchId,
        action: 'checkin_staff.password_reset',
        objectType: 'User',
        objectId: userId,
        targetUserId: userId,
      });
    });
    return { userId, status: 'PASSWORD_RESET' };
  }

  async ubahStatus(principal: SessionPrincipal, userId: string, aktif: boolean) {
    const baris = await this.milikCabang(principal, userId);
    await this.db.$transaction(async (tx) => {
      await tx.user.update({ where: { id: userId }, data: { status: aktif ? 'ACTIVE' : 'INACTIVE' } });
      if (!aktif)
        await tx.userSession.updateMany({
          where: { userId, revokedAt: null },
          data: { revokedAt: new Date(), revocationReason: 'CHECKIN_STAFF_DEACTIVATED' },
        });
      await this.audit?.catat(tx, {
        actorId: principal.userId,
        branchId: baris.branchId,
        action: aktif ? 'checkin_staff.reactivated' : 'checkin_staff.deactivated',
        objectType: 'User',
        objectId: userId,
        targetUserId: userId,
      });
    });
    return { userId, status: aktif ? 'ACTIVE' : 'INACTIVE' };
  }
}
