import { SchedulerService } from './scheduler.service';

function build(
  overrides: {
    orders?: jest.Mock;
    packages?: jest.Mock;
    autoCancel?: jest.Mock;
    reminders?: jest.Mock;
  } = {},
) {
  const db = {
    paketPelanggan: { updateMany: overrides.packages ?? jest.fn().mockResolvedValue({ count: 2 }) },
  };
  const orders = {
    expirePendingOrders: overrides.orders ?? jest.fn().mockResolvedValue({ expiredCount: 3 }),
  };
  const autoCancel = {
    evaluateClasses:
      overrides.autoCancel ??
      jest
        .fn()
        .mockResolvedValue({
          evaluatedSlotsCount: 5,
          confirmedSlotsCount: 3,
          cancelledSlotsCount: 1,
        }),
  };
  const reminders = {
    runAllReminders: overrides.reminders ?? jest.fn().mockResolvedValue({ adminDigestsSent: 1 }),
  };
  const kirimQr = {
    kirimOtomatis: jest.fn().mockResolvedValue({ dikirim: 0, gagal: 0, dilewati: 0 }),
  };
  const service = new SchedulerService(
    db as never,
    orders as never,
    autoCancel as never,
    reminders as never,
    kirimQr as never,
  );
  return { service, db, orders, autoCancel, reminders, kirimQr };
}

describe('SchedulerService', () => {
  const original = process.env.SCHEDULER_ENABLED;
  afterEach(() => {
    if (original === undefined) delete process.env.SCHEDULER_ENABLED;
    else process.env.SCHEDULER_ENABLED = original;
    jest.useRealTimers();
  });

  it('stays off by default so dev and tests never send messages or cancel anything', () => {
    delete process.env.SCHEDULER_ENABLED;
    const { service, orders } = build();
    service.onApplicationBootstrap();
    expect(service.enabled).toBe(false);
    expect(service.status().jobs).toHaveLength(5);
    expect(orders.expirePendingOrders).not.toHaveBeenCalled();
    expect(service.isHealthy()).toBe(true);
    service.onModuleDestroy();
  });

  it('runs the real work of each job and records the outcome', async () => {
    const { service, db } = build();
    const orders = await service.runJob('expire-orders');
    expect(orders).toMatchObject({ lastOk: true, runCount: 1, lastResult: { expiredCount: 3 } });
    const packages = await service.runJob('expire-packages');
    expect(db.paketPelanggan.updateMany).toHaveBeenCalledWith({
      where: { status: 'ACTIVE', validUntil: { lt: expect.any(Date) } },
      data: { status: 'EXPIRED' },
    });
    expect(packages.lastResult).toEqual({ expiredCount: 2 });
    expect((await service.runJob('auto-cancel')).lastResult).toEqual({
      skipped: false,
      evaluated: 5,
      confirmed: 3,
      cancelled: 1,
    });
    expect((await service.runJob('reminders')).lastResult).toEqual({ adminDigestsSent: 1 });
  });

  it('a failing job is recorded without throwing, keeps no raw message, and later runs still work', async () => {
    const orders = jest
      .fn()
      .mockRejectedValueOnce(new Error('password=secret'))
      .mockResolvedValue({ expiredCount: 0 });
    const { service } = build({ orders });
    const failed = await service.runJob('expire-orders');
    expect(failed).toMatchObject({ lastOk: false, failCount: 1, lastError: 'Error' });
    expect(JSON.stringify(failed)).not.toContain('secret');
    const recovered = await service.runJob('expire-orders');
    expect(recovered).toMatchObject({ lastOk: true, failCount: 1, runCount: 2, lastError: null });
  });

  it('never runs the same job twice at once', async () => {
    let release!: () => void;
    const slow = jest.fn(
      () =>
        new Promise<{ expiredCount: number }>(
          (resolve) => (release = () => resolve({ expiredCount: 1 })),
        ),
    );
    const { service } = build({ orders: slow });
    const first = service.runJob('expire-orders');
    const second = await service.runJob('expire-orders');
    expect(second.running).toBe(true);
    expect(slow).toHaveBeenCalledTimes(1);
    release();
    await first;
    expect(service.status().jobs.find((job) => job.name === 'expire-orders')).toMatchObject({
      running: false,
      runCount: 1,
    });
  });

  it('when enabled, waits before the first run, then repeats on each interval', async () => {
    jest.useFakeTimers();
    process.env.SCHEDULER_ENABLED = 'true';
    const { service, orders } = build();
    service.onApplicationBootstrap();
    expect(orders.expirePendingOrders).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(30_000);
    expect(orders.expirePendingOrders).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(15 * 60_000);
    expect(orders.expirePendingOrders).toHaveBeenCalledTimes(2);
    service.onModuleDestroy();
    await jest.advanceTimersByTimeAsync(60 * 60_000);
    expect(orders.expirePendingOrders).toHaveBeenCalledTimes(2);
  });

  it('is unhealthy only when an enabled job stopped succeeding for 3 intervals', async () => {
    jest.useFakeTimers();
    process.env.SCHEDULER_ENABLED = 'true';
    const { service } = build();
    service.onApplicationBootstrap();
    expect(service.isHealthy()).toBe(true); // masa tenggang sejak hidup
    await jest.advanceTimersByTimeAsync(31_000);
    expect(service.isHealthy()).toBe(true);
    // Hanya satu pekerjaan yang dijalankan manual; yang lain belum pernah berhasil setelah masa tenggang.
    jest.setSystemTime(Date.now() + 4 * 60 * 60_000);
    expect(service.isHealthy(Date.now())).toBe(false);
    service.onModuleDestroy();
  });
});
