import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AppFeedbackProvider } from '../components/app-feedback';
import {
  cleanWhatsAppPhone,
  buildWhatsAppLink,
  WHATSAPP_REMINDER_PRESETS,
  type WhatsAppReminderContext,
} from './whatsapp-reminder-presets';
import { WhatsAppReminderDialog } from './whatsapp-reminder-dialog';
import { FrontDeskTodayView } from './front-desk-today-view';
import type { ClassSlotClient, ClassWorkspace } from '../api-clients/class-slot-client';
import type { BookingClient, CustomerBookingRecord } from '../api-clients/booking-client';

const branch = {
  id: 'branch-1',
  code: 'DD-SN',
  name: 'Cabang Senopati',
  timezone: 'Asia/Jakarta',
};

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock('../session-context', () => ({
  useSessionContext: () => ({
    session: {
      id: 'user-1',
      displayName: 'Admin Senopati',
      roles: ['ADMIN'],
      branches: [branch],
    },
    activeBranchId: 'branch-1',
    activeBranch: branch,
    hasCapability: (cap: string) => ['attendance:manage', 'package:read'].includes(cap),
    setActiveBranchId: vi.fn(),
  }),
}));

describe('whatsapp-reminder-presets', () => {
  it('cleans Indonesian phone numbers into E.164 without plus sign', () => {
    expect(cleanWhatsAppPhone('081234567890')).toBe('6281234567890');
    expect(cleanWhatsAppPhone('+62 812-3456-7890')).toBe('6281234567890');
    expect(cleanWhatsAppPhone('81234567890')).toBe('6281234567890');
    expect(cleanWhatsAppPhone('0812-****-7890')).toBeNull(); // < 9 valid digits
    expect(cleanWhatsAppPhone('')).toBeNull();
    expect(cleanWhatsAppPhone(null)).toBeNull();
  });

  it('builds wa.me URL with properly encoded message body', () => {
    const link = buildWhatsAppLink('081234567890', 'Halo Kak Rina! ✨');
    expect(link).toBe('https://wa.me/6281234567890?text=Halo%20Kak%20Rina!%20%E2%9C%A8');
  });

  it('generates courteous Indonesian messages across all 4 operational presets', () => {
    const ctx: WhatsAppReminderContext = {
      customerName: 'Siti Nurhaliza',
      className: 'Reformer Flow',
      branchName: 'Daily Dose Senopati',
      classTime: '10:00 – 10:50',
      instructorName: 'Sarah',
      remainingSessions: 1,
      checkInUrl: 'https://dailydosepilates.com/check-in',
    };

    const reminder = WHATSAPP_REMINDER_PRESETS.find((p) => p.id === 'class_reminder')!;
    const reminderMsg = reminder.generateText(ctx);
    expect(reminderMsg).toContain('Halo Kak Siti Nurhaliza!');
    expect(reminderMsg).toContain('Reformer Flow');
    expect(reminderMsg).toContain('Daily Dose Senopati');
    expect(reminderMsg).toContain('Coach Sarah');
    expect(reminderMsg).toContain('kaus kaki antiselip');

    const checkin = WHATSAPP_REMINDER_PRESETS.find((p) => p.id === 'checkin_link')!;
    const checkinMsg = checkin.generateText(ctx);
    expect(checkinMsg).toContain('presensi mandiri');
    expect(checkinMsg).toContain('https://dailydosepilates.com/check-in');

    const late = WHATSAPP_REMINDER_PRESETS.find((p) => p.id === 'running_late')!;
    const lateMsg = late.generateText(ctx);
    expect(lateMsg).toContain('sedang dalam perjalanan');

    const renewal = WHATSAPP_REMINDER_PRESETS.find((p) => p.id === 'package_renewal')!;
    const renewalMsg = renewal.generateText(ctx);
    expect(renewalMsg).toContain('tersisa *1 sesi* lagi');
    expect(renewalMsg).toContain('memperpanjang paket');
  });
});

