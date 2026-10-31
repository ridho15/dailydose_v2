import { normalizePhone } from './manajemen-pelanggan.service';

describe('normalizePhone', () => {
  it('normalizes local numbers starting with 0', () => {
    expect(normalizePhone('081234567890')).toBe('+6281234567890');
    expect(normalizePhone('0812-3456-7890')).toBe('+6281234567890');
    expect(normalizePhone('(0812) 3456 7890')).toBe('+6281234567890');
  });

  it('normalizes international numbers starting with 62 (without plus)', () => {
    expect(normalizePhone('6281234567890')).toBe('+6281234567890');
    expect(normalizePhone('62 812-3456-7890')).toBe('+6281234567890');
  });

  it('preserves valid E.164 numbers with plus', () => {
    expect(normalizePhone('+6281234567890')).toBe('+6281234567890');
    expect(normalizePhone('+14155552671')).toBe('+14155552671');
  });

  it('rejects invalid or non-numeric phone values', () => {
    expect(() => normalizePhone('invalid')).toThrow();
    expect(() => normalizePhone('123')).toThrow();
    expect(() => normalizePhone('')).toThrow();
  });
});
