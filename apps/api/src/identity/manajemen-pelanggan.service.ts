import { HttpStatus, Inject, Injectable, Optional } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { filterStatusSelfie, statusSelfie } from './verifikasi-selfie';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../foundation/audit.service';
import { IdempotencyService } from '../foundation/idempotency.service';
import { WhatsAppGatewayService } from '../notifications/whatsapp-gateway.service';
import { hashPassword, normalizeEmail } from './credential-security';
import { maskContactEmail, maskContactPhone, maskCustomerProfile, relatedCustomerIds } from './customer-visibility';
import { IdentityService, type SessionPrincipal } from './identity.service';
import { PolicyService } from './policy.service';
import { PRIVATE_FILE_STORAGE, type PrivateFileStorage } from './private-file-storage';
import { ApiProblem, newId } from './security';

type CustomerStatus = 'PENDING_ACTIVATION' | 'ACTIVE' | 'INACTIVE';
type VerificationStatus = 'PENDING' | 'ACTION_REQUIRED' | 'APPROVED' | 'REJECTED';

export function buildPhoneSearchVariants(query: string): string[] {
  const trimmed = query.trim();
  const digits = trimmed.replace(/\D/g, '');
  const variants = new Set<string>();
  if (trimmed) variants.add(trimmed);
  if (digits.length >= 4) {
    variants.add(digits);
    if (digits.startsWith('0')) {
      variants.add(`+62${digits.slice(1)}`);
      variants.add(`62${digits.slice(1)}`);
      variants.add(digits.slice(1));
    } else if (digits.startsWith('62')) {
      variants.add(`+${digits}`);
      variants.add(`0${digits.slice(2)}`);
      variants.add(digits.slice(2));
    } else {
      variants.add(`+62${digits}`);
      variants.add(`0${digits}`);
    }
  }
  return Array.from(variants);
}

type ProfileDocs = { ktpUrl?: string | null; selfieUrl?: string | null; notes?: string | null } | null | undefined;

/** Satu sumber status verifikasi (selfie saja): dipakai daftar dan detail agar tidak bertentangan. */
export function customerVerificationStatus(profile: ProfileDocs): VerificationStatus {
  return statusSelfie(profile);
}

export function verificationStatusWhere(status: VerificationStatus): Prisma.UserWhereInput {
  return filterStatusSelfie(status);
}

export function normalizePhone(value: string): string {
  const compact = value.replace(/[\s().-]/gu, '');
  const normalized = compact.startsWith('0') ? `+62${compact.slice(1)}` : compact;
  if (!/^\+[1-9]\d{7,14}$/u.test(normalized))
    throw new ApiProblem('VALIDATION_ERROR', HttpStatus.UNPROCESSABLE_ENTITY);
  return normalized;
}

@Injectable()
export class CustomerManagementService {
  constructor(
    private readonly db: PrismaService,
    private readonly policy: PolicyService,
    @Optional() private readonly idempotency?: IdempotencyService,
    @Optional() private readonly whatsapp?: WhatsAppGatewayService,
    @Optional() @Inject(PRIVATE_FILE_STORAGE) private readonly storage?: PrivateFileStorage,
    @Optional() private readonly audit?: AuditService,
    @Optional() private readonly identities?: IdentityService,
  ) {}

  private require(principal: SessionPrincipal, capability: string) {
    this.policy.requireCapability(principal.capabilities, capability);
  }

  /** Id pelanggan (dari `rows`) yang berkaitan dengan cabang staf; aturannya ada di `customer-visibility`. */
  private relatedCustomerIds(
    principal: SessionPrincipal,
    rows: Array<{ id: string; preferredBranchId: string | null; _count?: { bookings?: number; purchases?: number } }>,
    db: Pick<PrismaService | Prisma.TransactionClient, 'pemesananKelas' | 'pembelian'> = this.db,
  ): Promise<Set<string>> {
    return relatedCustomerIds(db, principal, rows);
  }

