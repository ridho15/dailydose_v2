import { describe, expect, it } from 'vitest';
import type { CustomerPackageBalance } from '@/api-clients/booking-client';
import { pilihCalon } from './timetable-roster-panel';

const member = { id: 'm-1', displayName: 'Sari Dewi' };
const kelas = { classTypeId: 'pg', startAt: new Date('2026-10-30T02:00:00.000Z') };
const TZ = 'Asia/Jakarta';

const paket = (over: Partial<CustomerPackageBalance> = {}): CustomerPackageBalance => ({
  id: 'p-1',
  customerUserId: 'm-1',
  classTypeId: 'pg',
  status: 'ACTIVE',
  available: 5,
  expiryAt: new Date('2026-12-01T00:00:00.000Z'),
  packageName: 'Private Group 10 sesi',
  ...over,
});

describe('pilihCalon', () => {
  it('memakai paket aktif untuk tipe kelas yang sama', () => {
    const hasil = pilihCalon(member, [paket()], kelas, TZ);

    expect(hasil.kendala).toBeNull();
    expect(hasil.paket?.id).toBe('p-1');
  });

  it('memakai paket yang paling cepat berakhir lebih dulu agar sesinya tidak hangus', () => {
    const hasil = pilihCalon(
      member,
      [
        paket({ id: 'lama', expiryAt: new Date('2027-01-31T00:00:00.000Z') }),
        paket({ id: 'segera', expiryAt: new Date('2026-11-05T00:00:00.000Z') }),
      ],
      kelas,
      TZ,
    );

    expect(hasil.paket?.id).toBe('segera');
  });

  it('menolak paket yang masih berlaku hari ini tetapi sudah habis saat kelas dimulai', () => {
    const hasil = pilihCalon(
      member,
      [paket({ expiryAt: new Date('2026-10-29T00:00:00.000Z') })],
      kelas,
      TZ,
    );

    expect(hasil.paket).toBeNull();
    expect(hasil.kendala).toBe('Paket habis 29 Okt 2026');
  });

  it('tidak memakai paket tipe kelas lain', () => {
    const hasil = pilihCalon(member, [paket({ classTypeId: 'semi' })], kelas, TZ);

    expect(hasil.paket).toBeNull();
    expect(hasil.kendala).toBe('Belum punya paket untuk kelas ini');
  });

  it('menyebut sesi habis bila paketnya masih berlaku tetapi saldonya nol', () => {
    const hasil = pilihCalon(member, [paket({ available: 0 })], kelas, TZ);

    expect(hasil.kendala).toBe('Sesi paket sudah habis');
  });

  it('tidak memakai paket milik member lain', () => {
    const hasil = pilihCalon(member, [paket({ customerUserId: 'm-2' })], kelas, TZ);

    expect(hasil.paket).toBeNull();
  });

  it('memakai paket bersama (shared package) milik member lain jika member terdaftar di sharedWithUserIds', () => {
    const hasil = pilihCalon(
      member,
      [
        paket({
          id: 'shared-pkg-1',
          customerUserId: 'm-owner',
          customer: { id: 'm-owner', displayName: 'Owner Budi' },
          isShareable: true,
          sharedWithUserIds: ['m-1'],
        }),
      ],
      kelas,
      TZ,
    );

    expect(hasil.kendala).toBeNull();
    expect(hasil.paket?.id).toBe('shared-pkg-1');
  });

  it('tidak memakai paket bersama jika member tidak terdaftar di sharedWithUserIds', () => {
    const hasil = pilihCalon(
      member,
      [
        paket({
          id: 'shared-pkg-1',
          customerUserId: 'm-owner',
          customer: { id: 'm-owner', displayName: 'Owner Budi' },
          isShareable: true,
          sharedWithUserIds: ['m-other'],
        }),
      ],
      kelas,
      TZ,
    );

    expect(hasil.paket).toBeNull();
  });

  it('menyebut sesi habis jika kuota paket bersama sudah 0 (no happy path)', () => {
    const hasil = pilihCalon(
      member,
      [
        paket({
          id: 'shared-pkg-empty',
          customerUserId: 'm-owner',
          customer: { id: 'm-owner', displayName: 'Owner Budi' },
          isShareable: true,
          sharedWithUserIds: ['m-1'],
          available: 0,
        }),
      ],
      kelas,
      TZ,
    );

    expect(hasil.paket).toBeNull();
    expect(hasil.kendala).toBe('Sesi paket sudah habis');
  });

  it('menolak jika paket bersama sudah kadaluwarsa saat kelas dimulai (no happy path)', () => {
    const hasil = pilihCalon(
      member,
      [
        paket({
          id: 'shared-pkg-expired',
          customerUserId: 'm-owner',
          customer: { id: 'm-owner', displayName: 'Owner Budi' },
          isShareable: true,
          sharedWithUserIds: ['m-1'],
          expiryAt: new Date('2026-10-29T00:00:00.000Z'),
        }),
      ],
      kelas,
      TZ,
    );

    expect(hasil.paket).toBeNull();
    expect(hasil.kendala).toBe('Paket habis 29 Okt 2026');
  });

  it('menolak jika paket bersama berbeda tipe kelas (no happy path)', () => {
    const hasil = pilihCalon(
      member,
      [
        paket({
          id: 'shared-pkg-diff-ct',
          customerUserId: 'm-owner',
          customer: { id: 'm-owner', displayName: 'Owner Budi' },
          isShareable: true,
          sharedWithUserIds: ['m-1'],
          classTypeId: 'mat',
        }),
      ],
      kelas,
      TZ,
    );

    expect(hasil.paket).toBeNull();
    expect(hasil.kendala).toBe('Belum punya paket untuk kelas ini');
  });

  it('menerima paket bebas tipe kelas', () => {
    const hasil = pilihCalon(member, [paket({ classTypeId: null })], kelas, TZ);

    expect(hasil.paket?.id).toBe('p-1');
  });
});