describe('WhatsAppReminderDialog', () => {
  const mockContext: WhatsAppReminderContext = {
    customerName: 'Budi Santoso',
    phone: '081298765432',
    className: 'Mat Pilates Core',
    branchName: 'Daily Dose Kemang',
    classTime: '09:00 – 09:50',
    remainingSessions: 2,
  };

  it('renders modal with presets, phone input, and message preview', async () => {
    const onClose = vi.fn();
    render(
      <AppFeedbackProvider>
        <WhatsAppReminderDialog open={true} onClose={onClose} context={mockContext} />
      </AppFeedbackProvider>,
    );

    expect(screen.getByText('Kirim Pesan WhatsApp: Budi Santoso')).toBeInTheDocument();
    expect(screen.getByDisplayValue('081298765432')).toBeInTheDocument();
    expect(screen.getByText('Pengingat Jadwal Kelas')).toBeInTheDocument();
    expect(screen.getByText('Tautan Presensi Mandiri')).toBeInTheDocument();
    expect(screen.getByText('Konfirmasi Keterlambatan')).toBeInTheDocument();
    expect(screen.getByText('Pengingat Perpanjangan Paket')).toBeInTheDocument();
  });

  it('switches template when clicking another preset and updates preview text', async () => {
    const user = userEvent.setup();
    render(
      <AppFeedbackProvider>
        <WhatsAppReminderDialog open={true} onClose={vi.fn()} context={mockContext} />
      </AppFeedbackProvider>,
    );

    // Click "Tautan Presensi Mandiri"
    await user.click(screen.getByText('Tautan Presensi Mandiri'));
    const textarea = screen.getByRole('textbox', { name: /Teks Pesan/i }) as HTMLTextAreaElement;
    expect(textarea.value).toContain('presensi mandiri');

    // Click "Pengingat Perpanjangan Paket"
    await user.click(screen.getByText('Pengingat Perpanjangan Paket'));
    expect(textarea.value).toContain('tersisa *2 sesi* lagi');
  });

  it('launches wa.me link in new tab when "Buka WhatsApp" is clicked', async () => {
    const user = userEvent.setup();
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    const onClose = vi.fn();

    render(
      <AppFeedbackProvider>
        <WhatsAppReminderDialog open={true} onClose={onClose} context={mockContext} />
      </AppFeedbackProvider>,
    );

    await user.click(screen.getByRole('button', { name: /buka whatsapp/i }));
    expect(openSpy).toHaveBeenCalledWith(
      expect.stringContaining('https://wa.me/6281298765432?text='),
      '_blank',
      'noopener,noreferrer',
    );
    expect(onClose).toHaveBeenCalled();
    openSpy.mockRestore();
  });

  it('copies text to clipboard when "Salin Teks" is clicked', async () => {
    const user = userEvent.setup();
    const writeTextSpy = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: writeTextSpy },
      configurable: true,
    });

    render(
      <AppFeedbackProvider>
        <WhatsAppReminderDialog open={true} onClose={vi.fn()} context={mockContext} />
      </AppFeedbackProvider>,
    );

    await user.click(screen.getByRole('button', { name: /salin teks/i }));
    expect(writeTextSpy).toHaveBeenCalledWith(expect.stringContaining('Halo Kak Budi Santoso!'));
    expect(screen.getByText('Tersalin!')).toBeInTheDocument();
  });
});

