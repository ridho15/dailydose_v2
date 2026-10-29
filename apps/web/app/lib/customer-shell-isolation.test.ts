import { describe, expect, it } from 'vitest';
import { isCustomerOnlySession, internalStaffRoles } from './session-audience';
import { defaultSessionDestination, canAccessSessionPath, forbiddenSessionDestination } from '../session-context';
import type { WebSession } from '@/api-clients/session-client';

describe('Customer & Member Shell Isolation and Workspace Button Protection', () => {
  const memberCustomerSession: WebSession = {
    id: 'user-member-1',
    displayName: 'Ahmad Member',
    roles: ['CUSTOMER'],
    branchIds: [],
    capabilities: ['customer:self', 'booking:self:read', 'booking:self:create'],
    branches: [],
    preferredBranch: null,
    identityVerificationStatus: 'APPROVED',
    sessionExpiresAt: new Date(Date.now() + 3600000),
  };

  const memberOnlySession: WebSession = {
    id: 'user-member-2',
    displayName: 'Budi Member Only',
    roles: ['CUSTOMER'],
    branchIds: [],
    capabilities: ['customer:self', 'booking:self:read', 'booking:self:create'],
    branches: [],
    preferredBranch: null,
    identityVerificationStatus: 'APPROVED',
    sessionExpiresAt: new Date(Date.now() + 3600000),
  };

  const staffAdminSession: WebSession = {
    id: 'user-admin-1',
    displayName: 'Super Owner',
    roles: ['ADMIN', 'SUPER_OWNER'],
    branchIds: [],
    capabilities: ['branches:read', 'branches:write'],
    branches: [],
    preferredBranch: null,
    identityVerificationStatus: 'APPROVED',
    sessionExpiresAt: new Date(Date.now() + 3600000),
  };

  const staffWithCustomerSession: WebSession = {
    id: 'user-hybrid-1',
    displayName: 'Manager with Personal Member Account',
    roles: ['MANAGER', 'CUSTOMER'],
    branchIds: [],
    capabilities: ['branches:read'],
    branches: [],
    preferredBranch: null,
    identityVerificationStatus: 'APPROVED',
    sessionExpiresAt: new Date(Date.now() + 3600000),
  };

  it('correctly identifies member and customer as customer-only, isolating them from staff', () => {
    expect(isCustomerOnlySession(memberCustomerSession)).toBe(true);
    expect(isCustomerOnlySession(memberOnlySession)).toBe(true);
    expect(isCustomerOnlySession(staffAdminSession)).toBe(false);
    expect(isCustomerOnlySession(staffWithCustomerSession)).toBe(false);
  });

  it('ensures internal staff roles never contain CUSTOMER', () => {
    expect(internalStaffRoles.has('CUSTOMER')).toBe(false);
    expect(internalStaffRoles.has('ADMIN')).toBe(true);
    expect(internalStaffRoles.has('MANAGER')).toBe(true);
    expect(internalStaffRoles.has('SUPER_OWNER')).toBe(true);
  });

  it('guarantees customer default destination is member home (/account), never admin workspace', () => {
    expect(defaultSessionDestination(memberCustomerSession)).toBe('/account');
    expect(defaultSessionDestination(memberOnlySession)).toBe('/account');
    expect(defaultSessionDestination(staffAdminSession)).toBe('/workspace');
  });

  it('denies customer access to internal workspaces and routes them appropriately', () => {
    expect(canAccessSessionPath(memberCustomerSession, '/workspace')).toBe(false);
    expect(canAccessSessionPath(memberCustomerSession, '/ledger')).toBe(false);
    expect(canAccessSessionPath(memberCustomerSession, '/vouchers')).toBe(false);
    expect(canAccessSessionPath(memberCustomerSession, '/operations')).toBe(false);
    expect(canAccessSessionPath(memberCustomerSession, '/bookings')).toBe(true);
    expect(canAccessSessionPath(memberCustomerSession, '/account')).toBe(true);

    // If customer somehow hits /workspace/bookings, reroute to /bookings
    expect(forbiddenSessionDestination(memberCustomerSession, '/workspace/bookings')).toBe('/bookings');
  });

  it('denies staff access to customer booking self-management and routes them to workspace', () => {
    expect(canAccessSessionPath(staffAdminSession, '/bookings')).toBe(false);
    expect(forbiddenSessionDestination(staffAdminSession, '/bookings')).toBe('/workspace/bookings');
  });
});
