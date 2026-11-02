import { MEMEGANG_SESI } from './sesi-terpesan';

describe('MEMEGANG_SESI', () => {
  it('excludes legacy migrated V1 bookings (BKG-V1-*) so they do not hold active package sessions', () => {
    expect(MEMEGANG_SESI.NOT).toEqual({ bookingNumber: { startsWith: 'BKG-V1-' } });
  });

  it('includes BOOKED and uncompleted ATTENDED bookings', () => {
    expect(MEMEGANG_SESI.OR).toEqual([
      { status: 'BOOKED' },
      { status: 'ATTENDED', classSlot: { status: { notIn: ['COMPLETED', 'CANCELLED'] } } },
    ]);
  });
});
