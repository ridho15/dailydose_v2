import { bolehTerimaBukti, buktiDitolak } from './bukti-aman';

describe('siapa boleh mengunggah bukti setelah batas bayar', () => {
  const lewat = { status: 'PENDING', paymentExpiresAt: new Date(Date.now() - 86_400_000) };
  it('staf cabang tetap boleh mengunggah bukti manual untuk pesanan yang masih menunggu', () => {
    expect(bolehTerimaBukti(lewat, true)).toBe(true);
    expect(bolehTerimaBukti(lewat, false)).toBe(false);
    expect(buktiDitolak(lewat)).toBe('PAYMENT_PROOF_DEADLINE_PASSED');
  });
  it('pesanan yang sudah diputus tidak menerima bukti, dari siapa pun', () => {
    expect(bolehTerimaBukti({ status: 'PAID', paymentExpiresAt: null }, true)).toBe(false);
    expect(buktiDitolak({ status: 'CANCELLED' })).toBe('PAYMENT_PROOF_ORDER_CLOSED');
  });
});
