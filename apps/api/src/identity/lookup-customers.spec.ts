import { PolicyService } from './policy.service';
import { UserAdministrationService } from './user-administration.service';

const admin = {
  sessionId: 's',
  userId: 'adm',
  roles: [{ role: 'ADMIN', branchId: 'mk' }],
  capabilities: ['booking:create:assisted'],
  branchIds: ['mk'],
} as never;

const user = (id: string, displayName: string) => ({
  id,
  displayName,
  phone: null,
  customerPackages: [],
});

function setup(rows: ReturnType<typeof user>[]) {
  const db = { user: { findMany: jest.fn().mockResolvedValue(rows) } };
  return {
    db,
    service: new UserAdministrationService(db as never, new PolicyService(), {} as never),
  };
}

describe('lookupCustomers', () => {
  it('mengurutkan dari nama yang paling mirip, bukan dari id', async () => {
    const { service } = setup([
      user('1', 'Maria Anastasia'),
      user('2', 'Diana Putri'),
      user('3', 'Ana'),
      user('4', 'Anastasia Wijaya'),
    ]);
    const hasil = await service.lookupCustomers(admin, { q: 'ana', limit: 3 });
    expect(hasil.items.map((i) => i.label)).toEqual(['Ana', 'Anastasia Wijaya', 'Maria Anastasia']);
  });

  it('roster bisa ikut mencari member tanpa paket aktif', async () => {
    const { db, service } = setup([]);
    await service.lookupCustomers(admin, { q: 'ana' });
    expect(db.user.findMany.mock.calls[0][0].where.customerPackages).toBeDefined();
    await service.lookupCustomers(admin, { q: 'ana', includeWithoutPackage: true });
    expect(db.user.findMany.mock.calls[1][0].where.customerPackages).toBeUndefined();
  });
});
