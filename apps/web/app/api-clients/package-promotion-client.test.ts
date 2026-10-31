import { describe, expect, it } from 'vitest';
import { promotionFailure } from './package-promotion-client';

const failure = (status: number, body: unknown) => ({
  response: new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  }),
});

describe('promotionFailure', () => {
  it('names the overlap, stale version, expired and resource exists cases in Indonesian', async () => {
    await expect(
      promotionFailure(failure(409, { error: { code: 'RESOURCE_EXISTS' } }), 'x'),
    ).resolves.toMatch(/sudah digunakan oleh paket lain/);
    await expect(
      promotionFailure(failure(409, { error: { code: 'PROMOTION_OVERLAP' } }), 'x'),
    ).resolves.toMatch(/promo aktif pada paket ini di periode yang sama/);
    await expect(
      promotionFailure(failure(409, { error: { code: 'STALE_VERSION' } }), 'x'),
    ).resolves.toMatch(/diubah orang lain/);
    await expect(
      promotionFailure(failure(409, { error: { code: 'PROMOTION_EXPIRED' } }), 'x'),
    ).resolves.toMatch(/sudah berakhir/);
  });

  it('explains validation issues and falls back when there is nothing more specific', async () => {
    await expect(
      promotionFailure(
        failure(422, { error: { code: 'VALIDATION_ERROR', details: [{ issue: 'TOO_LARGE' }] } }),
        'x',
      ),
    ).resolves.toMatch(/terlalu besar/);
    await expect(
      promotionFailure(
        failure(422, { error: { code: 'VALIDATION_ERROR', details: [{ issue: 'IN_THE_PAST' }] } }),
        'x',
      ),
    ).resolves.toMatch(/sudah lewat/);
    await expect(promotionFailure(failure(500, {}), 'Fallback')).resolves.toBe('Fallback');
    await expect(promotionFailure(new Error('offline'), 'Fallback')).resolves.toBe('Fallback');
    await expect(promotionFailure(failure(403, {}), 'x')).resolves.toMatch(/izin/);
  });
});
