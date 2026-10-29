import { describe, expect, it } from 'vitest';
import { badgePeran, MENU_INSTRUKTUR } from './app-navigation';

describe('badgePeran', () => {
  it('memakai peran tertinggi, bukan "Staf" untuk Super Owner', () => {
    expect(badgePeran(['SUPER_OWNER'], false)).toBe('Super Owner');
    expect(badgePeran(['ADMIN', 'OWNER'], false)).toBe('Owner');
    expect(badgePeran(['MANAGER'], false)).toBe('Manager');
    expect(badgePeran(['FINANCE'], false)).toBe('Finance');
    expect(badgePeran(['ADMIN'], false)).toBe('Staf');
    expect(badgePeran(['INSTRUCTOR'], true)).toBe('Instruktur');
  });

  it('instruktur hanya punya empat menu', () => {
    expect(MENU_INSTRUKTUR).toEqual([
      '/workspace',
      '/workspace/classes',
      '/workspace/availability',
      '/workspace/payroll',
    ]);
  });
});