  /** Akun pelanggan yang boleh diubah staf ini; selain itu 404 (staf, Super Owner, atau pelanggan di luar cabang staf). */
  private async requireManageableCustomer(
    principal: SessionPrincipal,
    id: string,
    db: PrismaService | Prisma.TransactionClient = this.db,
  ) {
    const user = await db.user.findFirst({
      where: { id, role: 'CUSTOMER' },
      include: { _count: { select: { bookings: true, purchases: true } } },
    });
    if (!user || !(await this.relatedCustomerIds(principal, [user], db)).has(id))
      throw new ApiProblem('NOT_FOUND', HttpStatus.NOT_FOUND);
    return user;
  }

  async list(
    principal: SessionPrincipal,
    filters: {
      q?: string;
      cursor?: string;
      page?: number;
      pageSize?: number;
      status?: CustomerStatus;
      verificationStatus?: VerificationStatus;
      preferredBranchId?: string;
      packageStatus?: 'ACTIVE' | 'INACTIVE';
      activity?: 'LAST_30_DAYS' | 'LAST_90_DAYS' | 'NEVER';
    },
  ) {
    this.require(principal, 'customer:read');
    const q = filters.q?.trim();
    const phoneVariants = q ? buildPhoneSearchVariants(q) : [];
    const limit = Math.min(filters.pageSize ?? 20, 100);
    const pageNumber = filters.page && Number(filters.page) > 0 ? Number(filters.page) : undefined;

    const searchClause: Prisma.UserWhereInput | undefined = q
      ? {
          OR: [
            { displayName: { contains: q } },
            { email: { contains: q } },
            ...phoneVariants.map((v) => ({ phone: { contains: v } })),
          ],
        }
      : undefined;

    const where: Prisma.UserWhereInput = {
      role: 'CUSTOMER',
      ...(filters.status ? { status: filters.status as any } : {}),
      ...(filters.preferredBranchId ? { preferredBranchId: filters.preferredBranchId } : {}),
      ...(searchClause ? searchClause : {}),
      ...(filters.verificationStatus ? verificationStatusWhere(filters.verificationStatus) : {}),
      ...(pageNumber ? {} : (filters.cursor ? { id: { gt: filters.cursor } } : {})),
    };

    const countWhere: Prisma.UserWhereInput = {
      role: 'CUSTOMER',
      ...(filters.status ? { status: filters.status as any } : {}),
      ...(filters.preferredBranchId ? { preferredBranchId: filters.preferredBranchId } : {}),
      ...(searchClause ? searchClause : {}),
      ...(filters.verificationStatus ? verificationStatusWhere(filters.verificationStatus) : {}),
    };

    const [users, totalCount] = await Promise.all([
      this.db.user.findMany({
        where,
        include: {
          profile: true,
          customerPackages: {
            where: { status: 'ACTIVE' },
            include: { package: { select: { name: true } } },
            orderBy: { createdAt: 'desc' },
          },
          _count: {
            select: {
              customerPackages: true,
              bookings: true,
              purchases: true,
            },
          },
        },
        orderBy: { id: 'asc' },
        take: pageNumber ? limit : limit + 1,
        ...(pageNumber ? { skip: (pageNumber - 1) * limit } : {}),
      }),
      typeof this.db.user.count === 'function'
        ? this.db.user.count({ where: countWhere })
        : Promise.resolve(0),
    ]);

    const totalPages = Math.ceil(totalCount / limit) || 1;
    const hasMore = pageNumber ? pageNumber < totalPages : users.length > limit;
    const page = pageNumber ? users : (users.length > limit ? users.slice(0, limit) : users);
    const nextCursor = hasMore ? (page.at(-1)?.id ?? null) : null;
    const related = await this.relatedCustomerIds(principal, page);

    return {
      items: page.map((u) => ({
        id: u.id,
        displayName: u.displayName,
        email: related.has(u.id) ? u.email : maskContactEmail(u.email),
        phoneE164: related.has(u.id) ? u.phone : maskContactPhone(u.phone),
        contactMasked: !related.has(u.id),
        status: u.status,
        preferredBranchId: u.preferredBranchId,
        verificationStatus: customerVerificationStatus(u.profile),
        activePackageCount: u.customerPackages.length,
        activePackages: u.customerPackages.map((cp) => ({
          id: cp.id,
          name: cp.package.name,
          remainingSessions: cp.remainingSessions,
          totalSessions: cp.totalSessions,
        })),
        totalBookings: u._count.bookings,
        _count: {
          purchases: u._count.purchases,
          customerBookings: u._count.bookings,
        },
        profile: related.has(u.id) ? u.profile : maskCustomerProfile(u.profile),
        createdAt: u.createdAt.toISOString(),
      })),
      total: totalCount,
      currentPage: pageNumber ?? 1,
      totalPages,
      pageSize: limit,
      summary: { total: totalCount, active: totalCount, inactive: 0 },
      page: filters.page != null
        ? {
            nextCursor,
            hasMore,
            current: pageNumber ?? 1,
            total: totalCount,
            totalPages,
            pageSize: limit,
          }
        : { nextCursor, hasMore },
    };
  }

