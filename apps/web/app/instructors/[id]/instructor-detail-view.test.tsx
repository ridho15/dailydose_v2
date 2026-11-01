import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { InstructorDetailView } from './instructor-detail-view';
import { instructorClient, type InstructorDetail } from '../instructor-client';
import { AppFeedbackProvider } from '../../components/app-feedback';

vi.mock('../../session-context', () => ({
  useSessionContext: () => ({
    session: {
      status: 'authenticated',
      hasCapability: () => true,
      capabilities: ['user:admin', 'assignment:manage', 'master:manage'],
      branches: [{ id: 'b1', name: 'Gading Serpong', code: 'DD-GG' }],
    },
    activeBranchId: 'b1',
  }),
}));

const mockDetail: InstructorDetail = {
  id: 'inst-1',
  displayName: 'Coach Devi',
  email: 'devi@dailydose.id',
  phoneE164: '+628123456789',
  status: 'ACTIVE',
  version: 3,
  assignments: [
    {
      id: 'asgn-1',
      branch: { id: 'b1', code: 'DD-GG', name: 'Gading Serpong' },
      activeFrom: '2026-01-01T00:00:00Z',
      activeUntil: null,
    },
  ],
  instructedClassSlots: [
    {
      id: 'slot-1',
      startAt: '2026-09-16T10:00:00Z',
      endAt: '2026-09-16T11:00:00Z',
      status: 'CONFIRMED',
      classType: { code: 'REF', name: 'Reformer Pilates' },
      branch: { id: 'b1', name: 'Gading Serpong' },
      instructorHourLog: { amountRp: 150000 },
    },
  ],
  instructorAvailabilities: [],
  instructorAttendances: [],
  instructorHourLogs: [],
  compensationRp: 150000,
  blockers: { completedWithoutCheckIn: 0, completedWithoutFee: 0 },
};

