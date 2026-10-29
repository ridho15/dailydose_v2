import { render as rtlRender, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { describe, expect, it, vi } from 'vitest';
import { ClassSlotView } from '@/classes/class-slot-view';
import type { ClassSlotClient } from '@/api-clients/class-slot-client';
import type { BookingClient, BookingPage } from '@/api-clients/booking-client';
import { AppFeedbackProvider } from '@/components/app-feedback';
import QRCode from 'qrcode';

vi.mock('qrcode', () => ({ default: { toCanvas: vi.fn().mockResolvedValue(undefined) } }));

const mockDeletability = vi.fn();
const mockRemove = vi.fn();
vi.mock('@/api-clients/lifecycle-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api-clients/lifecycle-client')>();
  return {
    ...actual,
    lifecycleClient: {
      deletability: (...args: unknown[]) => mockDeletability(...args),
      remove: (...args: unknown[]) => mockRemove(...args),
      archive: vi.fn(),
    },
  };
});

// Keep operational fixtures relative to execution time so the seven-day agenda remains relevant.
const now = new Date();
now.setHours(10, 0, 0, 0);
const slot = {
  id: 'slot-1',
  branchId: 'branch-1',
  classTypeId: 'type-1',
  instructorUserId: 'instructor-1',
  startAt: new Date(now.getTime() + 60 * 60 * 1000),
  endAt: new Date(now.getTime() + 2 * 60 * 60 * 1000),
  timezone: 'Asia/Jakarta',
  status: 'DRAFT' as const,
  minimumQuota: 2,
  capacity: 8,
  bookedCount: 1,
  cancellationReasonCode: null,
  version: 0,
  idempotentReplay: false,
};
const branch = { id: 'branch-1', name: 'Jakarta', timezone: 'Asia/Jakarta' };
const workspace = {
  slots: [slot],
  classTypes: [{ id: 'type-1', code: 'REF', name: 'Reformer' }],
  instructors: [{ id: 'instructor-1', displayName: 'Ayu Instructor' }],
  studios: [
    {
      id: 'studio-1',
      branchId: 'branch-1',
      code: 'MAIN',
      name: 'Area Studio Utama',
      rooms: [],
    },
  ],
};
const fake = (overrides: Partial<ClassSlotClient> = {}): ClassSlotClient => ({
  discover: vi.fn().mockResolvedValue(workspace),
  create: vi.fn().mockResolvedValue(slot),
  update: vi.fn().mockResolvedValue({ ...slot, version: 1 }),
  assign: vi.fn().mockResolvedValue({ ...slot, version: 1 }),
  publish: vi.fn().mockResolvedValue({ ...slot, status: 'PUBLISHED', version: 1 }),
  cancel: vi.fn().mockResolvedValue({ ...slot, status: 'CANCELLED', version: 1 }),
  completionControl: vi.fn().mockResolvedValue({
    classSlotId: slot.id,
    expectedVersion: slot.version,
    controlHash: 'a'.repeat(64),
    attendanceCount: 1,
    noShowCount: 0,
    activeReservationCount: 1,
  }),
  complete: vi.fn().mockResolvedValue({
    classSlotId: slot.id,
    status: 'COMPLETED',
    attendanceCount: 1,
    noShowCount: 0,
    releasedReservationIds: [],
    ledgerEntryIds: ['ledger-1'],
    hourLogIds: [],
    auditLogId: 'audit-1',
    outboxEventIds: ['outbox-1'],
    completedAt: new Date(),
    idempotentReplay: false,
  }),
  ...overrides,
});
const readCapabilities = ['class-slot:read'] as const;
const manageCapabilities = ['class-slot:read', 'class-slot:manage', 'attendance:manage'] as const;
const render = (view: React.ReactNode) =>
  rtlRender(<AppFeedbackProvider>{view}</AppFeedbackProvider>);