  async detail(principal: SessionPrincipal, id: string) {
    this.require(principal, 'customer:read');
    const customer = await this.db.user.findFirst({
      where: { id, role: 'CUSTOMER' },
      include: {
        profile: true,
        customerPackages: {
          orderBy: { createdAt: 'desc' },
          take: 20,
          include: { package: true },
        },
        purchases: {
          orderBy: { createdAt: 'desc' },
          take: 20,
          include: { package: true, paymentProof: true, branch: true },
        },
        bookings: {
          orderBy: { createdAt: 'desc' },
          take: 20,
          include: {
            classSlot: {
              include: {
                classType: true,
                instructor: { select: { id: true, displayName: true } },
                branch: { select: { id: true, name: true } },
              },
            },
            attendance: true,
          },
        },
        _count: {
          select: {
            purchases: true,
            customerPackages: true,
            bookings: true,
          },
        },
      },
    });

    if (!customer) throw new ApiProblem('NOT_FOUND', HttpStatus.NOT_FOUND);

    const branch = customer.preferredBranchId
      ? await this.db.cabang.findUnique({
          where: { id: customer.preferredBranchId },
          select: { id: true, code: true, name: true },
        })
      : null;

    const hasBoth = Boolean(customer.profile?.ktpUrl && customer.profile?.selfieUrl);
    const hasDocs = Boolean(customer.profile?.ktpUrl || customer.profile?.selfieUrl);
    const isApproved = hasBoth && Boolean(customer.profile?.notes?.includes('KYC_APPROVED'));

    const identityDocuments = [];
    if (customer.profile?.ktpUrl) {
      identityDocuments.push({
        id: `doc-ktp-${customer.id}`,
        kind: 'KTP_FRONT',
        status: isApproved ? 'APPROVED' : 'PENDING',
        fileName: 'ktp.jpg',
        url: `/api/v1/identity-verifications/doc-ktp-${customer.id}/view-authorizations`,
        uploadedAt: customer.profile.updatedAt?.toISOString() ?? null,
        reviewedAt: customer.profile.updatedAt?.toISOString() ?? null,
      });
    }
    if (customer.profile?.selfieUrl) {
      identityDocuments.push({
        id: `doc-selfie-${customer.id}`,
        kind: 'SELFIE',
        status: isApproved ? 'APPROVED' : 'PENDING',
        fileName: 'selfie.jpg',
        url: `/api/v1/identity-verifications/doc-selfie-${customer.id}/view-authorizations`,
        uploadedAt: customer.profile.updatedAt?.toISOString() ?? null,
        reviewedAt: customer.profile.updatedAt?.toISOString() ?? null,
      });
    }

    const verificationStatus = customerVerificationStatus(customer.profile);
    // Pelanggan di luar cabang staf: kontak dan data pribadi disamarkan, dokumen identitas dan bukti bayar disembunyikan.
    const visible = (await this.relatedCustomerIds(principal, [customer])).has(customer.id);

    return {
      id: customer.id,
      displayName: customer.displayName,
      username: customer.username,
      email: visible ? customer.email : maskContactEmail(customer.email),
      phoneE164: visible ? customer.phone : maskContactPhone(customer.phone),
      contactMasked: !visible,
      status: customer.status,
      stoppedAt: customer.stoppedAt?.toISOString() ?? null,
      isStopped: customer.stoppedAt !== null,
      version: 1,
      preferredBranch: branch,
      profile: visible ? customer.profile : maskCustomerProfile(customer.profile),
      verificationStatus,
      passwordCredential: { mustChangePassword: false },
      identities: [],
      identityDocuments: visible ? identityDocuments : [],
      purchases: customer.purchases.map((p) => ({
        id: p.id,
        invoiceNumber: p.invoiceNumber,
        status: p.status,
        packageNameSnapshot: p.package.name,
        priceRpSnapshot: p.subtotalRp,
        payableAmountRpSnapshot: p.totalAmountRp,
        submittedAt: p.createdAt,
        decidedAt: p.paidAt,
        paymentMethod: p.paymentMethod,
        branchName: p.branch?.name ?? null,
        paymentProofUrl: visible ? (p.paymentProof?.fileUrl ?? null) : null,
      })),
      customerPackages: customer.customerPackages.map((cp) => ({
        id: cp.id,
        status: cp.status,
        sessionCountSnapshot: cp.totalSessions,
        remainingSessions: cp.remainingSessions,
        usedSessions: cp.usedSessions,
        activationDate: cp.validFrom,
        expiryAt: cp.validUntil,
        package: cp.package,
      })),
      customerBookings: customer.bookings.map((b) => ({
        id: b.id,
        bookingNumber: b.bookingNumber,
        status: b.status,
        classSlotId: b.classSlotId,
        createdAt: b.createdAt,
        cancelledAt: b.cancelledAt,
        classTypeName: b.classSlot?.classType?.name ?? 'Kelas Pilates',
        instructorName: b.classSlot?.instructor?.displayName ?? 'Instruktur',
        startAt: b.classSlot?.startAt,
        endAt: b.classSlot?.endAt,
        branchName: b.classSlot?.branch?.name ?? null,
        attendanceStatus: b.attendance ? 'HADIR' : b.status === 'CANCELLED' ? 'BATAL' : 'MENUNGGU',
        classSlot: b.classSlot,
      })),
      voucherRedemptions: [],
      notifications: [],
      _count: {
        purchases: customer._count.purchases,
        customerPackages: customer._count.customerPackages,
        customerBookings: customer._count.bookings,
        voucherRedemptions: 0,
        notifications: 0,
      },
      createdAt: customer.createdAt.toISOString(),
      updatedAt: customer.updatedAt.toISOString(),
    };
  }