describe('InstructorDetailView CRUD Actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(instructorClient, 'detail').mockResolvedValue(mockDetail);
    vi.spyOn(instructorClient, 'updateProfile').mockResolvedValue({});
    vi.spyOn(instructorClient, 'toggleStatus').mockResolvedValue({});
  });

  it('renders instructor header, actions, metrics, and assigned branches', async () => {
    render(
      <AppFeedbackProvider>
        <InstructorDetailView id="inst-1" />
      </AppFeedbackProvider>,
    );

    expect(await screen.findByText('Coach Devi')).toBeVisible();
    expect(screen.getByText(/devi@dailydose\.id/)).toBeVisible();
    expect(screen.getByText('Gading Serpong')).toBeVisible();

    // Verify action buttons
    expect(screen.getByRole('button', { name: 'Edit Profil' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Nonaktifkan' })).toBeVisible();
    const assignmentLink = screen.getByRole('link', { name: 'Kelola Penugasan' });
    expect(assignmentLink).toBeVisible();
    expect(assignmentLink).toHaveAttribute('href', '/assignments?q=Coach%20Devi');
  });

  it('opens Edit Profil drawer and submits profile update', async () => {
    render(
      <AppFeedbackProvider>
        <InstructorDetailView id="inst-1" />
      </AppFeedbackProvider>,
    );

    await userEvent.click(await screen.findByRole('button', { name: 'Edit Profil' }));

    // Drawer opens
    expect(await screen.findByText('Edit Profil Instruktur')).toBeVisible();
    const nameInput = screen.getByLabelText(/Nama Lengkap Instruktur/i);
    expect(nameInput).toHaveValue('Coach Devi');

    // Change phone
    const phoneInput = screen.getByLabelText(/Nomor WhatsApp \/ HP/i);
    await userEvent.clear(phoneInput);
    await userEvent.type(phoneInput, '+628999888777');

    // Submit drawer form
    const submitBtn = screen.getByRole('button', { name: 'Simpan Perubahan' });
    await userEvent.click(submitBtn);

    // Confirm dialog
    expect(await screen.findByText('Simpan perubahan profil instruktur?')).toBeVisible();
    const confirmButtons = screen.getAllByRole('button', { name: 'Simpan Perubahan' });
    const modalConfirmBtn = confirmButtons[confirmButtons.length - 1]!;
    await userEvent.click(modalConfirmBtn);

    await waitFor(() => {
      expect(instructorClient.updateProfile).toHaveBeenCalledWith(
        'inst-1',
        expect.objectContaining({
          displayName: 'Coach Devi',
          phoneE164: '+628999888777',
          expectedVersion: 3,
        }),
      );
    });
  });

  it('allows editing bank details and payroll info in the drawer', async () => {
    render(
      <AppFeedbackProvider>
        <InstructorDetailView id="inst-1" />
      </AppFeedbackProvider>,
    );

    await userEvent.click(await screen.findByRole('button', { name: 'Edit Profil' }));

    const bankInput = screen.getByLabelText(/Nama Bank/i);
    const accInput = screen.getByLabelText(/Nomor Rekening/i);
    const holderInput = screen.getByLabelText(/Atas Nama Pemilik Rekening/i);

    await userEvent.type(bankInput, 'BCA');
    await userEvent.type(accInput, '1234567890');
    await userEvent.type(holderInput, 'Devi Permata');

    const submitBtn = screen.getByRole('button', { name: 'Simpan Perubahan' });
    await userEvent.click(submitBtn);

    const confirmButtons = screen.getAllByRole('button', { name: 'Simpan Perubahan' });
    await userEvent.click(confirmButtons[confirmButtons.length - 1]!);

    await waitFor(() => {
      expect(instructorClient.updateProfile).toHaveBeenCalledWith(
        'inst-1',
        expect.objectContaining({
          bankInfo: {
            bankName: 'BCA',
            accountNumber: '1234567890',
            accountHolder: 'Devi Permata',
          },
        }),
      );
    });
  });

  it('handles status toggle (Nonaktifkan / Aktifkan)', async () => {
    render(
      <AppFeedbackProvider>
        <InstructorDetailView id="inst-1" />
      </AppFeedbackProvider>,
    );

    const toggleBtn = await screen.findByRole('button', { name: 'Nonaktifkan' });
    await userEvent.click(toggleBtn);

    // Confirmation dialog appears
    expect(await screen.findByText('Nonaktifkan instruktur?')).toBeVisible();
    const confirmButtons = screen.getAllByRole('button', { name: 'Nonaktifkan' });
    const modalConfirmBtn = confirmButtons[confirmButtons.length - 1]!;
    await userEvent.click(modalConfirmBtn);

    await waitFor(() => {
      expect(instructorClient.toggleStatus).toHaveBeenCalledWith('inst-1', 'deactivate', 3);
    });
  });
});

describe('InstructorDetailView honor and blockers', () => {
  const renderDetail = (detail: InstructorDetail) => {
    vi.spyOn(instructorClient, 'detail').mockResolvedValue(detail);
    return render(
      <AppFeedbackProvider>
        <InstructorDetailView id="inst-1" />
      </AppFeedbackProvider>,
    );
  };

  it('shows this month\'s honor, the unverified part and each completed class\'s amount', async () => {
    renderDetail({
      ...mockDetail,
      compensationRp: 2400000,
      unverifiedCompensationRp: 600000,
      instructedClassSlots: [{ ...mockDetail.instructedClassSlots[0]!, status: 'COMPLETED' }],
    });
    expect(await screen.findByText('Honor Bulan Ini (kelas selesai)')).toBeVisible();
    expect(screen.getByText(/2\.400\.000/)).toBeVisible();
    expect(screen.getByText(/600\.000 belum terverifikasi/)).toBeVisible();
    expect(screen.getByText(/150\.000/)).toBeVisible();
  });

  it('shows a dash with an explanation instead of Rp 0 without honor access', async () => {
    renderDetail({ ...mockDetail, compensationRp: null, unverifiedCompensationRp: null });
    await screen.findByText('Honor Bulan Ini (kelas selesai)');
    expect(screen.getByText(/hanya untuk peran dengan akses honor/)).toBeVisible();
    expect(screen.queryByText(/Rp\s?0/)).toBeNull();
  });

  it('warns about this month\'s missing attendance and unconfigured fees, and confirms when complete', async () => {
    const { unmount } = renderDetail({
      ...mockDetail,
      blockers: { completedWithoutCheckIn: 2, completedWithoutFee: 1 },
    });
    expect(await screen.findByText(/Bulan ini ada 2 kelas selesai tanpa presensi instruktur/)).toBeVisible();
    expect(screen.getByText(/1 kelas memakai fee bawaan/)).toBeVisible();
    unmount();

    renderDetail(mockDetail);
    expect(await screen.findByText(/sudah lengkap/)).toBeVisible();
  });
});

