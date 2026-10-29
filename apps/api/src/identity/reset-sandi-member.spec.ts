import { PolicyService } from './policy.service';
import { UserAdministrationService } from './user-administration.service';

const admin = {
  sessionId: 's',
  userId: 'admin-1',
  roles: [{ role: 'ADMIN', branchId: 'mk' }],
  capabilities: ['customer:credential:initialize', 'customer:manage'],
  branchIds: ['mk'],
} as never;

function setup(target: { role: string; status: string } | null) {
  const tx = { user: { update: jest.fn() }, userSession: { updateMany: jest.fn() } };
  const db = {
    user: { findUnique: jest.fn().mockResolvedValue(target ? { id: 't1', ...target } : null) },
    $transaction: jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
    auditLog: { create: jest.fn() },
  };
  return {
    tx,
    service: new UserAdministrationService(db as never, new PolicyService(), {} as never),
  };
}

describe('resetPasswordDirect oleh admin cabang', () => {
  it('admin bisa mengganti kata sandi akun member yang aktif', async () => {
    const { tx, service } = setup({ role: 'CUSTOMER', status: 'ACTIVE' });
    await expect(
      service.resetPasswordDirect(admin, 't1', 'SandiBaru123', 'c'),
    ).resolves.toMatchObject({
      status: 'PASSWORD_RESET_SUCCESS',
    });
    expect(tx.user.update).toHaveBeenCalled();
  });

  it('admin tidak bisa mengganti kata sandi akun staf', async () => {
    const { tx, service } = setup({ role: 'MANAGER', status: 'ACTIVE' });
    await expect(
      service.resetPasswordDirect(admin, 't1', 'SandiBaru123', 'c'),
    ).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(tx.user.update).not.toHaveBeenCalled();
  });

  it('akun yang benar-benar nonaktif mendapat pesan yang jujur', async () => {
    const { service } = setup({ role: 'CUSTOMER', status: 'INACTIVE' });
    await expect(
      service.resetPasswordDirect(admin, 't1', 'SandiBaru123', 'c'),
    ).rejects.toMatchObject({
      code: 'CUSTOMER_NOT_ACTIVE',
    });
  });
});
