import { describe, expect, it } from 'vitest';
import { hrGroupEnabled, hrGroupErrorMessage, hrGroupStartHref } from './hr-group';

const env = {
  HRG_ENABLED: 'true',
  HRG_ISSUER: 'https://akun.hrgroup.test',
  HRG_CLIENT_ID: 'dailydose',
  HRG_CLIENT_SECRET: 'x',
  HRG_REDIRECT_URI: 'https://dailydose.test/api/v1/auth/hr-group/callback',
  HRG_BRIDGE_SECRET: 'y',
};

describe('hrGroupEnabled', () => {
  it('mati bila HRG_ENABLED bukan true atau salah satu env kosong', () => {
    expect(hrGroupEnabled({})).toBe(false);
    expect(hrGroupEnabled({ ...env, HRG_ENABLED: 'false' })).toBe(false);
    expect(hrGroupEnabled({ ...env, HRG_BRIDGE_SECRET: '' })).toBe(false);
    expect(hrGroupEnabled(env)).toBe(true);
  });
});

describe('hrGroupStartHref', () => {
  it('membawa tujuan setelah masuk sebagai returnTo', () => {
    expect(hrGroupStartHref('/bookings/new?slot=1')).toBe(
      '/api/v1/auth/hr-group/start?returnTo=%2Fbookings%2Fnew%3Fslot%3D1',
    );
    expect(hrGroupStartHref('')).toBe('/api/v1/auth/hr-group/start?returnTo=%2Fworkspace');
  });
});

describe('hrGroupErrorMessage', () => {
  it('memetakan kode callback ke pesan Indonesia, kode asing ke pesan umum', () => {
    expect(hrGroupErrorMessage(null)).toBeNull();
    expect(hrGroupErrorMessage('ambiguous')).toContain('akun ganda');
    expect(hrGroupErrorMessage('cancelled')).toBe('Masuk dengan Akun HR Group dibatalkan.');
    expect(hrGroupErrorMessage('<script>')).toBe(hrGroupErrorMessage('server'));
  });
});
