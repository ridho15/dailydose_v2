import { PolicyService } from '../identity/policy.service';
import { ClassSlotService } from './slot-kelas.service';

const branchId = '00000000-0000-4000-8000-000000000002';
const slotId = '00000000-0000-4000-8000-000000000010';
const instructorId = '00000000-0000-4000-8000-000000000050';
const classTypeId = '00000000-0000-4000-8000-000000000060';
const key = '1234567890123456';
const principal = {
  sessionId: 'session',
  userId: '00000000-0000-4000-8000-000000000001',
  roles: [{ role: 'ADMIN' as const, branchId }],
  capabilities: ['class-slot:read', 'class-slot:manage'],
  branchIds: [branchId],
};

describe('Manual Class Slot Cancellation WhatsApp Broadcast (Fase 3)', () => {
  it('dispatches WhatsApp notification to booked attendees and instructor upon manual cancellation', async () => {
    const slot = {
      id: slotId,
      branchId,
      studioId: '00000000-0000-4000-8000-000000000070',
      roomId: null,
      classTypeId,
      instructorId,
      startAt: new Date('2026-11-10T10:00:00Z'),
      endAt: new Date('2026-11-10T11:00:00Z'),
      capacity: 8,
      bookedCount: 2,
      status: 'PUBLISHED',
      version: 2,
      notes: null,
      branch: { name: 'Gandaria Studio', timezone: 'Asia/Jakarta' },
      classType: { name: 'Reformer Flow', minimumQuota: 3 },
      instructor: { displayName: 'Coach Budi', phone: '628111111111' },
      bookings: [
        {
          id: 'booking-1',
          customerPackageId: 'pkg-1',
          user: { displayName: 'Siti Rahma', phone: '628123456789' },
        },
        {
          id: 'booking-2',
          customerPackageId: 'pkg-2',
          user: { displayName: 'Dewi Lestari', phone: '628987654321' },
        },
      ],
    };

    const tx = {
      slotKelas: {
        findUnique: jest.fn(async () => slot),
        updateMany: jest.fn(async () => ({ count: 1 })),
        findUniqueOrThrow: jest.fn(async () => ({
          ...slot,
          status: 'CANCELLED',
          version: 3,
        })),
      },
      pemesananKelas: {
        update: jest.fn(async () => ({})),
      },
      paketPelanggan: {
        findUnique: jest.fn(async () => ({ remainingSessions: 5 })),
      },
      sessionLedger: {
        create: jest.fn(async () => ({})),
      },
    };

    const db = {
      $transaction: jest.fn(async (cb) => cb(tx)),
    } as any;

    const policy = new PolicyService();
    const idempotency = {
      execute: jest.fn(async (_opts, action) => ({
        status: 200,
        body: await action(tx),
      })),
    } as any;

    const config = {} as any;
    const whatsapp = {
      sendMessage: jest.fn().mockResolvedValue({ success: true, messageId: 'msg-123' }),
    } as any;

    const service = new ClassSlotService(db, policy, idempotency, config, undefined, whatsapp);

    const result = await service.cancel(
      principal,
      slotId,
      { reasonCode: 'STUDIO_UNAVAILABLE', expectedVersion: 2, note: 'Renovasi AC studio' },
      key,
      'corr-id',
    );

    expect(result).toBeDefined();

    // Pastikan WhatsApp dikirim ke member Siti Rahma
    expect(whatsapp.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        to: '628123456789',
        recipientType: 'CUSTOMER',
        reminderType: 'CLASS_CANCELLED_MANUAL',
        text: expect.stringContaining('Siti Rahma'),
      }),
    );

    // Pastikan WhatsApp dikirim ke member Dewi Lestari
    expect(whatsapp.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        to: '628987654321',
        recipientType: 'CUSTOMER',
        reminderType: 'CLASS_CANCELLED_MANUAL',
        text: expect.stringContaining('Dewi Lestari'),
      }),
    );

    // Pastikan teks member memuat info kuota aman & alasan
    const customerCall = whatsapp.sendMessage.mock.calls.find((c: any) => c[0].to === '628123456789');
    expect(customerCall[0].text).toContain('Studio tidak dapat digunakan / pemeliharaan (Renovasi AC studio)');
    expect(customerCall[0].text).toContain('Kuota sesi Anda tetap aman');

    // Pastikan WhatsApp dikirim ke Coach Budi
    expect(whatsapp.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        to: '628111111111',
        recipientType: 'INSTRUCTOR',
        reminderType: 'CLASS_CANCELLED_MANUAL_INSTRUCTOR',
        text: expect.stringContaining('Coach Budi'),
      }),
    );
    const coachCall = whatsapp.sendMessage.mock.calls.find((c: any) => c[0].to === '628111111111');
    expect(coachCall[0].text).toContain('Jadwal mengajar Anda telah dibebaskan');
  });

  it('No Happy Path: handles attendees without phone numbers and WhatsApp failure gracefully', async () => {
    const slot = {
      id: slotId,
      branchId,
      studioId: '00000000-0000-4000-8000-000000000070',
      roomId: null,
      classTypeId,
      instructorId: null,
      startAt: new Date('2026-11-10T10:00:00Z'),
      endAt: new Date('2026-11-10T11:00:00Z'),
      capacity: 8,
      bookedCount: 1,
      status: 'PUBLISHED',
      version: 2,
      notes: null,
      branch: { name: 'Gandaria Studio', timezone: 'Asia/Jakarta' },
      classType: { name: 'Reformer Flow', minimumQuota: 3 },
      instructor: null,
      bookings: [
        {
          id: 'booking-no-phone',
          customerPackageId: null,
          user: { displayName: 'Anonymous Member', phone: null },
        },
      ],
    };

    const tx = {
      slotKelas: {
        findUnique: jest.fn(async () => slot),
        updateMany: jest.fn(async () => ({ count: 1 })),
        findUniqueOrThrow: jest.fn(async () => ({
          ...slot,
          status: 'CANCELLED',
          version: 3,
        })),
      },
      pemesananKelas: {
        update: jest.fn(async () => ({})),
      },
    };

    const db = {
      $transaction: jest.fn(async (cb) => cb(tx)),
    } as any;

    const policy = new PolicyService();
    const idempotency = {
      execute: jest.fn(async (_opts, action) => ({
        status: 200,
        body: await action(tx),
      })),
    } as any;

    const whatsapp = {
      sendMessage: jest.fn().mockRejectedValue(new Error('WhatsApp Gateway Network Timeout')),
    } as any;

    const service = new ClassSlotService(db, policy, idempotency, {} as any, undefined, whatsapp);

    // Pembatalan harus tetap berhasil walau WhatsApp gagal / nomor telepon kosong
    await expect(
      service.cancel(
        principal,
        slotId,
        { reasonCode: 'SAFETY_ISSUE', expectedVersion: 2 },
        key,
        'corr-id',
      ),
    ).resolves.toBeDefined();

    expect(whatsapp.sendMessage).not.toHaveBeenCalled();
  });
});
