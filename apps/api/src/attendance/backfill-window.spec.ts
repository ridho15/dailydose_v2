import { checkInWindowState } from './kehadiran.service';

describe('CheckInWindowState for Frontdesk Manual Backfill', () => {
  const startAt = new Date('2026-10-31T10:00:00.000Z');
  const endAt = new Date('2026-10-31T10:50:00.000Z');

  it('rejects manual backfill before H-45 minutes (TOO_EARLY)', () => {
    // 46 minutes before start
    const early = new Date(startAt.getTime() - 46 * 60_000);
    expect(checkInWindowState(startAt, endAt, early)).toBe('TOO_EARLY');
  });

  it('allows manual backfill within H-45 minutes window before class starts (OPEN)', () => {
    // 40 minutes before start
    const within30m = new Date(startAt.getTime() - 40 * 60_000);
    expect(checkInWindowState(startAt, endAt, within30m)).toBe('OPEN');

    // 10 minutes before start
    const within10m = new Date(startAt.getTime() - 10 * 60_000);
    expect(checkInWindowState(startAt, endAt, within10m)).toBe('OPEN');
  });

  it('allows manual backfill during class ongoing (OPEN)', () => {
    // 15 minutes after start
    const ongoing = new Date(startAt.getTime() + 15 * 60_000);
    expect(checkInWindowState(startAt, endAt, ongoing)).toBe('OPEN');
  });

  it('returns EXPIRED after class end time (past endAt)', () => {
    // 5 minutes after class ended
    const finished = new Date(endAt.getTime() + 5 * 60_000);
    expect(checkInWindowState(startAt, endAt, finished)).toBe('EXPIRED');
  });
});
