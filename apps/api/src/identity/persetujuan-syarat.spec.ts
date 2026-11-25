import { Prisma } from '@prisma/client';
import { catatPersetujuan, setuju, sudahSetujuVersiIni, VERSI_SYARAT, wajibSetuju } from './persetujuan-syarat';

describe('Persetujuan Syarat & Ketentuan', () => {
  it('hanya true atau "true" yang dianggap setuju; selain itu 422 TERMS_CONSENT_REQUIRED dengan field-nya', () => {
    expect(setuju(true)).toBe(true);
    expect(setuju('true')).toBe(true);
    for (const v of [false, 'false', undefined, null, 1, 'ya']) expect(setuju(v)).toBe(false);
    expect(() => wajibSetuju(undefined, 'setujuSyarat')).toThrow(
      expect.objectContaining({ response: 'TERMS_CONSENT_REQUIRED', status: 422 }),
    );
  });

  it('mencatat versi yang berlaku, jenis, pembelian, dan staf pencatat', async () => {
    const create = jest.fn(async () => ({}));
    const ok = await catatPersetujuan({ persetujuanSyarat: { create, findFirst: jest.fn() } }, {}, {
      userId: 'u1',
      jenis: 'PEMBELIAN_STAF',
      purchaseId: 'p1',
      dicatatOleh: 'admin',
      userAgent: 'x'.repeat(400),
    });
    expect(ok).toBe(true);
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: 'u1', jenis: 'PEMBELIAN_STAF', versi: VERSI_SYARAT, purchaseId: 'p1', dicatatOleh: 'admin' }),
    });
    expect((create.mock.calls[0] as any)[0].data.userAgent).toHaveLength(255);
  });

  it('member dianggap belum setuju sampai ada catatan DAFTAR untuk versi ini; tabel belum ada tidak mengunci member', async () => {
    const findFirst = jest.fn().mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'a' });
    const db = { persetujuanSyarat: { create: jest.fn(), findFirst } };
    await expect(sudahSetujuVersiIni(db, 'u1')).resolves.toBe(false);
    await expect(sudahSetujuVersiIni(db, 'u1')).resolves.toBe(true);
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 'u1', jenis: 'DAFTAR', versi: VERSI_SYARAT } }));
    const galat = new Prisma.PrismaClientKnownRequestError('x', { code: 'P2021', clientVersion: 'x' });
    const tanpaTabel = { persetujuanSyarat: { create: jest.fn(), findFirst: jest.fn().mockRejectedValue(galat) } };
    await expect(sudahSetujuVersiIni(tanpaTabel, 'u1')).resolves.toBe(true);
  });

  it('versi API sama dengan versi teks di web', () => {
    const web = require('node:fs').readFileSync(require('node:path').join(__dirname, '../../../web/app/lib/syarat-ketentuan.ts'), 'utf8');
    expect(web).toContain(`export const VERSI_SYARAT = '${VERSI_SYARAT}';`);
  });
});

