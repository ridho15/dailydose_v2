import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  formatAnomalyType,
  formatApiErrorCode,
  formatClassLevel,
  formatClassType,
  formatReminderStatus,
  formatSeverity,
  formatStudioName,
  formatTimezone,
  formatVerificationStatus,
  sanitizeUserFacingText,
} from './system-dictionary';

describe('Tiket T-13: Hapus kode sistem dari tampilan pengguna', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('Kriteria Penerimaan T-13: Tidak ada kode sistem mentah di hasil render', () => {
    it('membersihkan ALL_LEVELS, PRIVATE_GROUP, Asia/Jakarta, KYC, payload, idempotency, optimistic locking melalui sanitizeUserFacingText', () => {
      const rawText =
        'Proses verifikasi KYC dengan payload token dd-checkin:v1:abc untuk kelas PRIVATE_GROUP dan ALL_LEVELS di DD-GG (Asia/Jakarta) menggunakan mekanisme idempotency dan optimistic locking versi data.';
      const cleaned = sanitizeUserFacingText(rawText);

      // Kriteria penerimaan T-13 persis:
      expect(cleaned).not.toContain('ALL_LEVELS');
      expect(cleaned).not.toContain('PRIVATE_GROUP');
      expect(cleaned).not.toContain('DD-GG');
      expect(cleaned).not.toContain('Asia/Jakarta');
      expect(cleaned).not.toContain('KYC');
      expect(cleaned).not.toContain('payload');
      expect(cleaned).not.toContain('idempotency');
      expect(cleaned).not.toContain('optimistic locking');
      expect(cleaned).not.toContain('versi data');

      // Memastikan teks pengganti manusiawi hadir:
      expect(cleaned).toContain('Verifikasi Identitas');
      expect(cleaned).toContain('data QR');
      expect(cleaned).toContain('QR Presensi Studio');
      expect(cleaned).toContain('Private Group');
      expect(cleaned).toContain('Semua Level');
      expect(cleaned).toContain('Green Garden');
      expect(cleaned).toContain('WIB');
      expect(cleaned).toContain('tindakan');
      expect(cleaned).toContain('sinkronisasi data');
      expect(cleaned).toContain('revisi pesanan');
    });
  });

  describe('Pemetaan kamus terpusat (system-dictionary)', () => {
    it('menerjemahkan studio codes ke nama manusia pendek dan panjang', () => {
      expect(formatStudioName('DD-GG', 'short')).toBe('Green Garden');
      expect(formatStudioName('DD-MK', 'short')).toBe('Muara Karang');
      expect(formatStudioName('DD-SBY', 'short')).toBe('Graha Family Surabaya');
      expect(formatStudioName('DD-PIK2', 'short')).toBe('Orange Groves PIK 2');
      expect(formatStudioName('DD-UNTAR', 'short')).toBe('Untar Kampus 2');

      expect(formatStudioName('DD-GG', 'full')).toBe('Daily Dose Green Garden');
      expect(formatStudioName('DD-MK', 'full')).toBe('Daily Dose Muara Karang');
    });

    it('menerjemahkan level kelas dan tipe kelas database', () => {
      expect(formatClassLevel('ALL_LEVELS')).toBe('Semua Level');
      expect(formatClassLevel('BEGINNER')).toBe('Pemula');
      expect(formatClassLevel('INTERMEDIATE')).toBe('Menengah');
      expect(formatClassLevel('ADVANCED')).toBe('Lanjutan');

      expect(formatClassType('PRIVATE_GROUP')).toBe('Private Group');
      expect(formatClassType('SEMI_PRIVATE')).toBe('Semi Private');
      expect(formatClassType('ALL_TYPES')).toBe('Semua Tipe');
    });

    it('menerjemahkan timezone IANA ke singkatan waktu Indonesia', () => {
      expect(formatTimezone('Asia/Jakarta')).toBe('WIB');
      expect(formatTimezone('Asia/Pontianak')).toBe('WIB');
      expect(formatTimezone('Asia/Makassar')).toBe('WITA');
      expect(formatTimezone('Asia/Jayapura')).toBe('WIT');
    });

    it('menerjemahkan anomali keuangan dan tingkat keparahan', () => {
      expect(formatAnomalyType('VERIFIKASI_TERTAHAN')).toBe('Verifikasi Tertahan (> 24 Jam)');
      expect(formatAnomalyType('UNMATCHED_MUTATION')).toBe('Mutasi Belum Cocok');
      expect(formatAnomalyType('OVERPAID')).toBe('Kelebihan Bayar');
      expect(formatAnomalyType('UNDERPAID')).toBe('Kekurangan Bayar');

      expect(formatSeverity('ERROR')).toBe('Kritis');
      expect(formatSeverity('WARNING')).toBe('Peringatan');
      expect(formatSeverity('INFO')).toBe('Informasi');
    });

    it('menerjemahkan status log reminder WhatsApp', () => {
      expect(formatReminderStatus('SENT')).toEqual({ label: 'Terkirim', tone: 'success' });
      expect(formatReminderStatus('FAILED')).toEqual({ label: 'Gagal', tone: 'danger' });
      expect(formatReminderStatus('SKIPPED_DUPLICATE')).toEqual({
        label: 'Dilewati (Duplikat)',
        tone: 'neutral',
      });
    });

    it('menerjemahkan kode error API internal ke bahasa yang ramah pelanggan', () => {
      expect(formatApiErrorCode('CUSTOMER_VERIFICATION_REQUIRED')).toContain(
        'identitas kamu belum diverifikasi',
      );
      expect(formatApiErrorCode('IDEMPOTENCY_KEY_REUSED')).toContain('Permintaan sudah pernah dikirim');
      expect(formatApiErrorCode('OPTIMISTIC_LOCK_CONFLICT')).toContain('Data telah diperbarui oleh staf lain');
      expect(formatApiErrorCode('OUTSIDE_GEOFENCE')).toContain('di luar radius cabang studio');
    });

    it('menerjemahkan status verifikasi customer dengan panduan durasi & channel WhatsApp', () => {
      const verified = formatVerificationStatus('VERIFIED');
      expect(verified.label).toBe('Terverifikasi');
      expect(verified.variant).toBe('success');

      const pending = formatVerificationStatus('PENDING');
      expect(pending.label).toBe('Sedang Diperiksa');
      expect(pending.description).toContain('WhatsApp');

      const unverified = formatVerificationStatus('UNVERIFIED');
      expect(unverified.label).toBe('Belum Terverifikasi');
      expect(unverified.description).toContain('2 menit');
    });
  });
});
