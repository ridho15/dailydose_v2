import * as fs from 'fs';
import * as path from 'path';
import { HttpStatus, Injectable, Optional } from '@nestjs/common';
import type { ApplicationRole } from './role-capabilities';
import { ROLE_CAPABILITIES } from './role-capabilities';
import { ApiProblem } from './security';

export { ROLE_CAPABILITIES } from './role-capabilities';

export interface EffectiveRole {
  role: ApplicationRole;
  branchId: string | null;
}

export interface CapabilityGrant {
  capability: string;
  branchId: string | null;
  source: 'SYSTEM_ROLE' | 'CUSTOM_ROLE' | 'USER_OVERRIDE';
  sourceId: string;
}

export interface EffectiveAccess {
  capabilities: string[];
  branchIds: string[];
  roleCodes: string[];
  grants: CapabilityGrant[];
  denials: Array<{ capability: string; branchId: string | null; sourceId: string }>;
}

type PrincipalAccess = {
  capabilities: string[];
  branchIds: string[];
  grants?: CapabilityGrant[];
  denials?: Array<{ capability: string; branchId: string | null; sourceId: string }>;
  capabilityGrants?: CapabilityGrant[];
  capabilityDenials?: Array<{ capability: string; branchId: string | null; sourceId: string }>;
};

const NON_STAFF_ROLES: ReadonlySet<ApplicationRole> = new Set(['CUSTOMER']);

const isStaffRole = (role: ApplicationRole): boolean => !NON_STAFF_ROLES.has(role);

@Injectable()
export class PolicyService {
  private readonly overridesFile = path.resolve(
    process.env.PRIVATE_UPLOAD_ROOT
      ? path.dirname(process.env.PRIVATE_UPLOAD_ROOT)
      : path.join(process.cwd(), '.local-data'),
    'user-capability-overrides.json',
  );
  private readonly userOverrides = new Map<string, string[]>();

  constructor() {
    this.loadOverridesFromDisk();
  }

  private loadOverridesFromDisk(): void {
    try {
      if (fs.existsSync(this.overridesFile)) {
        const raw = fs.readFileSync(this.overridesFile, 'utf8');
        const data = JSON.parse(raw);
        if (data && typeof data === 'object') {
          for (const [userId, caps] of Object.entries(data)) {
            if (Array.isArray(caps)) {
              this.userOverrides.set(userId, caps as string[]);
            }
          }
        }
      }
    } catch {
      // Abaikan jika berkas belum ada atau korup
    }
  }

  private saveOverridesToDisk(): void {
    try {
      const dir = path.dirname(this.overridesFile);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const data: Record<string, string[]> = {};
      for (const [userId, caps] of this.userOverrides.entries()) {
        data[userId] = caps;
      }
      fs.writeFileSync(this.overridesFile, JSON.stringify(data, null, 2), 'utf8');
    } catch {
      // Abaikan kegagalan penulisan lokal disk
    }
  }

  setUserOverrides(userId: string, capabilities: string[]): void {
    const clean = [...new Set(capabilities)].sort();
    if (clean.length === 0) {
      this.userOverrides.delete(userId);
    } else {
      this.userOverrides.set(userId, clean);
    }
    this.saveOverridesToDisk();
  }

  getUserOverrides(userId: string): string[] {
    return this.userOverrides.get(userId) || [];
  }

  clearUserOverrides(userId: string): void {
    this.userOverrides.delete(userId);
    this.saveOverridesToDisk();
  }

  capabilities(roles: readonly EffectiveRole[]): string[] {
    const caps = roles.flatMap(({ role, branchId }) => {
      const roleCaps = [...(ROLE_CAPABILITIES[role] || [])];
      if (branchId === null && isStaffRole(role)) {
        roleCaps.push('branch:all');
      }
      return roleCaps;
    });
    return [...new Set(caps)].sort();
  }

  private staticAccess(roles: readonly EffectiveRole[]): EffectiveAccess {
    const grants = roles.flatMap(({ role, branchId }) => {
      const caps = [...(ROLE_CAPABILITIES[role] || [])];
      if (branchId === null && isStaffRole(role)) {
        caps.push('branch:all');
      }
      return caps.map((capability) => ({
        capability,
        branchId,
        source: 'SYSTEM_ROLE' as const,
        sourceId: role,
      }));
    });
    return {
      capabilities: [...new Set(grants.map(({ capability }) => capability))].sort(),
      branchIds: this.branches(roles),
      roleCodes: [...new Set(roles.map(({ role }) => role))].sort(),
      grants,
      denials: [],
    };
  }

  resolveAccess(
    userId: string,
    roles: readonly EffectiveRole[],
    _at = new Date(),
  ): EffectiveAccess {
    const access = this.staticAccess(roles);
    const overrides = this.getUserOverrides(userId);
    if (!overrides || overrides.length === 0) {
      return access;
    }

    const extraGrants: CapabilityGrant[] = overrides.map((capability) => ({
      capability,
      branchId: null,
      source: 'USER_OVERRIDE' as const,
      sourceId: 'KEYCLOAK_SSO',
    }));

    return {
      ...access,
      capabilities: [...new Set([...access.capabilities, ...overrides])].sort(),
      grants: [...access.grants, ...extraGrants],
    };
  }

  staticAccessForRoles(roles: readonly ApplicationRole[]): EffectiveAccess {
    return this.staticAccess(roles.map((role) => ({ role, branchId: null })));
  }