describe('FrontDeskTodayView - WhatsApp action buttons integration', () => {
  const sampleSlot = {
    id: 'slot-1',
    branchId: branch.id,
    studioId: 'studio-1',
    classTypeId: 'type-1',
    instructorUserId: 'instructor-1',
    timezone: branch.timezone,
    version: 1,
    startAt: new Date('2026-10-30T02:00:00.000Z'), // 09:00 WIB
    endAt: new Date('2026-10-30T02:50:00.000Z'), // 09:50 WIB
    capacity: 6,
    bookedCount: 1,
    minimumQuota: 2,
    status: 'PUBLISHED' as const,
  };

  const workspace: ClassWorkspace = {
    slots: [sampleSlot] as never,
    studios: [{ id: 'studio-1', branchId: branch.id, code: 'STU1', name: 'Studio Utama', rooms: [] }],
    classTypes: [{ id: 'type-1', code: 'REF-INTRO', name: 'Reformer Intro' }],
    instructors: [{ id: 'instructor-1', displayName: 'Coach Ayu' }],
  };

  const sampleBooking = {
    id: 'booking-1',
    version: 1,
    branchId: branch.id,
    classSlotId: sampleSlot.id,
    status: 'BOOKED',
    customer: {
      id: 'cust-1',
      displayName: 'Maya Putri',
      phoneMasked: '0812-1111-2222',
    },
    package: {
      id: 'pkg-1',
      name: '10x Group Reformer',
    },
    sessionBalance: {
      ledgerBalance: 1,
      reserved: 0,
      available: 1,
    },
    classSlot: {
      id: sampleSlot.id,
      startAt: sampleSlot.startAt,
      endAt: sampleSlot.endAt,
      timezone: branch.timezone,
      status: sampleSlot.status,
      classType: { id: 'type-1', name: 'Reformer Intro' },
    },
  };

  it('renders "Kirim WA" on attendee rows and opens dialog with prefilled context', async () => {
    const user = userEvent.setup();
    const mockSlotClient: Partial<ClassSlotClient> = {
      discover: vi.fn().mockResolvedValue(workspace),
    };
    const mockBookingClient: Partial<BookingClient> = {
      list: vi.fn().mockImplementation(async (query) => {
        if (query.classSlotId) {
          return { items: [sampleBooking as unknown as CustomerBookingRecord], total: 1, page: 1, limit: 50 };
        }
        return { items: [sampleBooking as unknown as CustomerBookingRecord], total: 1, page: 1, limit: 100 };
      }),
    };

    render(
      <AppFeedbackProvider>
        <FrontDeskTodayView
          client={mockSlotClient as ClassSlotClient}
          bookingClient={mockBookingClient as BookingClient}
          initialNow={new Date('2026-10-30T02:05:00.000Z')} // 09:05 WIB
          queues={[]}
        />
      </AppFeedbackProvider>,
    );

    // Wait for slot and attendees to render
    const kirimWaButton = await screen.findByRole('button', {
      name: 'Kirim WhatsApp ke Maya Putri',
    });
    expect(kirimWaButton).toBeInTheDocument();

    // Click "Kirim WA"
    await user.click(kirimWaButton);

    // Verify WhatsApp modal dialog opened with attendee details
    const dialog = await screen.findByRole('dialog', {
      name: /Kirim Pesan WhatsApp: Maya Putri/i,
    });
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByDisplayValue('0812-1111-2222')).toBeInTheDocument();
    const textarea = within(dialog).getByRole('textbox', {
      name: /Teks Pesan/i,
    }) as HTMLTextAreaElement;
    expect(textarea.value).toContain('Reformer Intro');
    expect(textarea.value).toContain('Coach Ayu');
  });

  it('renders "Ingatkan WA" on expiring package list and opens renewal reminder preset', async () => {
    const user = userEvent.setup();
    const mockSlotClient: Partial<ClassSlotClient> = {
      discover: vi.fn().mockResolvedValue(workspace),
    };
    const mockBookingClient: Partial<BookingClient> = {
      list: vi.fn().mockImplementation(async (query) => {
        if (query.classSlotId) {
          return { items: [sampleBooking as unknown as CustomerBookingRecord], total: 1, page: 1, limit: 50 };
        }
        return { items: [sampleBooking as unknown as CustomerBookingRecord], total: 1, page: 1, limit: 100 };
      }),
    };

    render(
      <AppFeedbackProvider>
        <FrontDeskTodayView
          client={mockSlotClient as ClassSlotClient}
          bookingClient={mockBookingClient as BookingClient}
          initialNow={new Date('2026-10-30T02:05:00.000Z')}
          queues={[]}
        />
      </AppFeedbackProvider>,
    );

    // Find the expiring section button
    const ingatkanWaButton = await screen.findByRole('button', {
      name: 'Ingatkan perpanjangan ke Maya Putri',
    });
    expect(ingatkanWaButton).toBeInTheDocument();

    // Click "Ingatkan WA"
    await user.click(ingatkanWaButton);

    // Verify dialog opened with renewal template
    const dialog = await screen.findByRole('dialog', {
      name: /Kirim Pesan WhatsApp: Maya Putri/i,
    });
    expect(dialog).toBeInTheDocument();
    const textarea = within(dialog).getByRole('textbox', {
      name: /Teks Pesan/i,
    }) as HTMLTextAreaElement;
    expect(textarea.value).toContain('tersisa *1 sesi* lagi');
    expect(textarea.value).toContain('memperpanjang paket');
  });
});
