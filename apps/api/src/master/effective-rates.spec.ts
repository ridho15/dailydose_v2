import { PolicyService } from '../identity/policy.service';
import { EffectiveSettingsService } from './konfigurasi-efektif.service';
import { MasterAccessService } from './master-access.service';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const branchA = id(1);
const classType = id(2);
const instructor = id(3);
const rowId = id(50);

const principalFor = (capabilities: string[], branchIds = [branchA]) => ({
  sessionId: 's',
  userId: id(100),
  roles: [] as never,
  capabilities,
  branchIds,
});
const finance = principalFor(['master:manage', 'finance:manage']);

const dayFromToday = (days: number) => {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return new Date(date.toISOString().slice(0, 10));
};

function setup(effectiveDate = dayFromToday(30)) {
  const feeRow = { id: rowId, branchId: branchA, effectiveDate };
  const tx = {
    instructorFee: {
      findUnique: jest.fn().mockResolvedValue(feeRow),
      delete: jest.fn().mockResolvedValue({}),
    },
  };
  const created: Array<Record<string, any>> = [];
  const db = {
    ...tx,
    instructorFee: {
      ...tx.instructorFee,
      create: jest.fn().mockImplementation(async ({ data }) => {
        created.push(data);
        return { id: rowId, ...data, branch: null, classType: null, instructor: null, createdAt: new Date() };
      }),
    },
    $transaction: jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  const service = new EffectiveSettingsService(
    new MasterAccessService(new PolicyService()),
    db as never,
  );
  return { service, tx, db, created };
}

const feeInput = (overrides: Record<string, unknown> = {}) => ({
  kind: 'INSTRUCTOR_FEE' as const,
  branchId: branchA,
  classTypeId: classType,
  instructorUserId: instructor,
  feeRp: 180_000,
  effectiveFrom: '2026-10-01',
  reason: 'Kenaikan honor',
  ...overrides,
});

describe('creating a fee or rate', () => {
  it('requires an explicit amount instead of silently defaulting', async () => {
    const { service, db } = setup();
    for (const feeRp of [undefined, 0, -5, 1.5, 10_000_001])
      await expect(
        service.create(finance, feeInput({ feeRp }), 'c'),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(db.instructorFee.create).not.toHaveBeenCalled();
  });

  it('requires an instructor for a fee (never the acting manager) and a valid date', async () => {
    const { service, db } = setup();
    await expect(
      service.create(finance, feeInput({ instructorUserId: undefined }), 'c'),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    for (const effectiveFrom of [undefined, '', 'bukan-tanggal'])
      await expect(
        service.create(finance, feeInput({ effectiveFrom }), 'c'),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(db.instructorFee.create).not.toHaveBeenCalled();
  });

  it('stores the given fee', async () => {
    const { service, created } = setup();
    await service.create(finance, feeInput(), 'c');
    expect(created[0]).toMatchObject({ instructorId: instructor, feePerJamRp: 180_000 });
  });
});

describe('deleting a fee or rate', () => {
  it('needs master:manage and finance:manage', async () => {
    const { service, tx } = setup();
    await expect(
      service.remove(principalFor(['master:manage']), 'INSTRUCTOR_FEE', rowId, 'c', 'Salah input'),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      service.remove(principalFor(['finance:manage']), 'INSTRUCTOR_FEE', rowId, 'c', 'Salah input'),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(tx.instructorFee.delete).not.toHaveBeenCalled();
  });

  it('removes a not-yet-effective fee', async () => {
    const { service, tx } = setup();
    await expect(service.remove(finance, 'INSTRUCTOR_FEE', rowId, 'c', 'Salah input')).resolves.toEqual({
      id: rowId,
      deleted: true,
    });
    expect(tx.instructorFee.delete).toHaveBeenCalledWith({ where: { id: rowId } });
  });

  it('refuses a rate that already applies (today or earlier)', async () => {
    for (const days of [0, -1, -90]) {
      const { service, tx } = setup(dayFromToday(days));
      await expect(service.remove(finance, 'INSTRUCTOR_FEE', rowId, 'c', 'Salah input')).rejects.toMatchObject({
        code: 'RATE_IN_EFFECT',
      });
      expect(tx.instructorFee.delete).not.toHaveBeenCalled();
    }
  });

  it('hides rates of another branch and malformed ids', async () => {
    const { service } = setup();
    await expect(
      service.remove(principalFor(['master:manage', 'finance:manage'], [id(9)]), 'INSTRUCTOR_FEE', rowId, 'c', 'Salah input'),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(service.remove(finance, 'INSTRUCTOR_FEE', 'x', 'c', 'Salah input')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

describe('deleting a tariff needs a typed reason', () => {
  it('refuses without one, before touching anything', async () => {
    const { service, tx } = setup();
    for (const reason of [undefined, '', '  ', 'ab'])
      await expect(service.remove(finance, 'INSTRUCTOR_FEE', rowId, 'c', reason)).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
      });
    expect(tx.instructorFee.delete).not.toHaveBeenCalled();
  });
});

describe('Super Owner menghapus versi tarif yang sudah berlaku karena salah input', () => {
  const superOwner = principalFor(['master:manage', 'finance:manage', 'instructor-fee:correct']);
  const lama = new Date('2026-01-01');
  const keliru = {
    id: rowId,
    instructorId: instructor,
    branchId: branchA,
    classTypeId: classType,
    effectiveDate: new Date('2026-09-01'),
    feePerJamRp: 300_000,
  };
  const benar = { ...keliru, id: id(51), effectiveDate: lama, feePerJamRp: 200_000 };

  function setupBerlaku() {
    const slot = {
      startAt: new Date('2026-10-05T02:00:00Z'),
      endAt: new Date('2026-10-05T03:00:00Z'),
      branchId: branchA,
      classTypeId: classType,
      instructorFeeRp: null,
      isManualFee: false,
    };
    const tx = {
      instructorFee: {
        findUnique: jest.fn().mockResolvedValue(keliru),
        findMany: jest.fn().mockResolvedValue([keliru, benar]),
        delete: jest.fn().mockResolvedValue({}),
      },
      slotKelas: { findMany: jest.fn().mockResolvedValue([slot]) },
    };
    const db = { ...tx, $transaction: jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)) };
    const service = new EffectiveSettingsService(
      new MasterAccessService(new PolicyService()),
      db as never,
    );
    return { service, tx };
  }

  it('menunjukkan dampaknya pada honor sebelum dihapus', async () => {
    const { service } = setupBerlaku();
    await expect(service.dampakHapus(superOwner, rowId)).resolves.toMatchObject({
      sudahBerlaku: true,
      duplikat: false,
      kelasTerdampak: 1,
      honorSekarangRp: 300_000,
      honorSetelahHapusRp: 200_000,
    });
  });

  it('menghapus bila diminta sebagai salah input, dengan alasan cukup panjang', async () => {
    const { service, tx } = setupBerlaku();
    await expect(
      service.remove(superOwner, 'INSTRUCTOR_FEE', rowId, 'c', 'Salah pilih tipe kelas', true),
    ).resolves.toEqual({ id: rowId, deleted: true });
    expect(tx.instructorFee.delete).toHaveBeenCalledWith({ where: { id: rowId } });
  });

  it('tetap menolak tanpa tanda salah input, tanpa izin, atau dengan alasan pendek', async () => {
    const { service, tx } = setupBerlaku();
    await expect(
      service.remove(superOwner, 'INSTRUCTOR_FEE', rowId, 'c', 'Salah pilih tipe kelas'),
    ).rejects.toMatchObject({ code: 'RATE_IN_EFFECT' });
    await expect(
      service.remove(finance, 'INSTRUCTOR_FEE', rowId, 'c', 'Salah pilih tipe kelas', true),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      service.remove(superOwner, 'INSTRUCTOR_FEE', rowId, 'c', 'Salah', true),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(tx.instructorFee.delete).not.toHaveBeenCalled();
  });
});
