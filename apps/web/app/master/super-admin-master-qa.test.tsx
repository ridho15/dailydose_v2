import { describe, expect, it } from 'vitest';
import { ApiError } from '../lib/api-client';
import { masterFailure, masterFailureMessage } from '../api-clients/master-client';
import { promotionFailure } from '../api-clients/package-promotion-client';

describe('Tahap 4 - Master Data Cabang/Studio & Paket Promo QA', () => {
  describe('master-client error handling and disambiguation', () => {
    it('accurately translates ApiError branch and studio code conflicts', () => {
      const branchCodeErr = new ApiError('Branch code duplicate', 409, { code: 'BRANCH_CODE_EXISTS' }, 'BRANCH_CODE_EXISTS');
      expect(masterFailureMessage(branchCodeErr)).toBe('Kode cabang sudah terdaftar. Gunakan kode unik lain.');

      const studioCodeErr = new ApiError('Studio code duplicate', 409, { code: 'STUDIO_CODE_EXISTS' }, 'STUDIO_CODE_EXISTS');
      expect(masterFailureMessage(studioCodeErr)).toBe('Kode studio sudah digunakan pada cabang ini.');

      const roomCodeErr = new ApiError('Room code duplicate', 409, { code: 'ROOM_CODE_EXISTS' }, 'ROOM_CODE_EXISTS');
      expect(masterFailureMessage(roomCodeErr)).toBe('Kode ruangan sudah digunakan pada studio ini.');
    });

    it('accurately disambiguates STALE_VERSION on master updates', () => {
      const staleErr = new ApiError(
        'Stale version',
        409,
        { error: { code: 'STALE_VERSION' } },
        'STALE_VERSION',
      );
      expect(masterFailure(staleErr)).toBe('STALE_VERSION');
      expect(masterFailureMessage(staleErr)).toBe(
        'Data telah diubah oleh pengguna lain. Muat ulang halaman untuk mendapatkan data terbaru.',
      );
    });

    it('surfaces custom validation server message over generic placeholder', () => {
      const customValidationErr = new ApiError(
        'Kapasitas ruangan minimal 1 dan maksimal 50 orang',
        422,
        { message: 'Kapasitas ruangan minimal 1 dan maksimal 50 orang' },
        'VALIDATION_ERROR',
      );
      expect(masterFailureMessage(customValidationErr)).toBe(
        'Kapasitas ruangan minimal 1 dan maksimal 50 orang',
      );
    });

    it('handles legacy nested error structures and dependency errors', () => {
      const legacyDependencyErr = {
        response: {
          status: 409,
          data: {
            error: {
              code: 'CANNOT_DELETE_BRANCH_WITH_DEPENDENCIES',
            },
          },
        },
      };
      expect(masterFailureMessage(legacyDependencyErr)).toMatch(/tidak dapat dihapus karena masih memiliki data terkait/);
    });
  });

  describe('package-promotion-client error handling with ApiError', () => {
    it('handles ApiError instances with 409 conflict codes without crashing clone()', async () => {
      const resourceExistsErr = new ApiError(
        'Package code duplicate',
        409,
        { code: 'RESOURCE_EXISTS' },
        'RESOURCE_EXISTS',
      );
      await expect(promotionFailure(resourceExistsErr, 'Fallback')).resolves.toMatch(
        /sudah digunakan oleh paket lain/,
      );

      const staleErr = new ApiError('Stale promo', 409, { code: 'STALE_VERSION' }, 'STALE_VERSION');
      await expect(promotionFailure(staleErr, 'Fallback')).resolves.toMatch(/diubah orang lain/);

      const overlapErr = new ApiError(
        'Overlap promo',
        409,
        { code: 'PROMOTION_OVERLAP' },
        'PROMOTION_OVERLAP',
      );
      await expect(promotionFailure(overlapErr, 'Fallback')).resolves.toMatch(
        /promo aktif pada paket ini di periode yang sama/,
      );
    });

    it('surfaces specific server message if provided in ApiError', async () => {
      const customMsgErr = new ApiError(
        'Jumlah sesi paket multi-cabang tidak boleh kurang dari 5',
        422,
        { message: 'Jumlah sesi paket multi-cabang tidak boleh kurang dari 5' },
      );
      await expect(promotionFailure(customMsgErr, 'Fallback')).resolves.toBe(
        'Jumlah sesi paket multi-cabang tidak boleh kurang dari 5',
      );
    });

    it('handles Axios-like { response: { status, data } } without Response instance', async () => {
      const axiosLike = {
        response: {
          status: 409,
          data: {
            error: {
              code: 'CANNOT_DELETE_PACKAGE_WITH_DEPENDENCIES',
            },
          },
        },
      };
      await expect(promotionFailure(axiosLike, 'Fallback')).resolves.toMatch(
        /Paket tidak dapat dihapus karena sudah memiliki riwayat data/,
      );
    });
  });
});