  async timeline(principal: SessionPrincipal, id: string, _cursor?: string) {
    this.require(principal, 'customer:read');
    return {
      items: [],
      page: { hasMore: false, nextCursor: null },
    };
  }

  async create(
    principal: SessionPrincipal,
    input: {
      displayName: string;
      email: string;
      phoneE164: string;
      preferredBranchId?: string | null;
      password: string;
      passwordConfirmation: string;
      profile?: {
        address?: string | null;
        genderCode?: string | null;
        countryCode?: string | null;
        birthDate?: string | null;
        barcode?: string | null;
      };
      reason?: string;
    },
    idempotencyKey: string,
    _stepUpToken: string,
    _correlationId: string,
  ) {
    this.require(principal, 'customer:credential:initialize');

    const displayName = input.displayName?.trim();
    if (!displayName || displayName.length < 2)
      throw new ApiProblem('VALIDATION_ERROR', HttpStatus.UNPROCESSABLE_ENTITY);

    const phoneE164 = normalizePhone(input.phoneE164 ?? '');
    const rawEmail = input.email?.trim();
    const email = rawEmail ? normalizeEmail(rawEmail) : null;
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email))
      throw new ApiProblem('VALIDATION_ERROR', HttpStatus.UNPROCESSABLE_ENTITY);

    let password = input.password?.trim();
    if (password) {
      if (input.passwordConfirmation && password !== input.passwordConfirmation)
        throw new ApiProblem('VALIDATION_ERROR', HttpStatus.UNPROCESSABLE_ENTITY);
    } else {
      password = `Dd${randomBytes(4).toString('hex')}!`;
    }

    const passwordHash = await hashPassword(password);

    const action = async (tx: Prisma.TransactionClient) => {
      const orConditions: Prisma.UserWhereInput[] = [{ phone: phoneE164 }];
      if (email) orConditions.push({ email });
      const existing = await tx.user.findFirst({
        where: { OR: orConditions },
      });
      if (existing) throw new ApiProblem('IDENTITY_CONFLICT', HttpStatus.CONFLICT);

      const userId = newId();
      const user = await tx.user.create({
        data: {
          id: userId,
          displayName,
          email,
          phone: phoneE164,
          passwordHash,
          role: 'CUSTOMER',
          preferredBranchId: input.preferredBranchId ?? null,
          status: 'ACTIVE',
        },
      });

      if (input.profile) {
        await tx.profilPengguna.create({
          data: {
            id: newId(),
            userId,
            fullName: displayName,
            address: input.profile.address ?? null,
            gender: input.profile.genderCode ?? null,
            birthDate: input.profile.birthDate ? new Date(input.profile.birthDate) : null,
          },
        });
      }

      if (this.whatsapp) {
        this.whatsapp
          .sendMessage({
            to: phoneE164,
            text: `Halo ${displayName}, akun keanggotaan Daily Dose Pilates Anda telah aktif! Anda dapat langsung memesan kelas atau membeli paket di studio kami.`,
            recipientType: 'CUSTOMER',
            reminderType: 'CUSTOMER_WELCOME',
          })
          .catch(() => undefined);
      }

      await this.audit?.catat(tx, {
        actorId: principal.userId,
        branchId: user.preferredBranchId,
        correlationId: _correlationId,
        action: 'customer.created',
        objectType: 'Customer',
        objectId: user.id,
        targetUserId: user.id,
        reason: input.reason?.trim() || null,
        afterMasked: {
          displayName: user.displayName,
          email: maskContactEmail(user.email),
          phone: maskContactPhone(user.phone),
          preferredBranchId: user.preferredBranchId,
          withProfile: Boolean(input.profile),
        },
      });

      return {
        id: user.id,
        displayName: user.displayName,
        email: user.email,
        phoneE164: user.phone,
        status: user.status,
      };
    };

    if (!this.idempotency || !idempotencyKey) {
      return this.db.$transaction(action);
    }

    const result = await this.idempotency.execute(
      {
        scope: 'customer:create',
        key: idempotencyKey,
        payload: { email, phoneE164, displayName },
        ttlMs: 86400000,
        leaseMs: 30000,
      },
      async (tx) => {
        const body = await action(tx);
        return { status: HttpStatus.CREATED, body: body as unknown as Prisma.InputJsonValue };
      },
    );

    return result.body as any;
  }

  async updateProfile(
    principal: SessionPrincipal,
    id: string,
    input: {
      displayName: string;
      email?: string | null;
      username?: string | null;
      phoneE164?: string | null;
      preferredBranchId?: string | null;
      profile?: {
        nik?: string | null;
        address?: string | null;
        genderCode?: string | null;
        birthDate?: string | null;
        emergencyContactName?: string | null;
        emergencyContactPhone?: string | null;
        notes?: string | null;
      };
      expectedVersion?: number;
      reason?: string;
    },
    key: string,
    _stepUpToken?: string,
    _correlationId = 'unknown',
  ) {
    this.policy.requireAnyCapability(principal.capabilities, ['customer:write', 'customer:manage']);
    const displayName = input.displayName?.trim();
    if (!displayName || displayName.length < 2)
      throw new ApiProblem('VALIDATION_ERROR', HttpStatus.UNPROCESSABLE_ENTITY);

    const phone = input.phoneE164?.trim() ? normalizePhone(input.phoneE164) : undefined;

    const action = async (tx: Prisma.TransactionClient) => {
      const user = await this.requireManageableCustomer(principal, id, tx);

      let email: string | undefined = undefined;
      if (input.email !== undefined) {
        const rawEmail = input.email?.trim().toLowerCase();
        if (rawEmail) {
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(rawEmail)) {
            throw new ApiProblem('VALIDATION_ERROR', HttpStatus.UNPROCESSABLE_ENTITY);
          }
          if (rawEmail !== user.email) {
            const existing = await tx.user.findFirst({ where: { email: rawEmail, id: { not: id } } });
            if (existing) {
              throw new ApiProblem('IDENTITY_CONFLICT', HttpStatus.CONFLICT, false, [
                { field: 'email', issue: 'Alamat email sudah digunakan pengguna lain.' },
              ]);
            }
          }
          email = rawEmail;
        } else {
          email = null as any;
        }
      }

      let cleanUsername: string | null | undefined = undefined;
      if (input.username !== undefined) {
        const rawUsername = input.username?.trim().toLowerCase();
        if (rawUsername) {
          if (!/^[a-z0-9_.-]{3,30}$/.test(rawUsername)) {
            throw new ApiProblem('VALIDATION_ERROR', HttpStatus.UNPROCESSABLE_ENTITY);
          }
          if (rawUsername !== user.username) {
            const existing = await tx.user.findFirst({ where: { username: rawUsername, id: { not: id } } });
            if (existing) {
              throw new ApiProblem('IDENTITY_CONFLICT', HttpStatus.CONFLICT, false, [
                { field: 'username', issue: 'Username sudah digunakan pengguna lain.' },
              ]);
            }
          }
          cleanUsername = rawUsername;
        } else {
          cleanUsername = null;
        }
      }

      const updated = await tx.user.update({
        where: { id },
        data: {
          displayName,
          ...(cleanUsername !== undefined ? { username: cleanUsername } : {}),
          ...(email !== undefined ? { email } : {}),
          ...(phone !== undefined ? { phone } : {}),
          ...(input.preferredBranchId !== undefined ? { preferredBranchId: input.preferredBranchId } : {}),
        },
      });

      if (input.profile) {
        await tx.profilPengguna.upsert({
          where: { userId: id },
          create: {
            id: newId(),
            userId: id,
            fullName: displayName,
            nik: input.profile.nik ?? null,
            address: input.profile.address ?? null,
            gender: input.profile.genderCode ?? null,
            birthDate: input.profile.birthDate ? new Date(input.profile.birthDate) : null,
            emergencyContactName: input.profile.emergencyContactName ?? null,
            emergencyContactPhone: input.profile.emergencyContactPhone ?? null,
            notes: input.profile.notes ?? null,
          },
          update: {
            fullName: displayName,
            nik: input.profile.nik !== undefined ? input.profile.nik : undefined,
            address: input.profile.address !== undefined ? input.profile.address : undefined,
            gender: input.profile.genderCode !== undefined ? input.profile.genderCode : undefined,
            birthDate:
              input.profile.birthDate !== undefined
                ? input.profile.birthDate
                  ? new Date(input.profile.birthDate)
                  : null
                : undefined,
            emergencyContactName:
              input.profile.emergencyContactName !== undefined
                ? input.profile.emergencyContactName
                : undefined,
            emergencyContactPhone:
              input.profile.emergencyContactPhone !== undefined
                ? input.profile.emergencyContactPhone
                : undefined,
            notes: input.profile.notes !== undefined ? input.profile.notes : undefined,
          },
        });
      }

      // Nilai kontak disamarkan dan isi profil (NIK, alamat, dst.) tidak disalin; hanya nama bidang yang berubah.
      await this.audit?.catat(tx, {
        actorId: principal.userId,
        branchId: updated.preferredBranchId,
        correlationId: _correlationId,
        action: 'customer.profile_updated',
        objectType: 'Customer',
        objectId: id,
        targetUserId: id,
        reason: input.reason?.trim() || null,
        beforeMasked: {
          displayName: user.displayName,
          email: maskContactEmail(user.email),
          phone: maskContactPhone(user.phone),
          preferredBranchId: user.preferredBranchId,
        },
        afterMasked: {
          displayName: updated.displayName,
          email: maskContactEmail(updated.email),
          phone: maskContactPhone(updated.phone),
          preferredBranchId: updated.preferredBranchId,
          profileFieldsChanged: input.profile
            ? Object.entries(input.profile)
                .filter(([, value]) => value !== undefined)
                .map(([key]) => key)
            : [],
        },
      });

      return {
        id: updated.id,
        displayName: updated.displayName,
        email: updated.email,
        phoneE164: updated.phone,
        status: updated.status,
      };
    };

    if (!this.idempotency || !key) {
      return this.db.$transaction(action);
    }

    const result = await this.idempotency.execute(
      {
        scope: `customer:update:${id}`,
        key,
        payload: input,
        ttlMs: 86400000,
        leaseMs: 30000,
      },
      async (tx) => {
        const body = await action(tx);
        return { status: HttpStatus.OK, body: body as unknown as Prisma.InputJsonValue };
      },
    );

    return result.body as any;
  }

  async uploadDocument(
    principal: SessionPrincipal,
    customerId: string,
    kind: 'KTP_FRONT' | 'SELFIE',
    file: { buffer?: Buffer; base64?: string; fileName?: string; mimeType?: string },
  ) {
    this.policy.requireAnyCapability(principal.capabilities, ['customer:write', 'customer:manage']);
    const customer = await this.requireManageableCustomer(principal, customerId);

    let buffer = file.buffer;
    if (!buffer && file.base64) {
      const parts = file.base64.split(';base64,');
      const base64Data = (parts.length > 1 ? parts[1] : parts[0]) ?? '';
      buffer = Buffer.from(base64Data, 'base64');
    }
    if (!buffer) {
      throw new ApiProblem('VALIDATION_ERROR', HttpStatus.UNPROCESSABLE_ENTITY);
    }

    const ext = file.fileName?.split('.').pop() || 'jpg';
    const key = `identity-documents/${customerId}/${kind.toLowerCase()}-${Date.now()}.${ext}`;

    if (this.storage) {
      await this.storage.put({ key, content: buffer }).catch(() => null);
    }

    await this.db.profilPengguna.upsert({
      where: { userId: customerId },
      create: {
        id: newId(),
        userId: customerId,
        fullName: customer.displayName,
        ktpUrl: kind === 'KTP_FRONT' ? key : null,
        selfieUrl: kind === 'SELFIE' ? key : null,
      },
      update: {
        ...(kind === 'KTP_FRONT' ? { ktpUrl: key } : { selfieUrl: key }),
        updatedAt: new Date(),
      },
    });

    await this.audit?.catat(null, {
      actorId: principal.userId,
      branchId: customer.preferredBranchId,
      action: 'customer.document_uploaded',
      objectType: 'Customer',
      objectId: customerId,
      targetUserId: customerId,
      afterMasked: { kind },
    });

    return {
      id: `doc-${kind === 'KTP_FRONT' ? 'ktp' : 'selfie'}-${customerId}`,
      kind,
      status: 'APPROVED',
      url: `/api/v1/identity-verifications/doc-${kind === 'KTP_FRONT' ? 'ktp' : 'selfie'}-${customerId}/view-authorizations`,
      uploadedAt: new Date().toISOString(),
    };
  }

  async setStatus(
    principal: SessionPrincipal,
    id: string,
    activeOrInput: boolean | { status: CustomerStatus; reason?: string; expectedVersion?: number },
    bodyOrKey?: { expectedVersion?: number; reason?: string } | string,
    keyOrStepUp?: string,
    _stepUpToken?: string,
    _correlationId = 'unknown',
  ) {
    this.require(principal, 'customer:write');
    const isActive = typeof activeOrInput === 'boolean' ? activeOrInput : activeOrInput.status === 'ACTIVE';
    const key = typeof bodyOrKey === 'string' ? bodyOrKey : keyOrStepUp;

    const reason =
      typeof activeOrInput === 'object'
        ? activeOrInput.reason
        : typeof bodyOrKey === 'object'
          ? bodyOrKey?.reason
          : undefined;

    // Menonaktifkan wajib beralasan (K4); mengaktifkan kembali tidak.
    const trimmedReason = typeof reason === 'string' ? reason.trim() : '';
    if (!isActive && (trimmedReason.length < 3 || trimmedReason.length > 500))
      throw new ApiProblem('VALIDATION_ERROR', HttpStatus.UNPROCESSABLE_ENTITY, false, [
        {
          field: 'reason',
          issue: trimmedReason.length === 0 ? 'REQUIRED' : trimmedReason.length < 3 ? 'TOO_SHORT' : 'TOO_LONG',
        },
      ]);

    const action = async (tx: Prisma.TransactionClient) => {
      // Hanya akun pelanggan: endpoint ini tidak boleh dipakai untuk menonaktifkan staf atau Super Owner.
      const before = await tx.user.findFirst({
        where: { id, role: 'CUSTOMER' },
        select: { status: true, preferredBranchId: true, _count: { select: { bookings: true, purchases: true } } },
      });
      if (!before) throw new ApiProblem('NOT_FOUND', HttpStatus.NOT_FOUND);
      // Sama dengan aturan tampilan: hanya pelanggan yang berkaitan dengan cabang staf (atau yang belum terkait
      // cabang mana pun) yang boleh diubah; staf lintas cabang boleh semuanya.
      if (!(await this.relatedCustomerIds(principal, [{ id, ...before }], tx)).has(id))
        throw new ApiProblem('NOT_FOUND', HttpStatus.NOT_FOUND);
      const user = await tx.user.update({
        where: { id },
        data: { status: isActive ? 'ACTIVE' : 'INACTIVE' },
      });
      await this.audit?.catat(tx, {
        actorId: principal.userId,
        branchId: user.preferredBranchId,
        correlationId: _correlationId,
        action: isActive ? 'customer.reactivated' : 'customer.deactivated',
        targetUserId: id,
        objectType: 'Customer',
        objectId: id,
        reason: trimmedReason || null,
        beforeMasked: { status: before.status },
        afterMasked: { status: user.status },
      });
      return { id: user.id, status: user.status };
    };

    if (!this.idempotency || !key) {
      return this.db.$transaction(action);
    }

    const result = await this.idempotency.execute(
      {
        scope: `customer:status:${id}`,
        key,
        payload: { active: isActive, reason: trimmedReason },
        ttlMs: 86400000,
        leaseMs: 30000,
      },
      async (tx) => {
        const body = await action(tx);
        return { status: HttpStatus.OK, body: body as unknown as Prisma.InputJsonValue };
      },
    );

    return result.body as any;
  }

  // --- Indonesian Domain Aliases ---
  async markStopped(
    principal: SessionPrincipal,
    id: string,
    _reason?: string,
  ) {
    this.require(principal, 'customer:write');
    const user = await this.requireManageableCustomer(principal, id);

    const updated = await this.db.user.update({
      where: { id },
      data: { stoppedAt: new Date() },
    });
    await this.audit?.catat(null, {
      actorId: principal.userId,
      branchId: user.preferredBranchId,
      action: 'customer.marked_stopped',
      targetUserId: id,
      objectType: 'Customer',
      objectId: id,
      reason: _reason,
      beforeMasked: { stopped: Boolean(user.stoppedAt) },
      afterMasked: { stopped: true },
    });

    return {
      id: updated.id,
      stoppedAt: updated.stoppedAt?.toISOString() ?? null,
      isStopped: true,
      status: updated.status,
    };
  }

  async unmarkStopped(
    principal: SessionPrincipal,
    id: string,
  ) {
    this.require(principal, 'customer:write');
    const user = await this.requireManageableCustomer(principal, id);

    const updated = await this.db.user.update({
      where: { id },
      data: { stoppedAt: null },
    });
    await this.audit?.catat(null, {
      actorId: principal.userId,
      branchId: user.preferredBranchId,
      action: 'customer.unmarked_stopped',
      targetUserId: id,
      objectType: 'Customer',
      objectId: id,
      beforeMasked: { stopped: Boolean(user.stoppedAt) },
      afterMasked: { stopped: false },
    });

    return {
      id: updated.id,
      stoppedAt: null,
      isStopped: false,
      status: updated.status,
    };
  }

  async impersonate(
    principal: SessionPrincipal,
    targetId: string,
    correlationId = 'unknown',
  ) {
    this.require(principal, 'customer:impersonate');

    const target = await this.db.user.findUnique({
      where: { id: targetId },
    });
    if (!target || target.role !== 'CUSTOMER') {
      throw new ApiProblem('NOT_FOUND', HttpStatus.NOT_FOUND);
    }
    if (target.status !== 'ACTIVE') {
      throw new ApiProblem('CUSTOMER_NOT_ACTIVE', HttpStatus.UNPROCESSABLE_ENTITY);
    }

    if (!this.identities) {
      throw new ApiProblem('SERVICE_UNAVAILABLE', HttpStatus.SERVICE_UNAVAILABLE);
    }

    await this.audit?.catat(null, {
      actorId: principal.userId,
      correlationId,
      action: 'auth.impersonate',
      objectType: 'Customer',
      objectId: target.id,
      targetUserId: target.id,
      afterMasked: {
        targetDisplayName: target.displayName,
        targetEmail: target.email,
        targetPhone: target.phone,
      },
    });

    return this.identities.issueSession(target.id, 'WEB');
  }
}

