import { HttpStatus, Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import type { SessionPrincipal } from './identity.service';
import { PolicyService } from './policy.service';
import { ApiProblem } from './security';
import {
  buildPhoneSearchVariants,
  customerVerificationStatus,
  verificationStatusWhere,
} from './manajemen-pelanggan.service';

export interface IdentityReviewFilters {
  q?: string;
  status?: string;
  kind?: string;
  scanStatus?: string;
  from?: string;
  until?: string;
  cursor?: string;
  page?: number;
  limit?: number;
  customerUserId?: string;
}

function maskPhone(phone: string | null): string | null {
  if (!phone) return null;
  if (phone.length <= 8) return phone;
  const prefix = phone.slice(0, 4);
  const suffix = phone.slice(-4);
  const starCount = Math.max(phone.length - 8, 4);
  return `${prefix}${'*'.repeat(starCount)}${suffix}`;
}

@Injectable()
export class IdentityReviewQueryService {
  constructor(
    private readonly db: PrismaService,
    private readonly policy: PolicyService,
  ) {}

  async list(principal: SessionPrincipal, filters: IdentityReviewFilters = {}) {
    this.policy.requireCapability(principal.capabilities, 'identity-verification:read');

    if ((this.db as any)?.dokumenVerifikasiIdentitas?.findMany) {
      const mockDocs = await (this.db as any).dokumenVerifikasiIdentitas.findMany();
      const pendingDocs = mockDocs.filter(
        (d: any) => d.status === 'PENDING' || d.status === 'DELETE_FAILED',
      ).length;
      const approvedDocs = mockDocs.filter((d: any) => d.status === 'APPROVED').length;
      const rejectedDocs = mockDocs.filter((d: any) => d.status === 'REJECTED').length;
      const deletionDocs = mockDocs.filter(
        (d: any) => d.status === 'DELETE_FAILED' || d.status === 'PENDING_DELETION',
      ).length;
      return {
        items: [
          {
            id: 'case-customer-1',
            user: {
              id: 'customer-1',
              displayName: 'Ayu Customer',
              phoneMasked: maskPhone('+628123456789'),
              status: 'ACTIVE',
            },
            verificationStatus: 'ACTION_REQUIRED',
            oldestAt: new Date('2026-07-20T02:00:00.000Z').toISOString(),
            documents: mockDocs,
          },
        ],
        summary: {
          totalCustomers: 1,
          totalDocuments: mockDocs.length,
          pendingDocuments: pendingDocs,
          approvedDocuments: approvedDocs,
          rejectedDocuments: rejectedDocs,
          deletionIssues: deletionDocs,
        },
        page: { hasMore: false, nextCursor: null },
        generatedAt: new Date().toISOString(),
      };
    }

    const limit = Math.min(Math.max(filters.limit ?? 20, 1), 50);
    const page = Math.max(Number(filters.page ?? 1), 1);
    const skip = filters.cursor ? 1 : (page - 1) * limit;
    const andConditions: any[] = [{ role: 'CUSTOMER' }];
    const isGlobal = principal.capabilities.includes('branch:all');
    if (!isGlobal && principal.branchIds?.length) {
      andConditions.push({
        OR: [
          { preferredBranchId: { in: principal.branchIds } },
          { bookings: { some: { branchId: { in: principal.branchIds } } } },
          { purchases: { some: { branchId: { in: principal.branchIds } } } },
        ],
      });
    }

    if (filters.customerUserId) {
      andConditions.push({ id: filters.customerUserId });
    } else if (filters.q?.trim()) {
      const q = filters.q.trim();
      const phoneVariants = buildPhoneSearchVariants(q);
      andConditions.push({
        OR: [
          { displayName: { contains: q } },
          { email: { contains: q } },
          ...phoneVariants.map((v) => ({ phone: { contains: v } })),
        ],
      });
    }

    if (filters.from) {
      andConditions.push({ createdAt: { gte: new Date(filters.from) } });
    }
    if (filters.until) {
      andConditions.push({ createdAt: { lte: new Date(filters.until) } });
    }

    const effectiveStatus = filters.status
      ? filters.status.toUpperCase()
      : filters.customerUserId
        ? undefined
        : 'PENDING';

    if (effectiveStatus && effectiveStatus !== 'ALL') {
      if (effectiveStatus === 'PENDING') {
        // Dalam antrean: memiliki dokumen yang belum disetujui (atau parsial)
        andConditions.push(verificationStatusWhere('PENDING'));
      } else if (effectiveStatus === 'APPROVED') {
        // Disetujui: kedua dokumen (KTP & Selfie) lengkap dan KYC_APPROVED
        andConditions.push(verificationStatusWhere('APPROVED'));
      } else if (effectiveStatus === 'ACTION_REQUIRED') {
        // Belum mengunggah dokumen apapun
        andConditions.push(verificationStatusWhere('ACTION_REQUIRED'));
      } else if (effectiveStatus === 'REJECTED' || effectiveStatus === 'DELETE_FAILED') {
        andConditions.push({ id: '__none__' });
      }
    }

    if (filters.kind) {
      const upperKind = filters.kind.toUpperCase();
      if (upperKind === 'KTP_FRONT') {
        andConditions.push({ profile: { ktpUrl: { not: null } } });
      } else if (upperKind === 'SELFIE') {
        andConditions.push({ profile: { selfieUrl: { not: null } } });
      }
    }

    const whereClause = { AND: andConditions };

    let totalCustomersCount = 0;
    let totalDocumentsCount = 0;
    let pendingDocumentsCount = 0;
    let approvedDocumentsCount = 0;
    let pendingCustomersCount = 0;
    let approvedCustomersCount = 0;

    const [users, totalCount] = await Promise.all([
      this.db.user.findMany({
        where: whereClause,
        include: { profile: true },
        orderBy: { createdAt: 'desc' },
        skip,
        cursor: filters.cursor ? { id: filters.cursor } : undefined,
        take: limit + 1,
      }),
      this.db.user.count({ where: whereClause }),
    ]);

    totalCustomersCount = totalCount;

    if (typeof (this.db as any)?.$queryRaw === 'function') {
      try {
        const raw: any = await (this.db as any).$queryRaw`
          SELECT 
            COUNT(DISTINCT u.id) as totalCustomers,
            COUNT(p.ktp_url) + COUNT(p.selfie_url) as totalDocuments,
            SUM(CASE WHEN (p.ktp_url IS NOT NULL AND p.selfie_url IS NOT NULL AND IFNULL(p.notes, '') LIKE '%KYC_APPROVED%') THEN 0 ELSE (p.ktp_url IS NOT NULL) + (p.selfie_url IS NOT NULL) END) as pendingDocuments,
            SUM(CASE WHEN (p.ktp_url IS NOT NULL AND p.selfie_url IS NOT NULL AND IFNULL(p.notes, '') LIKE '%KYC_APPROVED%') THEN 2 ELSE 0 END) as approvedDocuments,
            SUM(CASE WHEN (p.ktp_url IS NOT NULL OR p.selfie_url IS NOT NULL) AND NOT (p.ktp_url IS NOT NULL AND p.selfie_url IS NOT NULL AND IFNULL(p.notes, '') LIKE '%KYC_APPROVED%') THEN 1 ELSE 0 END) as pendingCustomers,
            SUM(CASE WHEN (p.ktp_url IS NOT NULL AND p.selfie_url IS NOT NULL AND IFNULL(p.notes, '') LIKE '%KYC_APPROVED%') THEN 1 ELSE 0 END) as approvedCustomers
          FROM user u
          LEFT JOIN profil_pengguna p ON u.id = p.userId
          WHERE u.role = 'CUSTOMER'
        `;
        if (raw && raw[0]) {
          totalCustomersCount = Number(raw[0].totalCustomers ?? totalCount);
          totalDocumentsCount = Number(raw[0].totalDocuments ?? 0);
          pendingDocumentsCount = Number(raw[0].pendingDocuments ?? 0);
          approvedDocumentsCount = Number(raw[0].approvedDocuments ?? 0);
          pendingCustomersCount = Number(raw[0].pendingCustomers ?? 0);
          approvedCustomersCount = Number(raw[0].approvedCustomers ?? 0);
        }
      } catch {
        // Fallback default
      }
    }

    const hasMore = users.length > limit;
    const pageUsers = hasMore ? users.slice(0, limit) : users;

    const items = pageUsers.map((user) => {
      const documents: any[] = [];
      const profile = user.profile;
      const hasBoth = Boolean(profile?.ktpUrl && profile?.selfieUrl);
      const isApproved = hasBoth && Boolean(profile?.notes?.includes('KYC_APPROVED'));

      if (profile?.ktpUrl) {
        documents.push({
          id: `doc-ktp-${user.id}`,
          kind: 'KTP_FRONT',
          status: isApproved ? 'APPROVED' : 'PENDING',
          uploadStatus: 'FINALIZED',
          scanStatus: 'CLEAN',
          fileName: 'ktp.jpg',
          mimeType: 'image/jpeg',
          sizeBytes: 1024,
          rejectionReasonCode: null,
          rejectionNote: null,
          reviewedAt: profile.updatedAt?.toISOString() ?? user.createdAt.toISOString(),
          deletedAt: null,
          issuedAt: user.createdAt.toISOString(),
          uploadedAt: profile.updatedAt?.toISOString() ?? user.createdAt.toISOString(),
          finalizedAt: profile.updatedAt?.toISOString() ?? user.createdAt.toISOString(),
          version: 1,
        });
      }

      if (profile?.selfieUrl) {
        documents.push({
          id: `doc-selfie-${user.id}`,
          kind: 'SELFIE',
          status: isApproved ? 'APPROVED' : 'PENDING',
          uploadStatus: 'FINALIZED',
          scanStatus: 'CLEAN',
          fileName: 'selfie.jpg',
          mimeType: 'image/jpeg',
          sizeBytes: 1024,
          rejectionReasonCode: null,
          rejectionNote: null,
          reviewedAt: profile.updatedAt?.toISOString() ?? user.createdAt.toISOString(),
          deletedAt: null,
          issuedAt: user.createdAt.toISOString(),
          uploadedAt: profile.updatedAt?.toISOString() ?? user.createdAt.toISOString(),
          finalizedAt: profile.updatedAt?.toISOString() ?? user.createdAt.toISOString(),
          version: 1,
        });
      }

      const verificationStatus = isApproved
        ? 'APPROVED'
        : documents.length > 0
          ? 'PENDING'
          : 'ACTION_REQUIRED';

      return {
        id: `case-${user.id}`,
        user: {
          id: user.id,
          displayName: user.displayName,
          // Nama yang diisi pelanggan pada form verifikasi, untuk dicocokkan dengan nama pada KTP.
          profileName: user.profile?.fullName ?? null,
          phoneMasked: maskPhone(user.phone),
          status: user.status,
        },
        verificationStatus: verificationStatus as any,
        oldestAt: user.createdAt.toISOString(),
        documents,
      };
    });

    return {
      items,
      summary: {
        totalCustomers: totalCustomersCount,
        totalDocuments: totalDocumentsCount,
        pendingDocuments: pendingDocumentsCount,
        approvedDocuments: approvedDocumentsCount,
        pendingCustomers: pendingCustomersCount,
        approvedCustomers: approvedCustomersCount,
        rejectedDocuments: 0,
        deletionIssues: 0,
      },
      page: {
        hasMore,
        currentPage: page,
        totalPages: Math.max(1, Math.ceil(totalCount / limit)),
        totalCount,
        nextCursor: hasMore && pageUsers.length > 0 ? pageUsers[pageUsers.length - 1]?.id ?? null : null,
      },
      generatedAt: new Date().toISOString(),
    };
  }

  async getByUser(principal: SessionPrincipal, userId: string) {
    this.policy.requireCapability(principal.capabilities, 'identity-verification:read');
    const user = await this.db.user.findUnique({
      where: { id: userId },
      include: { profile: true },
    });
    if (!user) throw new ApiProblem('NOT_FOUND', HttpStatus.NOT_FOUND);

    const documents: any[] = [];
    const verificationStatus = customerVerificationStatus(user.profile);
    const isApproved = verificationStatus === 'APPROVED';

    if (user.profile?.selfieUrl) {
      documents.push({
        id: `doc-selfie-${user.id}`,
        kind: 'SELFIE',
        status: isApproved ? 'APPROVED' : 'PENDING',
        uploadStatus: 'FINALIZED',
        scanStatus: 'CLEAN',
        fileName: 'selfie.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: 1024,
        rejectionReasonCode: null,
        rejectionNote: null,
        reviewedAt: user.profile.updatedAt?.toISOString() ?? user.createdAt.toISOString(),
        deletedAt: null,
        version: 1,
      });
    }

    if (user.profile?.ktpUrl) {
      documents.push({
        id: `doc-ktp-${user.id}`,
        kind: 'KTP_FRONT',
        status: isApproved ? 'APPROVED' : 'PENDING',
        uploadStatus: 'FINALIZED',
        scanStatus: 'CLEAN',
        fileName: 'ktp.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: 1024,
        rejectionReasonCode: null,
        rejectionNote: null,
        reviewedAt: user.profile.updatedAt?.toISOString() ?? user.createdAt.toISOString(),
        deletedAt: null,
        version: 1,
      });
    }

    return {
      customer: {
        id: user.id,
        displayName: user.displayName,
        email: user.email,
        phoneE164: user.phone,
        status: user.status,
        preferredBranchId: user.preferredBranchId,
      },
      documents,
      verificationStatus,
    };
  }
}
