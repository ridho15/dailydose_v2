import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WalkInDrawer } from './walk-in-drawer';
import { AppFeedbackProvider } from '../components/app-feedback';
import type { ClassSlot, ClassWorkspace } from '../api-clients/class-slot-client';

const branch = { id: 'branch-1', name: 'Sudirman Studio', timezone: 'Asia/Jakarta' };
const now = new Date('2026-10-30T10:00:00Z');

const mockSlots: ClassSlot[] = [
  {
    id: 'slot-1',
    branchId: 'branch-1',
    classTypeId: 'ct-1',
    studioId: 'std-1',
    instructorUserId: 'inst-1',
    startAt: new Date('2026-10-30T10:30:00Z'),
    endAt: new Date('2026-10-30T11:30:00Z'),
    capacity: 6,
    bookedCount: 2,
    minimumQuota: 1,
    status: 'PUBLISHED',
    timezone: 'Asia/Jakarta',
    version: 1,
  },
  {
    id: 'slot-full',
    branchId: 'branch-1',
    classTypeId: 'ct-1',
    studioId: 'std-1',
    instructorUserId: 'inst-1',
    startAt: new Date('2026-10-30T12:00:00Z'),
    endAt: new Date('2026-10-30T13:00:00Z'),
    capacity: 4,
    bookedCount: 4,
    minimumQuota: 1,
    status: 'PUBLISHED',
    timezone: 'Asia/Jakarta',
    version: 1,
  },
];

const mockWorkspace: ClassWorkspace = {
  slots: mockSlots,
  studios: [{ id: 'std-1', branchId: 'branch-1', code: 'STD-A', name: 'Studio Reformer A', rooms: [] }],
  classTypes: [{ id: 'ct-1', code: 'REF-INTRO', name: 'Reformer Intro' }],
  instructors: [{ id: 'inst-1', displayName: 'Coach Bella' }],
};

const mockPackages = [
  {
    id: 'pkg-1',
    branchId: 'branch-1',
    name: 'Walk-In Single Visit',
    priceRp: 150_000,
    sessionCount: 1,
    durationDays: 1,
    status: 'ACTIVE' as const,
    classTypeId: null,
    isMultiBranch: false,
    effectiveFrom: new Date(),
    effectiveUntil: null,
  },
  {
    id: 'pkg-2',
    branchId: 'branch-1',
    name: 'Intro 4 Sessions',
    priceRp: 550_000,
    sessionCount: 4,
    durationDays: 30,
    status: 'ACTIVE' as const,
    classTypeId: null,
    isMultiBranch: false,
    effectiveFrom: new Date(),
    effectiveUntil: null,
  },
];

