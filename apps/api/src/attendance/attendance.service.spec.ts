import { checkInWindowState, isOwningCustomer, isOwningInstructor } from './kehadiran.service';

describe('customer QR check-in window', () => {
  const start = new Date('2026-07-27T02:00:00.000Z');
  const end = new Date('2026-07-27T03:00:00.000Z');

  it('opens exactly forty-five minutes before the class (keputusan pemilik 22 November 2026)', () => {
    expect(checkInWindowState(start, end, new Date('2026-07-27T01:14:59.999Z'))).toBe('TOO_EARLY');
    expect(checkInWindowState(start, end, new Date('2026-07-27T01:15:00.000Z'))).toBe('OPEN');
  });

  it('remains open during class and expires exactly at class end', () => {
    expect(checkInWindowState(start, end, new Date('2026-07-27T02:59:59.999Z'))).toBe('OPEN');
    expect(checkInWindowState(start, end, end)).toBe('EXPIRED');
  });
});

describe('customer QR check-in ownership', () => {
  const principal = {
    userId: 'customer-a',
    roles: [{ role: 'CUSTOMER' as const, branchId: null }],
  };

  it('allows only the customer who owns the booking-bound token', () => {
    expect(isOwningCustomer(principal, 'customer-a')).toBe(true);
    expect(isOwningCustomer(principal, 'customer-b')).toBe(false);
  });


  it('does not treat a staff role as the owning customer path', () => {
    expect(
      isOwningCustomer(
        { userId: 'staff-a', roles: [{ role: 'ADMIN' as const, branchId: 'branch-a' }] },
        'staff-a',
      ),
    ).toBe(false);
  });
});

describe('instructor check-in token ownership', () => {
  const principal = {
    userId: 'instructor-a',
    capabilities: ['attendance:self'],
  };

  it('allows only the assigned instructor capability path', () => {
    expect(isOwningInstructor(principal, 'instructor-a')).toBe(true);
    expect(isOwningInstructor(principal, 'instructor-b')).toBe(false);
    expect(isOwningInstructor({ ...principal, capabilities: [] }, 'instructor-a')).toBe(false);
  });
});