describe('ClassSlotView', () => {
  it('defaults to deny when no authoritative capability is available', () => {
    const client = fake();
    render(<ClassSlotView client={client} branchOverride={branch} />);
    expect(screen.getByRole('alert')).toHaveTextContent('class-slot:read');
    expect(client.discover).not.toHaveBeenCalled();
  });

  it('keeps an Owner-style read capability in read-only mode', async () => {
    render(
      <ClassSlotView
        client={fake()}
        branchOverride={branch}
        capabilitiesOverride={readCapabilities}
      />,
    );
    expect(screen.getByText(/Akses Anda hanya untuk melihat/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Buat kelas' })).toBeDisabled();
  });

  it('shows the instructor and class names sent with the slot instead of id fragments', async () => {
    const named = {
      ...slot,
      instructorUserId: 'a45ec6c1-0000-4000-8000-000000000000',
      instructor: { displayName: 'Sarah Coach' },
      classType: { name: 'Reformer Pilates' },
    };
    render(
      <ClassSlotView
        client={fake({ discover: vi.fn().mockResolvedValue({ ...workspace, slots: [named] }) })}
        branchOverride={branch}
        capabilitiesOverride={readCapabilities}
      />,
    );
    expect((await screen.findAllByText('Sarah Coach')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Reformer Pilates').length).toBeGreaterThan(0);
  });

  it('never prints an id fragment when the instructor is not in the loaded lists', async () => {
    const orphan = { ...slot, instructorUserId: 'a45ec6c1-0000-4000-8000-000000000000' };
    const view = render(
      <ClassSlotView
        client={fake({ discover: vi.fn().mockResolvedValue({ ...workspace, slots: [orphan] }) })}
        branchOverride={branch}
        capabilitiesOverride={readCapabilities}
      />,
    );
    expect((await screen.findAllByText('Instruktur belum dimuat')).length).toBeGreaterThan(0);
    expect(view.container).not.toHaveTextContent('a45ec6c1');
  });

  it('requires an explicit authoritative branch for a branch-scoped reader', () => {
    render(<ClassSlotView client={fake()} capabilitiesOverride={readCapabilities} />);
    expect(
      screen.getByText('Pilih cabang aktif untuk membuka timetable sesuai cakupan Anda.'),
    ).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Muat timetable' })).not.toBeInTheDocument();
  });

  it('loads a Super Owner global overview without selecting a branch', async () => {
    const client = fake();
    render(
      <ClassSlotView
        client={client}
        branchesOverride={[branch]}
        capabilitiesOverride={['class-slot:read', 'class-slot:manage', 'branch:all']}
      />,
    );
    expect(await screen.findByText(/Menampilkan semua cabang/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Buat kelas' })).toBeEnabled();
    expect(client.discover).toHaveBeenCalledWith(expect.objectContaining({ branchId: undefined }));
  });

  it('discovers labels, renders seven days, and publishes authoritative slot accessibly', async () => {
    const client = fake();
    const view = render(
      <ClassSlotView
        client={client}
        branchOverride={branch}
        capabilitiesOverride={manageCapabilities}
      />,
    );
    const user = userEvent.setup();
    const calendar = screen.getByRole('region', { name: 'Kalender kelas tujuh hari' });
    expect(await within(calendar).findByText('Reformer')).toBeInTheDocument();
    expect(calendar).toBeVisible();
    expect(screen.getAllByRole('heading', { level: 2 }).length).toBeGreaterThanOrEqual(7);
    await user.click(within(calendar).getByRole('button', { name: /Reformer/ }));
    const dialog = screen.getByRole('dialog', { name: 'Reformer' });
    expect(within(dialog).getAllByText('Ayu Instructor')[0]).toBeVisible();
    await user.click(within(dialog).getByRole('button', { name: 'Publikasikan kelas' }));
    await user.click(screen.getByRole('button', { name: 'Publikasikan' }));
    expect(client.publish).toHaveBeenCalledWith('slot-1', 0);
    expect(await screen.findByText('Kelas berhasil dipublikasikan.')).toBeVisible();
    const accessibility = await axe(view.container);
    expect(
      accessibility.violations,
      accessibility.violations
        .map(({ id, nodes }) => `${id}: ${nodes[0]?.failureSummary}`)
        .join('\n'),
    ).toHaveLength(0);
  });

  it('creates a draft from branch-local fields without technical IDs', async () => {
    const client = fake({ discover: vi.fn().mockResolvedValue({ ...workspace, slots: [] }) });
    render(
      <ClassSlotView
        client={client}
        branchOverride={branch}
        capabilitiesOverride={manageCapabilities}
      />,
    );
    const user = userEvent.setup();
    await screen.findByText('Belum ada kelas pada minggu ini');
    await user.click(screen.getByRole('button', { name: 'Buat kelas' }));
    const dialog = screen.getByRole('dialog', { name: 'Buat draft kelas' });
    const classType = within(dialog).getByRole('combobox', { name: /Tipe kelas/ });
    await user.click(classType);
    await user.click(within(dialog).getByRole('option', { name: /Reformer/ }));
    const studio = within(dialog).getByRole('combobox', { name: /Area Studio/ });
    await user.click(studio);
    await user.click(within(dialog).getByRole('option', { name: /Area Studio Utama/ }));
    const instructor = within(dialog).getByRole('combobox', { name: /Instruktur/ });
    await user.click(instructor);
    await user.click(within(dialog).getByRole('option', { name: /Ayu Instructor/ }));
    await user.type(within(dialog).getByLabelText('Tanggal'), '2026-07-27');
    await user.type(within(dialog).getByLabelText('Mulai'), '09:00');
    await user.type(within(dialog).getByLabelText('Selesai eksklusif'), '10:00');
    // Fee instruktur diatur di Data Master, bukan di jadwal; admin tidak melihat nominal apa pun.
    expect(within(dialog).queryByLabelText(/Honor|Modal|Fee/i)).toBeNull();
    await user.click(within(dialog).getByRole('button', { name: 'Buat draft' }));
    await user.click(
      within(screen.getByRole('dialog', { name: 'Buat draft kelas?' })).getByRole('button', {
        name: 'Buat draft',
      }),
    );
    expect(client.create).toHaveBeenCalledWith(
      expect.objectContaining({
        branchId: 'branch-1',
        classTypeId: 'type-1',
        studioId: 'studio-1',
        instructorUserId: 'instructor-1',
        startAt: new Date('2026-07-27T02:00:00.000Z'),
        endAt: new Date('2026-07-27T03:00:00.000Z'),
      }),
    );
    expect(vi.mocked(client.create).mock.calls[0]![0]).not.toHaveProperty('instructorFeeRp');
  });

  it('keeps the create form open with its input when saving fails (e.g. a schedule clash)', async () => {
    const client = fake({
      discover: vi.fn().mockResolvedValue({ ...workspace, slots: [] }),
      create: vi.fn().mockRejectedValue({
        status: 409,
        data: {
          error: {
            code: 'INSTRUCTOR_SCHEDULE_COLLISION',
            details: [{ issue: 'Private Group, Jum 30 Okt 09.00 sampai 09.50, Daily Dose Muara Karang' }],
          },
        },
      }),
    });
    render(
      <ClassSlotView client={client} branchOverride={branch} capabilitiesOverride={manageCapabilities} />,
    );
    const user = userEvent.setup();
    await screen.findByText('Belum ada kelas pada minggu ini');
    await user.click(screen.getByRole('button', { name: 'Buat kelas' }));
    const dialog = screen.getByRole('dialog', { name: 'Buat draft kelas' });
    await user.click(within(dialog).getByRole('combobox', { name: /Tipe kelas/ }));
    await user.click(within(dialog).getByRole('option', { name: /Reformer/ }));
    await user.click(within(dialog).getByRole('combobox', { name: /Area Studio/ }));
    await user.click(within(dialog).getByRole('option', { name: /Area Studio Utama/ }));
    await user.type(within(dialog).getByLabelText('Tanggal'), '2026-07-27');
    await user.type(within(dialog).getByLabelText('Mulai'), '09:00');
    await user.type(within(dialog).getByLabelText('Selesai eksklusif'), '10:00');
    await user.click(within(dialog).getByRole('button', { name: 'Buat draft' }));
    await user.click(
      within(screen.getByRole('dialog', { name: 'Buat draft kelas?' })).getByRole('button', {
        name: 'Buat draft',
      }),
    );
    const formulir = await screen.findByRole('dialog', { name: 'Buat draft kelas' });
    expect(within(formulir).getByText(/Kelas belum tersimpan\. Instruktur ini sudah mengajar/)).toBeVisible();
    expect(within(formulir).getByLabelText('Tanggal')).toHaveValue('2026-07-27');
  });

  it('edits only a draft, guarded by status, with an optional reason', async () => {
    const client = fake();
    render(
      <ClassSlotView
        client={client}
        branchOverride={branch}
        capabilitiesOverride={manageCapabilities}
      />,
    );
    const user = userEvent.setup();
    await screen.findAllByText('Reformer');
    await user.click(
      within(screen.getByRole('region', { name: 'Kalender kelas tujuh hari' })).getByRole(
        'button',
        { name: /Reformer/ },
      ),
    );
    const dialog = screen.getByRole('dialog', { name: 'Reformer' });
    await user.click(within(dialog).getByRole('button', { name: 'Edit kelas' }));
    const form = within(dialog).getByRole('form', { name: 'Edit draft kelas' });
    await user.type(within(form).getByLabelText('Alasan perubahan (opsional)'), 'Penyesuaian jadwal studio');
    await user.click(within(form).getByRole('button', { name: 'Simpan perubahan kelas' }));
    await user.click(
      within(screen.getByRole('dialog', { name: 'Simpan perubahan kelas?' })).getByRole('button', {
        name: 'Simpan perubahan',
      }),
    );
    expect(client.update).toHaveBeenCalledWith(
      'slot-1',
      expect.objectContaining({
        classTypeId: 'type-1',
        instructorUserId: 'instructor-1',
        reason: 'Penyesuaian jadwal studio',
      }),
    );
    // Perubahan draf dijaga status kelas, bukan nomor versi.
    expect((client.update as ReturnType<typeof vi.fn>).mock.calls[0]![1]).not.toHaveProperty('expectedVersion');
  });

  it('renders safe configuration failure', async () => {
    const client = fake({ discover: vi.fn().mockRejectedValue({ response: { status: 503 } }) });
    render(
      <ClassSlotView
        client={client}
        branchOverride={branch}
        capabilitiesOverride={manageCapabilities}
      />,
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('Konfigurasi quota atau capacity');
  });

  it('loads a capability-scoped roster for the selected class slot', async () => {
    const rosterPage = {
      items: [
        {
          id: 'booking-1',
          status: 'BOOKED',
          customer: {
            id: 'customer-1',
            displayName: 'Customer Demo',
            phoneMasked: '+62••••1234',
          },
          package: { id: 'package-1', name: 'Reformer 10' },
          sessionBalance: { ledgerBalance: 8, reserved: 1, available: 7 },
        },
      ],
      summary: {
        total: 1,
        booked: 1,
        reschedulePending: 0,
        attended: 0,
        cancelled: 0,
        noShow: 0,
      },
      nextCursor: null,
    } as unknown as BookingPage;
    const bookingClient: Pick<BookingClient, 'list'> = {
      list: vi.fn().mockResolvedValue(rosterPage),
    };
    render(
      <ClassSlotView
        client={fake()}
        bookingClient={bookingClient}
        branchOverride={branch}
        capabilitiesOverride={[...manageCapabilities, 'booking:read']}
      />,
    );
    const user = userEvent.setup();
    await screen.findAllByText('Reformer');
    await user.click(
      within(screen.getByRole('region', { name: 'Kalender kelas tujuh hari' })).getByRole(
        'button',
        { name: /Reformer/ },
      ),
    );
    // Menekan kelas menampilkan pesertanya di bawah kalender, seperti mockup.
    const panel = await screen.findByRole('dialog', { name: 'Reformer' });
    expect(await within(panel).findByText('Customer Demo')).toBeVisible();
    expect(within(panel).getByText('Sisa 7 sesi')).toBeVisible();
    // Pengaturan kelas lengkap tetap ada, satu ketuk lagi lewat "Atur kelas".
    await user.click(within(panel).getByRole('button', { name: 'Atur kelas' }));
    const dialog = screen.getByRole('dialog', { name: 'Reformer' });
    expect((await within(dialog).findAllByText('Customer Demo')).length).toBeGreaterThan(0);
    expect(within(dialog).getAllByText('+62••••1234').length).toBeGreaterThan(0);
    expect(within(dialog).getAllByText(/7 sesi tersedia/).length).toBeGreaterThan(0);
    expect(bookingClient.list).toHaveBeenCalledWith(
      expect.objectContaining({ classSlotId: 'slot-1', limit: 10 }),
    );
  });

  it('cancels with the controlled reason and authoritative version', async () => {
    const client = fake();
    render(
      <ClassSlotView
        client={client}
        branchOverride={branch}
        capabilitiesOverride={manageCapabilities}
      />,
    );
    const user = userEvent.setup();
    await screen.findAllByText('Reformer');
    await user.click(
      within(screen.getByRole('region', { name: 'Kalender kelas tujuh hari' })).getByRole(
        'button',
        { name: /Reformer/ },
      ),
    );
    const dialog = screen.getByRole('dialog', { name: 'Reformer' });
    await user.selectOptions(
      within(dialog).getByLabelText('Alasan pembatalan'),
      'INSTRUCTOR_UNAVAILABLE',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Batalkan kelas ini' }));
    await user.click(screen.getByRole('button', { name: 'Batalkan kelas' }));
    expect(client.cancel).toHaveBeenCalledWith('slot-1', 'INSTRUCTOR_UNAVAILABLE', 0, undefined);
    expect(await screen.findByText('Kelas berhasil dibatalkan.')).toBeVisible();
  });

  it('asks for a written note when the cancellation reason is "other" and sends it', async () => {
    const client = fake();
    render(
      <ClassSlotView
        client={client}
        branchOverride={branch}
        capabilitiesOverride={manageCapabilities}
      />,
    );
    const user = userEvent.setup();
    await screen.findAllByText('Reformer');
    await user.click(
      within(screen.getByRole('region', { name: 'Kalender kelas tujuh hari' })).getByRole(
        'button',
        { name: /Reformer/ },
      ),
    );
    const dialog = screen.getByRole('dialog', { name: 'Reformer' });
    await user.selectOptions(within(dialog).getByLabelText('Alasan pembatalan'), 'OTHER_REVIEW_REQUIRED');
    const cancel = within(dialog).getByRole('button', { name: 'Batalkan kelas ini' });
    expect(cancel).toBeDisabled();
    await user.type(within(dialog).getByLabelText('Jelaskan alasan pembatalan'), 'Pipa bocor');
    expect(cancel).toBeEnabled();
    await user.click(cancel);
    await user.click(screen.getByRole('button', { name: 'Batalkan kelas' }));
    expect(client.cancel).toHaveBeenCalledWith('slot-1', 'OTHER_REVIEW_REQUIRED', 0, 'Pipa bocor');
  });
});

describe('ClassSlotView instructor attendance verification', () => {
  const confirmedSlot = { ...slot, status: 'CONFIRMED' as const };
  const openDetail = async (client: ClassSlotClient, capabilities: readonly string[]) => {
    render(
      <ClassSlotView
        client={client}
        branchOverride={branch}
        capabilitiesOverride={capabilities}
      />,
    );
    const user = userEvent.setup();
    const calendar = screen.getByRole('region', { name: 'Kalender kelas tujuh hari' });
    await within(calendar).findByText('Reformer');
    await user.click(within(calendar).getByRole('button', { name: /Reformer/ }));
    return { user, dialog: screen.getByRole('dialog', { name: 'Reformer' }) };
  };
  const withSlot = (over: Record<string, unknown>, extra: Partial<ClassSlotClient> = {}) =>
    fake({
      discover: vi.fn().mockResolvedValue({ ...workspace, slots: [{ ...confirmedSlot, ...over }] }),
      ...extra,
    });

  it('lets staff with attendance:manage verify a missing instructor attendance after confirming', async () => {
    const verify = vi.fn().mockResolvedValue({
      classSlotId: slot.id,
      checkedInAt: new Date().toISOString(),
      method: 'MANUAL_FRONTDESK',
      alreadyRecorded: false,
    });
    const client = withSlot({}, { verifyInstructorAttendance: verify });
    const { user, dialog } = await openDetail(client, manageCapabilities);

    expect(within(dialog).getByText(/Belum tercatat/)).toBeVisible();
    await user.type(within(dialog).getByLabelText('Catatan (opsional)'), 'lupa scan');
    await user.click(within(dialog).getByRole('button', { name: 'Verifikasi presensi instruktur' }));
    await user.click(
      within(screen.getByRole('dialog', { name: 'Verifikasi presensi instruktur?' })).getByRole(
        'button',
        { name: 'Verifikasi' },
      ),
    );

    expect(verify).toHaveBeenCalledWith('slot-1', 'lupa scan');
    expect(await screen.findByText('Presensi instruktur berhasil dicatat.')).toBeVisible();
    expect(await within(dialog).findByText(/verifikasi manual admin/)).toBeVisible();
    expect(within(dialog).queryByRole('button', { name: 'Verifikasi presensi instruktur' })).toBeNull();
  });

  it('shows already recorded attendance without offering to verify again', async () => {
    const client = withSlot(
      { instructorAttendance: { checkedInAt: new Date().toISOString(), method: 'QR_SCAN' } },
      { verifyInstructorAttendance: vi.fn() },
    );
    const { dialog } = await openDetail(client, manageCapabilities);
    expect(within(dialog).getByText(/melalui scan QR/)).toBeVisible();
    expect(within(dialog).queryByRole('button', { name: 'Verifikasi presensi instruktur' })).toBeNull();
  });

  it('shows the status but hides the verify action without attendance:manage', async () => {
    const client = withSlot({}, { verifyInstructorAttendance: vi.fn() });
    const { dialog } = await openDetail(client, ['class-slot:read', 'class-slot:manage']);
    expect(within(dialog).getByText(/Belum tercatat/)).toBeVisible();
    expect(within(dialog).queryByRole('button', { name: 'Verifikasi presensi instruktur' })).toBeNull();
  });

  it('surfaces a clear message when attendance is recorded before the check-in window opens', async () => {
    const verify = vi.fn().mockRejectedValue({ status: 409, data: { error: { code: 'CHECK_IN_TOO_EARLY' } } });
    const client = withSlot({}, { verifyInstructorAttendance: verify });
    const { user, dialog } = await openDetail(client, manageCapabilities);
    await user.click(within(dialog).getByRole('button', { name: 'Verifikasi presensi instruktur' }));
    await user.click(
      within(screen.getByRole('dialog', { name: 'Verifikasi presensi instruktur?' })).getByRole(
        'button',
        { name: 'Verifikasi' },
      ),
    );
    expect(
      await screen.findByText('Presensi baru dapat dicatat mulai 30 menit sebelum kelas dimulai.'),
    ).toBeVisible();
  });
});

describe('ClassSlotView instructor check-in QR for studio staff', () => {
  const confirmedSlot = { ...slot, status: 'CONFIRMED' as const };
  const issue = {
    id: 'tok-1',
    resourceId: slot.id,
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    qrPayload: 'dd-checkin:v1:raw-token',
    className: 'Reformer',
    branch: { code: 'JKT', name: 'Jakarta' },
    startAt: confirmedSlot.startAt,
    endAt: confirmedSlot.endAt,
  };
  const open = async (
    over: Record<string, unknown>,
    bookingClient: Pick<BookingClient, 'list'> & Partial<Pick<BookingClient, 'issueInstructorCheckIn'>>,
    capabilities: readonly string[] = manageCapabilities,
  ) => {
    const client = fake({
      discover: vi.fn().mockResolvedValue({ ...workspace, slots: [{ ...confirmedSlot, ...over }] }),
    });
    render(
      <ClassSlotView
        client={client}
        bookingClient={bookingClient}
        branchOverride={branch}
        capabilitiesOverride={capabilities}
      />,
    );
    const user = userEvent.setup();
    const calendar = screen.getByRole('region', { name: 'Kalender kelas tujuh hari' });
    await within(calendar).findByText('Reformer');
    await user.click(within(calendar).getByRole('button', { name: /Reformer/ }));
    return { user, dialog: screen.getByRole('dialog', { name: 'Reformer' }) };
  };

  it('sends staff to the Check-in page to scan the instructor instead of showing a QR', async () => {
    const issueInstructorCheckIn = vi.fn();
    const { dialog } = await open({}, { list: vi.fn(), issueInstructorCheckIn });
    expect(within(dialog).getByRole('link', { name: 'Buka Check-in' })).toHaveAttribute(
      'href',
      '/workspace/check-in',
    );
    expect(within(dialog).queryByRole('img', { name: 'QR presensi instruktur' })).toBeNull();
    expect(issueInstructorCheckIn).not.toHaveBeenCalled();
  });

  it('hides the QR action without attendance:manage', async () => {
    const { dialog } = await open(
      {},
      { list: vi.fn(), issueInstructorCheckIn: vi.fn() },
      ['class-slot:read', 'class-slot:manage'],
    );
    expect(within(dialog).queryByRole('button', { name: 'Tampilkan QR presensi instruktur' })).toBeNull();
  });

  it('hides the QR action once the instructor is already recorded', async () => {
    const { dialog } = await open(
      { instructorAttendance: { checkedInAt: new Date().toISOString(), method: 'QR_SCAN' } },
      { list: vi.fn(), issueInstructorCheckIn: vi.fn() },
    );
    expect(within(dialog).queryByRole('button', { name: 'Tampilkan QR presensi instruktur' })).toBeNull();
  });
});

describe('ClassSlotView without catalog access (read-only roles)', () => {
  const named = {
    ...slot,
    instructorUserId: 'a45ec6c1-0000-4000-8000-000000000000',
    instructor: { displayName: 'Sarah Coach' },
    classType: { name: 'Reformer Pilates' },
  };
  const emptyCatalog = () =>
    fake({
      discover: vi
        .fn()
        .mockResolvedValue({ slots: [named], classTypes: [], instructors: [], studios: [] }),
    });

  it('shows the class and instructor names from the slot in the detail drawer', async () => {
    render(
      <ClassSlotView
        client={emptyCatalog()}
        branchOverride={branch}
        capabilitiesOverride={readCapabilities}
      />,
    );
    const user = userEvent.setup();
    const calendar = screen.getByRole('region', { name: 'Kalender kelas tujuh hari' });
    await user.click(await within(calendar).findByRole('button', { name: /Reformer Pilates/ }));
    const dialog = screen.getByRole('dialog', { name: 'Reformer Pilates' });
    expect(within(dialog).getAllByText('Sarah Coach')[0]).toBeVisible();
    expect(within(dialog).queryByText('Instruktur belum dimuat')).toBeNull();
  });

  it('takes class-type and instructor names from the visible slots', async () => {
    render(
      <ClassSlotView
        client={emptyCatalog()}
        branchOverride={branch}
        capabilitiesOverride={readCapabilities}
      />,
    );
    // Tanpa akses katalog, nama tipe kelas dan instruktur tetap terbaca dari data kelas itu sendiri.
    const calendar = screen.getByRole('region', { name: 'Kalender kelas tujuh hari' });
    expect(
      await within(calendar).findByRole('button', { name: /Reformer Pilates, Sarah\./ }),
    ).toBeInTheDocument();
  });
});

describe('ClassSlotView detail drawer layout', () => {
  const openDetail = async (
    detailSlot: Record<string, unknown>,
    capabilities: readonly string[] = manageCapabilities,
    client?: ClassSlotClient,
  ) => {
    const target = { ...slot, ...detailSlot };
    render(
      <ClassSlotView
        client={
          client ??
          fake({ discover: vi.fn().mockResolvedValue({ ...workspace, slots: [target] }) })
        }
        branchOverride={branch}
        capabilitiesOverride={capabilities}
      />,
    );
    const user = userEvent.setup();
    // Kelas batal disembunyikan dulu; staf membukanya lewat tombol "Tampilkan kelas batal".
    if ((target.status as string) === 'CANCELLED') {
      await user.click(await screen.findByRole('button', { name: /Tampilkan 1 kelas batal/ }));
    }
    await screen.findAllByText('Reformer');
    await user.click(
      within(screen.getByRole('region', { name: 'Kalender kelas tujuh hari' })).getByRole(
        'button',
        { name: /Reformer/ },
      ),
    );
    return { user, dialog: screen.getByRole('dialog', { name: 'Reformer' }) };
  };

  it('summarises date, time zone, studio and room without exposing the data version', async () => {
    const { dialog } = await openDetail({
      status: 'PUBLISHED',
      studio: { name: 'Area Studio Utama' },
      room: { name: 'Ruang Reformer' },
    });
    expect(within(dialog).getByRole('heading', { name: 'Ringkasan kelas' })).toBeVisible();
    expect(within(dialog).getByText('Area Studio Utama · Ruang Reformer')).toBeVisible();
    expect(within(dialog).getByText(/WIB/)).toBeVisible();
    expect(within(dialog).queryByText('Versi data')).toBeNull();
    expect(dialog).toHaveTextContent(
      new Intl.DateTimeFormat('id-ID', {
        timeZone: 'Asia/Jakarta',
        weekday: 'long',
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      }).format(slot.startAt),
    );
  });

  it('explains why a draft without an instructor cannot be published', async () => {
    const { dialog } = await openDetail({ status: 'DRAFT', instructorUserId: null });
    expect(within(dialog).getByRole('button', { name: 'Publikasikan kelas' })).toBeDisabled();
    expect(
      within(dialog).getByText('Tetapkan instruktur terlebih dahulu untuk mempublikasikan kelas.'),
    ).toBeVisible();
  });

  it('shows a read-only notice instead of disabled action buttons', async () => {
    const { dialog } = await openDetail({ status: 'PUBLISHED' }, readCapabilities);
    expect(within(dialog).getByText('Anda hanya dapat melihat kelas ini.')).toBeVisible();
    expect(within(dialog).queryByRole('button', { name: 'Batalkan kelas ini' })).toBeNull();
    expect(within(dialog).queryByRole('heading', { name: 'Batalkan kelas' })).toBeNull();
  });

  it('requires an explicit cancellation reason before the cancel button is enabled', async () => {
    const { user, dialog } = await openDetail({ status: 'PUBLISHED' });
    const cancel = within(dialog).getByRole('button', { name: 'Batalkan kelas ini' });
    expect(cancel).toBeDisabled();
    expect(within(dialog).getByLabelText('Alasan pembatalan')).toHaveValue('');
    await user.selectOptions(within(dialog).getByLabelText('Alasan pembatalan'), 'SAFETY_ISSUE');
    expect(cancel).toBeEnabled();
    expect(within(dialog).getByText(/1 peserta aktif/)).toBeVisible();
  });

  it('shows the cancellation reason on a closed class and offers no actions', async () => {
    const { dialog } = await openDetail({
      status: 'CANCELLED',
      cancellationReasonCode: 'AUTO_CANCEL_MIN_QUOTA',
    });
    expect(
      within(dialog).getByText('Kuota minimum tidak terpenuhi (otomatis)'),
    ).toBeVisible();
    expect(within(dialog).queryByRole('button', { name: 'Batalkan kelas ini' })).toBeNull();
    expect(within(dialog).queryByText('Anda hanya dapat melihat kelas ini.')).toBeNull();
  });

  describe('reassigning the instructor of a running class', () => {
    const twoInstructors = {
      ...workspace,
      instructors: [
        { id: 'instructor-1', displayName: 'Ayu Instructor' },
        { id: 'instructor-2', displayName: 'Budi Instructor' },
      ],
    };
    const openWithTwo = (
      extra: Record<string, unknown>,
      capabilities: readonly string[] = manageCapabilities,
    ) => {
      const target = { ...slot, version: 3, ...extra };
      const client = fake({
        discover: vi.fn().mockResolvedValue({ ...twoInstructors, slots: [target] }),
        assign: vi.fn().mockResolvedValue({ ...target, instructorUserId: 'instructor-2', version: 4 }),
      });
      return { client, open: () => openDetail(extra, capabilities, client) };
    };

    it.each(['PUBLISHED', 'CONFIRMED'])(
      'lets staff replace the instructor of a %s class using the current version',
      async (status) => {
        const { client, open } = openWithTwo({ status });
        const { user, dialog } = await open();
        expect(within(dialog).getByRole('heading', { name: 'Instruktur kelas' })).toBeVisible();
        const replace = within(dialog).getByRole('button', { name: 'Ganti instruktur' });
        expect(replace).toBeDisabled();
        await user.click(within(dialog).getByRole('combobox', { name: 'Instruktur' }));
        await user.click(await screen.findByRole('option', { name: /Budi Instructor/ }));
        expect(replace).toBeEnabled();
        await user.click(replace);
        await user.click(
          within(screen.getByRole('dialog', { name: 'Tetapkan instruktur?' })).getByRole('button', {
            name: 'Tetapkan',
          }),
        );
        expect(client.assign).toHaveBeenCalledWith('slot-1', 'instructor-2');
      },
    );

    it('offers to assign, not replace, when a published class has no instructor yet', async () => {
      const { open } = openWithTwo({ status: 'PUBLISHED', instructorUserId: null });
      const { dialog } = await open();
      expect(within(dialog).getByRole('button', { name: 'Tetapkan instruktur' })).toBeDisabled();
      expect(within(dialog).queryByRole('button', { name: 'Ganti instruktur' })).toBeNull();
    });

    it('does not offer instructor changes on a completed class', async () => {
      const { dialog } = await openWithTwo({ status: 'COMPLETED' }).open();
      expect(within(dialog).queryByRole('heading', { name: 'Instruktur kelas' })).toBeNull();
    });

    it('does not offer instructor changes to read-only staff', async () => {
      const { dialog } = await openWithTwo({ status: 'PUBLISHED' }, readCapabilities).open();
      expect(within(dialog).queryByRole('heading', { name: 'Instruktur kelas' })).toBeNull();
      expect(within(dialog).getByText('Anda hanya dapat melihat kelas ini.')).toBeVisible();
    });
  });

  it('hides roster pagination when everything fits on one page', async () => {
    const bookingClient: Pick<BookingClient, 'list'> = {
      list: vi.fn().mockResolvedValue({
        items: [],
        summary: { total: 0, booked: 0, reschedulePending: 0, attended: 0, cancelled: 0, noShow: 0 },
        nextCursor: null,
      } as unknown as BookingPage),
    };
    render(
      <ClassSlotView
        client={fake({
          discover: vi.fn().mockResolvedValue({
            ...workspace,
            slots: [{ ...slot, status: 'PUBLISHED' }],
          }),
        })}
        bookingClient={bookingClient}
        branchOverride={branch}
        capabilitiesOverride={[...manageCapabilities, 'booking:read']}
      />,
    );
    const user = userEvent.setup();
    await screen.findAllByText('Reformer');
    await user.click(
      within(screen.getByRole('region', { name: 'Kalender kelas tujuh hari' })).getByRole(
        'button',
        { name: /Reformer/ },
      ),
    );
    await user.click(await screen.findByRole('button', { name: 'Atur kelas' }));
    const dialog = screen.getByRole('dialog', { name: 'Reformer' });
    expect(await within(dialog).findByText('Belum ada peserta')).toBeVisible();
    expect(within(dialog).queryByText(/Halaman 1/)).toBeNull();
  });
});

describe('ClassSlotView duplicate and delete', () => {
  const openDetail = async (detailSlot: Record<string, unknown>, capabilities: readonly string[] = manageCapabilities) => {
    const target = { ...slot, studioId: 'studio-1', ...detailSlot };
    const client = fake({ discover: vi.fn().mockResolvedValue({ ...workspace, slots: [target] }) });
    render(<ClassSlotView client={client} branchOverride={branch} capabilitiesOverride={capabilities} />);
    const user = userEvent.setup();
    // Kelas batal disembunyikan dulu; staf membukanya lewat tombol "Tampilkan kelas batal".
    if ((target.status as string) === 'CANCELLED') {
      await user.click(await screen.findByRole('button', { name: /Tampilkan 1 kelas batal/ }));
    }
    await screen.findAllByText('Reformer');
    await user.click(
      within(screen.getByRole('region', { name: 'Kalender kelas tujuh hari' })).getByRole('button', {
        name: /Reformer/,
      }),
    );
    return { user, client, target, dialog: screen.getByRole('dialog', { name: 'Reformer' }) };
  };

  it('duplicates a class into a prefilled draft one week later and creates it only after confirmation', async () => {
    const { user, client, target, dialog } = await openDetail({ status: 'PUBLISHED', instructorUserId: 'instructor-1' });
    await user.click(within(dialog).getByRole('button', { name: 'Duplikat sebagai draft' }));

    const form = screen.getByRole('dialog', { name: 'Duplikat kelas' });
    const nextWeek = new Date(target.startAt.getTime() + 7 * 86_400_000);
    const clock = (value: Date) =>
      new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(value);
    const dateKey = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(nextWeek);
    expect(within(form).getByLabelText('Tanggal')).toHaveValue(dateKey);
    expect(within(form).getByLabelText('Mulai')).toHaveValue(clock(target.startAt));
    expect(within(form).getByLabelText('Selesai eksklusif')).toHaveValue(clock(target.endAt));
    expect(within(form).getByRole('combobox', { name: /Tipe kelas/ })).toHaveValue('Reformer');
    expect(within(form).getByRole('combobox', { name: /Area Studio/ })).toHaveValue('Area Studio Utama');
    expect(within(form).getByRole('combobox', { name: /Instruktur/ })).toHaveValue('Ayu Instructor');
    expect(client.create).not.toHaveBeenCalled();

    await user.click(within(form).getByRole('button', { name: 'Buat draft' }));
    await user.click(
      within(screen.getByRole('dialog', { name: 'Buat draft kelas?' })).getByRole('button', { name: 'Buat draft' }),
    );
    await waitFor(() => expect(client.create).toHaveBeenCalledTimes(1));
    expect(client.create).toHaveBeenCalledWith(
      expect.objectContaining({
        branchId: 'branch-1',
        classTypeId: 'type-1',
        studioId: 'studio-1',
        instructorUserId: 'instructor-1',
        // Form berpresisi menit: detik dari jam fixture tidak ikut tersalin.
        startAt: new Date(Math.floor((target.startAt.getTime() + 7 * 86_400_000) / 60_000) * 60_000),
        endAt: new Date(Math.floor((target.endAt.getTime() + 7 * 86_400_000) / 60_000) * 60_000),
      }),
    );
  });

  it('offers duplicate but no delete on a published class, and neither to read-only staff', async () => {
    const { dialog } = await openDetail({ status: 'PUBLISHED' });
    expect(within(dialog).getByRole('button', { name: 'Duplikat sebagai draft' })).toBeVisible();
    expect(within(dialog).queryByRole('button', { name: 'Hapus jadwal kelas' })).toBeNull();
  });

  it('hides duplicate and delete for read-only staff', async () => {
    const { dialog } = await openDetail({ status: 'DRAFT' }, readCapabilities);
    expect(within(dialog).queryByRole('button', { name: 'Duplikat sebagai draft' })).toBeNull();
    expect(within(dialog).queryByRole('button', { name: 'Hapus jadwal kelas' })).toBeNull();
  });

  it('deletes a clean draft only with a reason, then removes it from the agenda', async () => {
    mockDeletability.mockResolvedValue({ kind: 'class-slot', id: 'slot-1', deletable: true, blockers: [] });
    mockRemove.mockResolvedValue({ id: 'slot-1', deleted: true });
    const { user, dialog } = await openDetail({ status: 'DRAFT', bookedCount: 0 });
    await user.click(within(dialog).getByRole('button', { name: 'Hapus jadwal kelas' }));

    const confirm = await screen.findByRole('dialog', { name: /Hapus jadwal kelas/ });
    expect(within(confirm).getByRole('button', { name: 'Hapus permanen' })).toBeDisabled();
    await user.type(within(confirm).getByLabelText('Alasan'), 'Dibuat di tanggal yang salah');
    await user.click(within(confirm).getByRole('button', { name: 'Hapus permanen' }));

    await waitFor(() =>
      expect(mockRemove).toHaveBeenCalledWith('class-slot', 'slot-1', 'Dibuat di tanggal yang salah'),
    );
    expect(await screen.findByText(/Jadwal kelas .* berhasil dihapus\./)).toBeVisible();
    expect(screen.queryByRole('dialog', { name: 'Reformer' })).toBeNull();
  });

  it('explains what still references a cancelled class instead of deleting it', async () => {
    mockRemove.mockClear();
    mockDeletability.mockResolvedValue({
      kind: 'class-slot',
      id: 'slot-1',
      deletable: false,
      blockers: [{ kind: 'pemesanan_kelas', label: 'booking', count: 3 }],
    });
    const { user, dialog } = await openDetail({ status: 'CANCELLED' });
    await user.click(within(dialog).getByRole('button', { name: 'Hapus jadwal kelas' }));
    expect(await screen.findByText('Jadwal kelas belum dapat dihapus')).toBeVisible();
    expect(screen.getByText('Booking')).toBeVisible();
    expect(mockRemove).not.toHaveBeenCalled();
  });
});