describe('WalkInDrawer (Fase 3: Alur Cepat Walk-In & Booking Kasir)', () => {
  let mockBookingClient: any;
  let mockAssistedSaleClient: any;
  let mockCustomerApi: any;
  let onClose: () => void;
  let onSuccess: () => void;

  beforeEach(() => {
    onClose = vi.fn();
    onSuccess = vi.fn();
    mockBookingClient = {
      walkIn: vi.fn().mockResolvedValue({
        booking: { id: 'bkg-1', status: 'BOOKED', source: 'ADMIN_ASSISTED', createdAt: new Date() },
        purchase: { id: 'pur-1', invoiceNumber: 'INV-123', status: 'PENDING', totalAmountRp: 150_000 },
        customerPackage: { id: 'cp-1', remainingSessions: 1, validUntil: '2026-11-30' },
      }),
    };
    mockAssistedSaleClient = {
      searchPackages: vi.fn().mockResolvedValue(mockPackages),
    };
    mockCustomerApi = {
      create: vi.fn().mockResolvedValue({ id: 'cust-123', displayName: 'Dewi Lestari' }),
      list: vi.fn().mockResolvedValue({ items: [], page: {} }),
    };
  });

  it('renders step 1 (Data Member) by default and validates required fields', async () => {
    render(
      <AppFeedbackProvider><WalkInDrawer
        open
        onClose={onClose}
        branch={branch}
        slots={mockSlots}
        workspace={mockWorkspace}
        bookingClient={mockBookingClient}
        assistedSaleClient={mockAssistedSaleClient}
        customerApi={mockCustomerApi}
        now={now}
      /></AppFeedbackProvider>,
    );

    expect(screen.getByText('Alur Cepat Walk-In & Booking Kasir')).toBeInTheDocument();
    expect(screen.getByTestId('walkin-step-1')).toBeInTheDocument();

    const nextBtn = screen.getByRole('button', { name: /Lanjut ke Langkah 2/i });
    expect(nextBtn).toBeDisabled();

    // Type short name
    const nameInput = screen.getByLabelText(/Nama Lengkap Member/i);
    await userEvent.type(nameInput, 'A');
    expect(screen.getByText('Nama member minimal 2 karakter.')).toBeInTheDocument();
    expect(nextBtn).toBeDisabled();

    // Complete valid name
    await userEvent.type(nameInput, 'li');

    // Type invalid phone
    const phoneInput = screen.getByLabelText(/Nomor WhatsApp/i);
    await userEvent.type(phoneInput, '123');
    expect(screen.getByText('Nomor WhatsApp belum valid (minimal 9 digit angka).')).toBeInTheDocument();
    expect(nextBtn).toBeDisabled();

    // Complete valid phone
    await userEvent.clear(phoneInput);
    await userEvent.type(phoneInput, '081234567890');

    // Now step 1 is valid
    expect(screen.queryByText('Nomor WhatsApp belum valid (minimal 9 digit angka).')).not.toBeInTheDocument();
    expect(nextBtn).toBeEnabled();
  });

  it('navigates through steps 1 -> 2 -> 3 and completes walk-in with Instant Reserve', async () => {
    render(
      <AppFeedbackProvider><WalkInDrawer
        open
        onClose={onClose}
        branch={branch}
        slots={mockSlots}
        workspace={mockWorkspace}
        bookingClient={mockBookingClient}
        assistedSaleClient={mockAssistedSaleClient}
        customerApi={mockCustomerApi}
        onSuccess={onSuccess}
        now={now}
      /></AppFeedbackProvider>,
    );

    // Step 1: Fill Member Data
    await userEvent.type(screen.getByLabelText(/Nama Lengkap Member/i), 'Dewi Lestari');
    await userEvent.type(screen.getByLabelText(/Nomor WhatsApp/i), '081234567890');
    await userEvent.click(screen.getByRole('button', { name: /Lanjut ke Langkah 2/i }));

    // Step 2: Slot Selection
    await waitFor(() => {
      expect(screen.getByTestId('walkin-step-2')).toBeInTheDocument();
    });

    // Check that full slot is disabled
    expect(screen.getByText('Penuh')).toBeInTheDocument();
    expect(screen.getByText('Tersisa 4 kursi')).toBeInTheDocument();

    // Select available slot
    const slotCard = screen.getByRole('button', { name: /Tersisa 4 kursi/i });
    await userEvent.click(slotCard);

    // Proceed to Step 3
    const nextBtnStep2 = screen.getByRole('button', { name: /Lanjut ke Langkah 3/i });
    expect(nextBtnStep2).toBeEnabled();
    await userEvent.click(nextBtnStep2);

    // Step 3: Package & Cashier
    await waitFor(() => {
      expect(screen.getByTestId('walkin-step-3')).toBeInTheDocument();
    });

    expect(screen.getByText('Pilih Paket & Kasir Studio')).toBeInTheDocument();
    expect(screen.getByText(/Instant Reserve Sesi Pertama & Rekap Kasir/i)).toBeInTheDocument();

    // Select EDC Payment Method
    await userEvent.click(screen.getByRole('button', { name: /Kartu \(EDC\)/i }));

    // Submit Walk-in
    const submitBtn = screen.getByRole('button', { name: /Konfirmasi Walk-In & Ikut Kelas/i });
    expect(submitBtn).toBeEnabled();
    await userEvent.click(submitBtn);

    // Verifications
    await waitFor(() => {
      // 1. Customer registration called
      expect(mockCustomerApi.create).toHaveBeenCalledWith(
        expect.objectContaining({
          displayName: 'Dewi Lestari',
          phoneE164: '+6281234567890',
          preferredBranchId: 'branch-1',
        }),
        expect.any(Object),
      );

      // 2. Booking walk-in called with instant reserve
      expect(mockBookingClient.walkIn).toHaveBeenCalledWith(
        expect.objectContaining({
          branchId: 'branch-1',
          classSlotId: 'slot-1',
          customerUserId: 'cust-123',
          packageId: 'pkg-1',
          paymentMethod: 'CARD',
        }),
        expect.any(String),
      );

      expect(onSuccess).toHaveBeenCalled();
      expect(onClose).toHaveBeenCalled();
    });
  });

  it('handles CLASS_CAPACITY_FULL error and redirects user back to step 2', async () => {
    mockBookingClient.walkIn.mockRejectedValueOnce({
      code: 'CLASS_CAPACITY_FULL',
      message: 'Kapasitas kelas penuh.',
    });

    render(
      <AppFeedbackProvider><WalkInDrawer
        open
        onClose={onClose}
        branch={branch}
        slots={mockSlots}
        workspace={mockWorkspace}
        bookingClient={mockBookingClient}
        assistedSaleClient={mockAssistedSaleClient}
        customerApi={mockCustomerApi}
        now={now}
      /></AppFeedbackProvider>,
    );

    // Step 1
    await userEvent.type(screen.getByLabelText(/Nama Lengkap Member/i), 'Dewi Lestari');
    await userEvent.type(screen.getByLabelText(/Nomor WhatsApp/i), '081234567890');
    await userEvent.click(screen.getByRole('button', { name: /Lanjut ke Langkah 2/i }));

    // Step 2
    await waitFor(() => expect(screen.getByTestId('walkin-step-2')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: /Tersisa 4 kursi/i }));
    await userEvent.click(screen.getByRole('button', { name: /Lanjut ke Langkah 3/i }));

    // Step 3
    await waitFor(() => expect(screen.getByTestId('walkin-step-3')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: /Konfirmasi Walk-In & Ikut Kelas/i }));

    // Assert error message and redirected back to step 2
    await waitFor(() => {
      expect(
        screen.getByText('Kapasitas kelas telah penuh. Silakan pilih jadwal kelas lain hari ini.'),
      ).toBeInTheDocument();
      expect(screen.getByTestId('walkin-step-2')).toBeInTheDocument();
    });
  });

  it('handles IDENTITY_CONFLICT when member phone is already registered', async () => {
    mockCustomerApi.create.mockRejectedValueOnce({
      code: 'IDENTITY_CONFLICT',
      message: 'Already registered',
    });

    render(
      <AppFeedbackProvider><WalkInDrawer
        open
        onClose={onClose}
        branch={branch}
        slots={mockSlots}
        workspace={mockWorkspace}
        bookingClient={mockBookingClient}
        assistedSaleClient={mockAssistedSaleClient}
        customerApi={mockCustomerApi}
        now={now}
      /></AppFeedbackProvider>,
    );

    // Step 1
    await userEvent.type(screen.getByLabelText(/Nama Lengkap Member/i), 'Dewi Lestari');
    await userEvent.type(screen.getByLabelText(/Nomor WhatsApp/i), '081234567890');
    await userEvent.click(screen.getByRole('button', { name: /Lanjut ke Langkah 2/i }));

    // Step 2
    await waitFor(() => expect(screen.getByTestId('walkin-step-2')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: /Tersisa 4 kursi/i }));
    await userEvent.click(screen.getByRole('button', { name: /Lanjut ke Langkah 3/i }));

    // Step 3
    await waitFor(() => expect(screen.getByTestId('walkin-step-3')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: /Konfirmasi Walk-In & Ikut Kelas/i }));

    // Assert error message and kept on step 1
    await waitFor(() => {
      expect(
        screen.getByText(
          'Nomor WhatsApp atau email ini sudah terdaftar sebagai member. Silakan gunakan opsi "Member Sudah Terdaftar" untuk mencari namanya.',
        ),
      ).toBeInTheDocument();
      expect(screen.getByTestId('walkin-step-1')).toBeInTheDocument();
    });
  });
});
