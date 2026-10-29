import { describe, expect, it } from 'vitest';
import { roleSummary } from '../users/user-admin-controls';
import { roleLabel } from './role-labels';

describe('roleLabel', () => {
  it('labels every canonical role', () => {
    expect(roleLabel('SUPER_OWNER')).toBe('Super Owner');
    expect(roleLabel('OWNER')).toBe('Owner cabang');
    expect(roleLabel('ADMIN')).toBe('Admin cabang');
    expect(roleLabel('FINANCE')).toBe('Finance');
    expect(roleLabel('INSTRUCTOR')).toBe('Instruktur');
  });

  it('never renders "undefined" for unknown or custom roles', () => {
    expect(roleLabel('KASIR_SHIFT')).toBe('Kasir Shift');
    expect(roleLabel('front-desk')).toBe('Front Desk');
    expect(roleLabel('')).toBe('Role tidak dikenal');
    expect(roleLabel(undefined)).toBe('Role tidak dikenal');
    expect(roleLabel(null)).toBe('Role tidak dikenal');
  });

  it('supports the short variant used by the shell', () => {
    expect(roleLabel('OWNER', 'short')).toBe('Owner');
    expect(roleLabel('MANAGER', 'short')).toBe('Manager');
    expect(roleLabel('INSTRUCTOR', 'short')).toBe('Instruktur');
  });

  it('keeps the staff list role column readable for canonical and custom roles', () => {
    const summary = roleSummary([
      {
        role: 'INSTRUCTOR',
        branchId: 'b1',
        branch: { id: 'b1', code: 'JKT', name: 'Jakarta' },
        source: 'DIRECT',
      },
      { role: 'SUPER_OWNER', branchId: null, branch: null, source: 'DIRECT' },
      { role: 'KASIR_SHIFT', branchId: null, branch: null, source: 'DIRECT' },
    ] as never);
    expect(summary).toEqual(['Instruktur · Jakarta', 'Super Owner', 'Kasir Shift']);
    expect(summary.join(' ')).not.toContain('undefined');
  });
});