  roleCatalog() {
    const assignable = new Set<ApplicationRole>(['ADMIN', 'MANAGER', 'FINANCE', 'INSTRUCTOR']);
    const branchScoped = new Set<ApplicationRole>(['INSTRUCTOR', 'ADMIN', 'MANAGER', 'OWNER']);
    return (Object.keys(ROLE_CAPABILITIES) as ApplicationRole[]).map((role) => ({
      role,
      capabilities: [...ROLE_CAPABILITIES[role]],
      assignable: assignable.has(role),
      readOnly: !ROLE_CAPABILITIES[role].some((capability) =>
        /:(manage|create|request|decide|review|revoke|recover|export)$/.test(capability),
      ),
      scope: branchScoped.has(role) ? ('BRANCH' as const) : ('GLOBAL' as const),
    }));
  }

  async databaseRoleCatalog() {
    return this.roleCatalog();
  }

  branches(roles: readonly EffectiveRole[]): string[] {
    return [...new Set(roles.flatMap(({ branchId }) => (branchId ? [branchId] : [])))].sort();
  }

  requireCapability(capabilities: readonly string[], required: string): void {
    if (!capabilities.includes(required)) throw new ApiProblem('FORBIDDEN', HttpStatus.FORBIDDEN);
  }

  requireAnyCapability(capabilities: readonly string[], anyOf: readonly string[]): void {
    if (!anyOf.some((required) => capabilities.includes(required)))
      throw new ApiProblem('FORBIDDEN', HttpStatus.FORBIDDEN);
  }

  hasCapability(principal: PrincipalAccess, required: string, branchId?: string | null): boolean {
    if (!branchId) return principal.capabilities.includes(required);
    const denials = principal.denials ?? principal.capabilityDenials ?? [];
    const grants = principal.grants ?? principal.capabilityGrants;
    if (!grants)
      return (
        principal.capabilities.includes(required) &&
        (principal.capabilities.includes('branch:all') || principal.branchIds.includes(branchId))
      );
    if (
      denials.some(
        (item) =>
          item.capability === required && (item.branchId === null || item.branchId === branchId),
      )
    )
      return false;
    return grants.some(
      (item) =>
        item.capability === required && (item.branchId === null || item.branchId === branchId),
    );
  }

  requireScopedCapability(
    principal: PrincipalAccess,
    required: string,
    branchId?: string | null,
  ): void {
    if (!this.hasCapability(principal, required, branchId))
      throw new ApiProblem('FORBIDDEN', HttpStatus.FORBIDDEN);
  }

  hasGlobalCapability(principal: PrincipalAccess, required: string): boolean {
    const grants = principal.grants ?? principal.capabilityGrants;
    const denials = principal.denials ?? principal.capabilityDenials ?? [];
    if (denials.some(({ capability, branchId }) => capability === required && branchId === null))
      return false;
    if (grants)
      return grants.some(
        ({ capability, branchId }) => capability === required && branchId === null,
      );
    return (
      principal.capabilities.includes(required) && principal.capabilities.includes('branch:all')
    );
  }

  requireGlobalCapability(principal: PrincipalAccess, required: string): void {
    if (!this.hasGlobalCapability(principal, required))
      throw new ApiProblem('FORBIDDEN', HttpStatus.FORBIDDEN);
  }

  capabilityBranchScope(
    principal: PrincipalAccess,
    required: string,
  ): { all: boolean; included: string[]; excluded: string[] } {
    const grants = principal.grants ?? principal.capabilityGrants;
    const denials = principal.denials ?? principal.capabilityDenials ?? [];
    if (!grants) {
      return principal.capabilities.includes('branch:all')
        ? { all: true, included: [], excluded: [] }
        : {
            all: false,
            included: principal.capabilities.includes(required) ? [...principal.branchIds] : [],
            excluded: [],
          };
    }
    const globalDenied = denials.some(
      ({ capability, branchId }) => capability === required && branchId === null,
    );
    if (globalDenied) return { all: false, included: [], excluded: [] };
    const globallyGranted = grants.some(
      ({ capability, branchId }) =>
        branchId === null && (capability === required || capability === 'branch:all'),
    );
    const excluded = [
      ...new Set(
        denials.flatMap(({ capability, branchId }) =>
          capability === required && branchId ? [branchId] : [],
        ),
      ),
    ].sort();
    if (globallyGranted) return { all: true, included: [], excluded };
    const included = [
      ...new Set(
        grants.flatMap(({ capability, branchId }) =>
          capability === required && branchId ? [branchId] : [],
        ),
      ),
    ]
      .filter((branchId) => !excluded.includes(branchId))
      .sort();
    return { all: false, included, excluded: [] };
  }

  requireCustomerSelf(roles: readonly EffectiveRole[], capabilities: readonly string[]): void {
    const customerOnly =
      roles.length > 0 &&
      roles.every(({ role }) => role === 'CUSTOMER');
    if (!customerOnly || !capabilities.includes('customer:self'))
      throw new ApiProblem('FORBIDDEN', HttpStatus.FORBIDDEN);
  }

  requireBranchScope(principal: PrincipalAccess, branchId: string): void {
    if (!branchId) throw new ApiProblem('VALIDATION_ERROR', HttpStatus.BAD_REQUEST);
    const hasGlobal = principal.capabilities.includes('branch:all');
    const hasSpecific = principal.branchIds.includes(branchId);
    if (!hasGlobal && !hasSpecific) {
      throw new ApiProblem('FORBIDDEN', HttpStatus.FORBIDDEN);
    }
  }
}
