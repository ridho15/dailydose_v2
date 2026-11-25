import { ConfigGatedGoogleProvider } from './provider-adapters';
import { IdentityService } from './identity.service';
import { PolicyService } from './policy.service';

describe('pendaftaran member mewajibkan selfie', () => {
  const db = { user: { findFirst: jest.fn().mockResolvedValue(null) } };
  const service = new IdentityService(
    db as never,
    new PolicyService(),
    new ConfigGatedGoogleProvider(),
    { consume: jest.fn() } as never,
    { sendAction: jest.fn() } as never,
  );
  const isian = {
    displayName: 'Sari Dewi',
    phone: '081234567890',
    email: 'sari@contoh.id',
    password: 'rahasia-panjang-1',
    consent: true,
  };

  it('menolak pendaftaran tanpa foto selfie sebelum menyentuh database', async () => {
    await expect(service.registerCustomer(isian)).rejects.toMatchObject({
      status: 422,
      details: [expect.objectContaining({ field: 'selfie' })],
    });
    expect(db.user.findFirst).not.toHaveBeenCalled();
  });

  it('menolak pendaftaran tanpa centang Syarat & Ketentuan, juga bila formulir dilewati', async () => {
    db.user.findFirst.mockClear();
    await expect(service.registerCustomer({ ...isian, consent: false })).rejects.toMatchObject({
      status: 422,
      response: 'TERMS_CONSENT_REQUIRED',
      details: [expect.objectContaining({ field: 'consent' })],
    });
    expect(db.user.findFirst).not.toHaveBeenCalled();
  });

  it('tidak meminta KTP', async () => {
    // Dengan selfie, pemeriksaan lolos sampai pengecekan duplikat; KTP tidak ikut diperiksa.
    db.user.findFirst.mockResolvedValueOnce({ email: 'sari@contoh.id' });

    await expect(
      service.registerCustomer({
        ...isian,
        selfie: {
          buffer: Buffer.from('x'),
          originalName: 'selfie.jpg',
          claimedMimeType: 'image/jpeg',
        },
      }),
    ).rejects.toMatchObject({ status: 409 });
  });
});
