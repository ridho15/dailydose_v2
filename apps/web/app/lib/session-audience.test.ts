import { describe, expect, it } from 'vitest';
import {
  isCustomerCatalogPath,
  isInstructorOnlySession,
  isPublicExperiencePath,
  packageAudienceState,
} from './session-audience';
import type { WebSession } from '@/api-clients/session-client';

const session = (
  roles: string[],
  identityVerificationStatus: WebSession['identityVerificationStatus'],
): WebSession => ({
  id: 'session',
  displayName: 'Test',
  roles,
  capabilities: [],
  branchIds: [],
  branches: [],
  preferredBranch: null,
  identityVerificationStatus,
  sessionExpiresAt: new Date(Date.now() + 60_000),
});

describe('public detail routing and audience', () => {
  it.each([
    '/classes/reformer-pilates',
    '/packages/package-id',
    '/schedule/slot-id',
    '/locations/jakarta',
  ])('treats %s as a public and customer-catalog route', (pathname) => {
    expect(isPublicExperiencePath(pathname)).toBe(true);
    expect(isCustomerCatalogPath(pathname)).toBe(true);
  });

  it('treats /guide and public information routes as public experience paths', () => {
    expect(isPublicExperiencePath('/guide')).toBe(true);
    expect(isPublicExperiencePath('/contact')).toBe(true);
    expect(isPublicExperiencePath('/')).toBe(true);
  });

  it('keeps staff and multi-role accounts out of customer purchase flow', () => {
    expect(packageAudienceState(session(['SUPER_OWNER'], 'NOT_REQUIRED'))).toBe('STAFF');
    expect(packageAudienceState(session(['CUSTOMER', 'ADMIN'], 'APPROVED'))).toBe('STAFF');
  });

  it('allows customers to purchase packages regardless of KYC verification status', () => {
    expect(packageAudienceState(session(['CUSTOMER'], 'PENDING'))).toBe('CUSTOMER_APPROVED');
    expect(packageAudienceState(session(['CUSTOMER'], 'APPROVED'))).toBe('CUSTOMER_APPROVED');
  });

  it('treats INSTRUCTOR-only accounts as instructor-only', () => {
    expect(isInstructorOnlySession(session(['INSTRUCTOR'], 'NOT_REQUIRED'))).toBe(true);
  });

  it('keeps dual-role accounts (e.g. INSTRUCTOR + ADMIN) out of instructor-only scope', () => {
    expect(isInstructorOnlySession(session(['INSTRUCTOR', 'ADMIN'], 'NOT_REQUIRED'))).toBe(false);
    expect(isInstructorOnlySession(session(['ADMIN'], 'NOT_REQUIRED'))).toBe(false);
    expect(isInstructorOnlySession(null)).toBe(false);
  });
});
