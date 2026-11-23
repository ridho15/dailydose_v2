import { describe, expect, it, vi } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '../lib/api-client';
import {
  assignmentFailure,
  assignmentFailureDetail,
  type AssignmentClient,
} from '../api-clients/assignment-client';
import { AssignmentsView } from './assignments-view';

function makeMockAssignmentClient(overrides: Partial<AssignmentClient> = {}): AssignmentClient {
  return {
    list: vi.fn().mockResolvedValue({
      items: [],
      summary: { total: 0, active: 0, ended: 0 },
      page: { nextCursor: null, hasMore: false },
    }),
    listUsers: vi.fn().mockResolvedValue([{ id: 'user-1', displayName: 'Coach Alpha' }]),
    create: vi.fn().mockResolvedValue(undefined),
    end: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('Tahap 3 - Penugasan Instruktur & Owner Cabang QA', () => {
  describe('assignmentFailure error mapping & disambiguation', () => {
    it('correctly maps ApiError STALE_VERSION on 409 conflict', () => {
      const err = new ApiError(
        'Penugasan telah diperbarui oleh admin lain',
        409,
        { code: 'STALE_VERSION' },
        'STALE_VERSION',
      );
      expect(assignmentFailure(err)).toBe('STALE_VERSION');
      expect(assignmentFailureDetail(err)).toBe('Penugasan telah diperbarui oleh admin lain');
    });

    it('correctly maps nested RFC error structure { error: { code: "STALE_VERSION" } } on 409', () => {
      const legacyErr = {
        response: {
          status: 409,
          data: {
            error: {
              code: 'STALE_VERSION',
              message: 'Versi penugasan sudah kedaluwarsa.',
            },
          },
        },
      };
      expect(assignmentFailure(legacyErr)).toBe('STALE_VERSION');
      expect(assignmentFailureDetail(legacyErr)).toBe('Versi penugasan sudah kedaluwarsa.');
    });

    it('correctly maps 409 to EFFECTIVE_PERIOD_OVERLAP when not STALE_VERSION', () => {
      const overlapErr = new ApiError(
        'Jadwal penugasan bertabrakan',
        409,
        { code: 'EFFECTIVE_PERIOD_OVERLAP' },
        'EFFECTIVE_PERIOD_OVERLAP',
      );
      expect(assignmentFailure(overlapErr)).toBe('EFFECTIVE_PERIOD_OVERLAP');
      expect(assignmentFailureDetail(overlapErr)).toBe('Jadwal penugasan bertabrakan');

      const plain409 = { response: { status: 409 } };
      expect(assignmentFailure(plain409)).toBe('EFFECTIVE_PERIOD_OVERLAP');
    });

    it('correctly maps 404, 403, 422, 400 and network errors from ApiError instances', () => {
      expect(assignmentFailure(new ApiError('Not found', 404))).toBe('RESOURCE_NOT_FOUND');
      expect(assignmentFailure(new ApiError('Forbidden', 403))).toBe('FORBIDDEN');
      expect(assignmentFailure(new ApiError('Validation error', 422))).toBe('VALIDATION_ERROR');
      expect(assignmentFailure(new ApiError('Bad request', 400))).toBe('VALIDATION_ERROR');
      expect(assignmentFailure(new Error('Network failure'))).toBe('API_UNAVAILABLE');
    });

    it('suppresses generic error prefixes in assignmentFailureDetail', () => {
      const genericFetchErr = new ApiError('Assignment request failed: 500', 500);
      expect(assignmentFailureDetail(genericFetchErr)).toBeUndefined();
    });
  });

  describe('AssignmentsView integration with STALE_VERSION & error details', () => {
    const branches = [{ id: 'branch-1', code: 'GG', name: 'Green Garden' }];

    it('renders STALE_VERSION state with action to reload when concurrency conflict occurs', async () => {
      const staleError = new ApiError(
        'Data penugasan berubah',
        409,
        { error: { code: 'STALE_VERSION' } },
        'STALE_VERSION',
      );

      const fakeClient = makeMockAssignmentClient({
        list: vi.fn().mockRejectedValue(staleError),
      });

      render(
        <AssignmentsView
          client={fakeClient}
          branchOptions={branches}
          activeBranchId="branch-1"
          access={{ canRead: true, canManage: true }}
        />,
      );

      expect(
        await screen.findByText(/Penugasan telah berubah\. Muat ulang sebelum melanjutkan\./),
      ).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Coba lagi' })).toBeInTheDocument();
    });

    it('shows custom server validation detail when drawer submission fails with 422', async () => {
      const customValidationErr = new ApiError(
        'Tanggal akhir tidak boleh mendahului tanggal mulai',
        422,
        { error: { message: 'Tanggal akhir tidak boleh mendahului tanggal mulai' } },
        'VALIDATION_ERROR',
      );

      const fakeClient = makeMockAssignmentClient({
        create: vi.fn().mockRejectedValue(customValidationErr),
      });

      render(
        <AssignmentsView
          client={fakeClient}
          branchOptions={branches}
          activeBranchId="branch-1"
          access={{ canRead: true, canManage: true }}
        />,
      );

      await userEvent.click(screen.getByRole('button', { name: 'Buat penugasan' }));
      const dialog = await screen.findByRole('dialog', { name: 'Buat penugasan' });
      const form = within(dialog);

      await userEvent.type(form.getByLabelText('Pengguna'), 'Coa');
      await userEvent.click(await form.findByRole('option', { name: /Coach Alpha/ }));
      await userEvent.type(form.getByLabelText(/Aktif mulai/), '2026-08-01');
      await userEvent.type(form.getByLabelText(/Alasan/), 'test custom validation');
      await userEvent.click(form.getByRole('button', { name: 'Buat penugasan' }));

      // Checks that the combined failure copy and server detail are rendered
      expect(
        await screen.findByText(/Periksa kembali pengguna, periode, dan alasan tindakan\./),
      ).toBeInTheDocument();
      expect(
        screen.getByText(/Tanggal akhir tidak boleh mendahului tanggal mulai/),
      ).toBeInTheDocument();
    });

    it('shows inline error in EndAssignmentDialog when reason is whitespace or backend returns 422', async () => {
      const error422 = new ApiError('Permintaan tidak dapat diproses.', 422, {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Permintaan tidak dapat diproses.',
          details: [{ field: 'reason', issue: 'REQUIRED' }],
        },
      });

      const sampleItem = {
        id: 'assignment-1',
        userId: 'user-1',
        branchId: 'branch-1',
        assignmentType: 'INSTRUCTOR' as const,
        activeFrom: '2026-08-01',
        activeUntil: null,
        status: 'ACTIVE' as const,
        user: { id: 'user-1', displayName: 'Coach Alpha', phoneMasked: null },
        branch: { id: 'branch-1', code: 'B1', name: 'Cabang Satu' },
        version: 1,
      };

      const fakeClient = makeMockAssignmentClient({
        list: vi.fn().mockResolvedValue({
          items: [sampleItem],
          summary: { total: 1, active: 1, ended: 0 },
          page: { nextCursor: null, hasMore: false },
        }),
        end: vi.fn().mockRejectedValue(error422),
      });

      render(
        <AssignmentsView
          client={fakeClient}
          branchOptions={branches}
          activeBranchId="branch-1"
          access={{ canRead: true, canManage: true }}
        />,
      );

      // Open End Assignment dialog
      const endButtons = await screen.findAllByRole('button', { name: 'Akhiri' });
      await userEvent.click(endButtons[0]);

      const dialog = await screen.findByRole('dialog', { name: 'Akhiri penugasan' });
      const form = within(dialog);

      // Fill datetime
      fireEvent.change(form.getByLabelText(/Efektif berakhir/), {
        target: { value: '2026-11-23T15:00' },
      });

      // Case A: Fill with only whitespace -> Client validation catches it
      fireEvent.change(form.getByLabelText(/Alasan/), {
        target: { value: '   ' },
      });
      await userEvent.click(form.getByRole('button', { name: 'Akhiri penugasan' }));

      expect(
        await screen.findByText(/Alasan pengakhiran penugasan wajib diisi minimal 3 karakter/),
      ).toBeInTheDocument();
      expect(fakeClient.end).not.toHaveBeenCalled();

      // Case B: Fill valid-looking string but backend returns 422 details
      fireEvent.change(form.getByLabelText(/Alasan/), {
        target: { value: 'Penonaktifan staf' },
      });
      await userEvent.click(form.getByRole('button', { name: 'Akhiri penugasan' }));

      // Verifies inline error is displayed inside dialog and main table is still intact
      expect(
        await screen.findByText(/Alasan wajib diisi \(minimal 3 karakter tanpa spasi kosong\)\./),
      ).toBeInTheDocument();
      expect(fakeClient.end).toHaveBeenCalled();
    });
  });
});
