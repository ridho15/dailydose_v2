import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { punyaSelfie } from '../identity/verifikasi-selfie';
import type { SessionPrincipal } from '../identity/identity.service';
import { PolicyService } from '../identity/policy.service';
import { ApiProblem } from '../identity/security';
import { AuditService } from '../foundation/audit.service';

@Injectable()
export class PackageAccessService {
  constructor(
    private readonly db: PrismaService,
    private readonly policy: PolicyService,
    private readonly auditService: AuditService,
  ) {}

  catalog(principal: SessionPrincipal, mutation = false) {
    this.policy.requireCapability(
      principal.capabilities,
      mutation ? 'master:manage' : 'package:read',
    );
  }

  paymentAccount(principal: SessionPrincipal, mutation = false) {
    this.policy.requireCapability(
      principal.capabilities,
      mutation ? 'payment-account:manage' : 'payment-account:read',
    );
  }

  review(principal: SessionPrincipal, mutation = false, allowRecordForDirect = false) {
    const current = mutation ? 'payment:decide' : 'payment:review';
    const legacy = mutation ? 'purchase:decide' : 'purchase:review';
    if (allowRecordForDirect && principal.capabilities.includes('purchase:record')) return;
    if (!principal.capabilities.includes(current) && !principal.capabilities.includes(legacy))
      this.policy.requireCapability(principal.capabilities, current);
  }

  /** Mencatat penjualan manual di meja: izin `purchase:record` pada cabang penjualan. */
  record(principal: SessionPrincipal, branchId: string) {
    this.policy.requireCapability(principal.capabilities, 'purchase:record');
    if (!this.policy.hasCapability(principal, 'purchase:record', branchId))
      throw new ApiProblem('RESOURCE_NOT_FOUND', HttpStatus.NOT_FOUND);
  }

  scope(principal: SessionPrincipal, branchId: string, capabilities: string[]) {
    if (
      !this.policy.hasCapability(principal, 'branch:all', branchId) &&
      !this.policy.hasCapability(principal, 'finance:reconcile', branchId) &&
      !capabilities.some((capability) => this.policy.hasCapability(principal, capability, branchId))
    )
      throw new ApiProblem('RESOURCE_NOT_FOUND', HttpStatus.NOT_FOUND);
  }

  branchScope(principal: SessionPrincipal, capability: string) {
    return this.policy.capabilityBranchScope(principal, capability);
  }

  async requireVerifiedCustomer(principal: SessionPrincipal) {
    if (!principal.roles.some(({ role }) => role === 'CUSTOMER')) return;
    const user = await this.db.user.findUnique({
      where: { id: principal.userId },
      include: { profile: true },
    });
    if (!user || user.status !== 'ACTIVE')
      throw new ApiProblem('IDENTITY_VERIFICATION_REQUIRED', HttpStatus.FORBIDDEN);
    // Syaratnya foto selfie (tanpa KTP): staf mengenali member dari foto ini saat check-in.
    if (!punyaSelfie(user.profile))
      throw new ApiProblem('CUSTOMER_VERIFICATION_REQUIRED', HttpStatus.FORBIDDEN);
  }

  audit(
    _tx: Prisma.TransactionClient,
    principal: SessionPrincipal,
    action: string,
    type: string,
    id: string,
    branchId: string,
    correlationId: string,
    evidence?: Prisma.InputJsonObject,
  ) {
    this.auditService.record({
      action,
      resourceType: type,
      resourceId: id,
      branchId,
      actorUserId: principal.userId,
      correlationId,
      details: evidence as Record<string, unknown>,
    });
    return Promise.resolve();
  }
}
