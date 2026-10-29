import { CustomerProfileService } from './customer-profile.service';

const member = {
  sessionId: 's',
  userId: 'm-1',
  roles: [{ role: 'CUSTOMER', branchId: null }],
  capabilities: ['customer:self'],
  branchIds: [],
} as never;

function setup(phone: string | null = null) {
  const db = {
    user: {
      findUnique: jest.fn().mockResolvedValue({ id: 'm-1', status: 'ACTIVE', phone }),
      findFirst: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue({}),
    },
    auditLog: { create: jest.fn() },
  };
  return { db, service: new CustomerProfileService(db as never) };
}

describe('CustomerProfileService.setPhone', () => {
  it('menyimpan nomor WhatsApp akun Google yang belum punya nomor', async () => {
    const { db, service } = setup();
    await expect(service.setPhone(member, { phone: '0812-3456 7890' })).resolves.toEqual({
      phoneMasked: expect.any(String),
    });
    expect(db.user.update).toHaveBeenCalledWith({
      where: { id: 'm-1' },
      data: { phone: '081234567890' },
    });
    expect(db.user.findFirst.mock.calls[0][0].where.phone.in).toEqual([
      '081234567890',
      '6281234567890',
      '+6281234567890',
    ]);
  });

  it('menolak nomor tidak valid, nomor milik akun lain, dan akun yang sudah punya nomor', async () => {
    const { service } = setup();
    await expect(service.setPhone(member, { phone: '12345' })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    const lain = setup();
    lain.db.user.findFirst.mockResolvedValue({ id: 'm-2' });
    await expect(lain.service.setPhone(member, { phone: '+6281234567890' })).rejects.toMatchObject({
      code: 'PHONE_ALREADY_REGISTERED',
    });
    const sudah = setup('081200000000');
    await expect(sudah.service.setPhone(member, { phone: '081234567890' })).rejects.toMatchObject({
      code: 'PHONE_ALREADY_SET',
    });
    expect(sudah.db.user.update).not.toHaveBeenCalled();
  });
});
