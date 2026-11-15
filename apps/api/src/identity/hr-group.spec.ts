import {
  hrGroupConfig,
  openFlow,
  phoneVariants,
  safeReturnTo,
  sealFlow,
  signHrg,
  verifyHrgSignature,
} from './hr-group';
import { HrGroupService, type HrgClaims } from './hr-group.service';
import { HrGroupController } from './hr-group.controller';
import { RateLimitService } from './rate-limit.service';
import { hashPassword } from './credential-security';

const ENV = {
  HRG_ENABLED: 'true',
  HRG_ISSUER: 'https://akun.hrgroup.test/',
  HRG_CLIENT_ID: 'dailydose',
  HRG_CLIENT_SECRET: 'client-secret-for-tests',
  HRG_REDIRECT_URI: 'https://dailydose.test/api/v1/auth/hr-group/callback',
  HRG_BRIDGE_SECRET: 'bridge-secret-for-tests',
};

const CUSTOMER_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_ID = '22222222-2222-4222-8222-222222222222';
const STAFF_ID = '33333333-3333-4333-8333-333333333333';
const SUB = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

describe('hrGroupConfig (feature flag)', () => {
  it('is off unless HRG_ENABLED=true', () => {
    expect(hrGroupConfig({ ...ENV, HRG_ENABLED: 'false' })).toBeNull();
    expect(hrGroupConfig({ ...ENV, HRG_ENABLED: undefined })).toBeNull();
  });

  it('is off when any required variable is missing', () => {
    for (const key of Object.keys(ENV).filter((k) => k !== 'HRG_ENABLED'))
      expect(hrGroupConfig({ ...ENV, [key]: '' })).toBeNull();
  });

  it('is on with every variable present, issuer without trailing slash', () => {
    expect(hrGroupConfig(ENV)).toMatchObject({ issuer: 'https://akun.hrgroup.test', clientId: 'dailydose' });
  });
});

describe('safeReturnTo', () => {
  it('keeps same-site relative paths', () => {
    expect(safeReturnTo('/account')).toBe('/account');
    expect(safeReturnTo('/classes?branch=a#top')).toBe('/classes?branch=a#top');
  });

  it.each([
    'https://evil.example/account',
    '//evil.example/account',
    '/\\evil.example',
    'javascript:alert(1)',
    'account',
    '/a\nb',
    '',
    undefined,
    ['/account'],
  ])('rejects %p and falls back to /account', (value) => {
    expect(safeReturnTo(value)).toBe('/account');
  });
});

describe('HMAC signature (X-HRG-Timestamp / X-HRG-Signature)', () => {
  const body = Buffer.from('{"identifier":"+628123456789","password":"rahasia123"}');
  const now = 1_800_000_000;
  const ts = String(now);

  it('accepts hex(HMAC-SHA256(secret, timestamp + "." + rawBody))', () => {
    const signature = signHrg('s3cret', ts, body);
    expect(signature).toMatch(/^[0-9a-f]{64}$/u);
    expect(verifyHrgSignature('s3cret', ts, signature, body, now)).toBe('ok');
    expect(verifyHrgSignature('s3cret', ts, signature.toUpperCase(), body, now + 300)).toBe('ok');
  });

  it('rejects a wrong secret, tampered body, or malformed signature', () => {
    const signature = signHrg('s3cret', ts, body);
    expect(verifyHrgSignature('other', ts, signature, body, now)).toBe('bad_signature');
    expect(verifyHrgSignature('s3cret', ts, signature, Buffer.from('{}'), now)).toBe('bad_signature');
    expect(verifyHrgSignature('s3cret', ts, 'abc', body, now)).toBe('bad_signature');
    expect(verifyHrgSignature('s3cret', ts, undefined, body, now)).toBe('bad_signature');
  });

  it('rejects a timestamp more than 300 seconds away', () => {
    const signature = signHrg('s3cret', ts, body);
    expect(verifyHrgSignature('s3cret', ts, signature, body, now + 301)).toBe('stale');
    expect(verifyHrgSignature('s3cret', ts, signature, body, now - 301)).toBe('stale');
    expect(verifyHrgSignature('s3cret', undefined, signature, body, now)).toBe('stale');
    expect(verifyHrgSignature('s3cret', 'abc', signature, body, now)).toBe('stale');
  });
});

describe('flow cookie (state, nonce, PKCE verifier)', () => {
  const flow = { state: 's', nonce: 'n', verifier: 'v', returnTo: '/account', exp: 2_000 };

  it('round-trips and rejects tampering, the wrong key, and expiry', () => {
    const sealed = sealFlow(flow, 'key');
    expect(openFlow(sealed, 'key', 1_000)).toEqual(flow);
    expect(openFlow(sealed, 'other-key', 1_000)).toBeNull();
    expect(openFlow(`${sealed.slice(0, -2)}AA`, 'key', 1_000)).toBeNull();
    expect(openFlow(sealed, 'key', 2_001)).toBeNull();
    expect(openFlow(undefined, 'key', 1_000)).toBeNull();
  });

  it('never yields an off-site returnTo even if one was sealed', () => {
    const sealed = sealFlow({ ...flow, returnTo: '//evil.example' }, 'key');
    expect(openFlow(sealed, 'key', 1_000)?.returnTo).toBe('/account');
  });
});

describe('phoneVariants', () => {
  it('covers legacy formats of an Indonesian number', () => {
    expect(phoneVariants('+628123456789')).toEqual(['+628123456789', '08123456789', '628123456789']);
  });
});

type Row = { id: string; role: string; status: string; email?: string | null; phone?: string | null; passwordHash?: string | null; displayName?: string };

function makeDb(users: Row[], links: Array<{ hrgSub: string; userId: string }> = []) {
  const matches = (user: Row, where: any) => {
    if (where.id) return user.id === where.id;
    if (where.email) return user.email === where.email;
    if (where.phone?.in) return where.phone.in.includes(user.phone);
    return false;
  };
  return {
    user: {
      findUnique: jest.fn(async ({ where }: any) => users.find((u) => matches(u, where)) ?? null),
      findFirst: jest.fn(async ({ where }: any) => users.find((u) => matches(u, where)) ?? null),
      findMany: jest.fn(async ({ where }: any) => users.filter((u) => matches(u, where))),
      create: jest.fn(async ({ data }: any) => {
        const row = { ...data };
        users.push(row);
        return { id: row.id, role: row.role, status: row.status };
      }),
    },
    akunGrupTautan: {
      findUnique: jest.fn(async ({ where }: any) => links.find((l) => l.hrgSub === where.hrgSub) ?? null),
      create: jest.fn(async ({ data }: any) => {
        links.push(data);
        return data;
      }),
    },
  };
}

function makeService(db: ReturnType<typeof makeDb>) {
  const audit = { catat: jest.fn().mockResolvedValue(undefined) };
  const service = new HrGroupService(db as never, {} as never, new RateLimitService({} as never), audit as never);
  return { service, audit };
}

const claims = (extra: Partial<HrgClaims> = {}): HrgClaims => ({ sub: SUB, name: 'Ayu', ...extra });

describe('HrGroupService.resolveUser (mapping per contract)', () => {
  it('step 1: an existing local link logs that user in without creating another link', async () => {
    const db = makeDb([{ id: CUSTOMER_ID, role: 'CUSTOMER', status: 'ACTIVE' }], [{ hrgSub: SUB, userId: CUSTOMER_ID }]);
    const { service } = makeService(db);
    await expect(service.resolveUser(claims(), 'c')).resolves.toMatchObject({ userId: CUSTOMER_ID, step: 'link', linked: false });
    expect(db.akunGrupTautan.create).not.toHaveBeenCalled();
    expect(db.user.create).not.toHaveBeenCalled();
  });

  it('step 2: hrg_links.dailydose pointing at an existing user creates the link', async () => {
    const db = makeDb([{ id: CUSTOMER_ID, role: 'CUSTOMER', status: 'ACTIVE' }]);
    const { service, audit } = makeService(db);
    await expect(
      service.resolveUser(claims({ hrg_links: { dailydose: CUSTOMER_ID, limitless: '9' } }), 'c'),
    ).resolves.toMatchObject({ userId: CUSTOMER_ID, step: 'hrg_links', linked: true });
    expect(db.akunGrupTautan.create).toHaveBeenCalledWith({ data: expect.objectContaining({ hrgSub: SUB, userId: CUSTOMER_ID }) });
    expect(audit.catat).toHaveBeenCalledWith(null, expect.objectContaining({ action: 'auth.hrg_linked' }));
  });

  it('step 3: a verified phone matches a user stored in legacy 08 format', async () => {
    const db = makeDb([{ id: CUSTOMER_ID, role: 'CUSTOMER', status: 'ACTIVE', phone: '08123456789' }]);
    const { service } = makeService(db);
    await expect(
      service.resolveUser(claims({ phone_number: '+628123456789', phone_number_verified: true }), 'c'),
    ).resolves.toMatchObject({ userId: CUSTOMER_ID, step: 'phone', linked: true });
  });

  it('step 3: an unverified phone is never used to match', async () => {
    const db = makeDb([{ id: CUSTOMER_ID, role: 'CUSTOMER', status: 'ACTIVE', phone: '+628123456789' }]);
    const { service } = makeService(db);
    const result = await service.resolveUser(claims({ phone_number: '+628123456789', phone_number_verified: false }), 'c');
    expect(result.step).toBe('created');
    expect(result.userId).not.toBe(CUSTOMER_ID);
  });

  it('step 3: a verified email matches (case-insensitive)', async () => {
    const db = makeDb([{ id: CUSTOMER_ID, role: 'CUSTOMER', status: 'ACTIVE', email: 'ayu@example.com' }]);
    const { service } = makeService(db);
    await expect(
      service.resolveUser(claims({ email: 'Ayu@Example.com', email_verified: true }), 'c'),
    ).resolves.toMatchObject({ userId: CUSTOMER_ID, step: 'email' });
  });

  it('step 3: staff matched by verified email signs in as that staff user with the local role', async () => {
    const db = makeDb([{ id: STAFF_ID, role: 'ADMIN', status: 'ACTIVE', email: 'admin@example.com' }]);
    const { service, audit } = makeService(db);
    await expect(
      service.resolveUser(claims({ email: 'admin@example.com', email_verified: true }), 'c'),
    ).resolves.toMatchObject({ userId: STAFF_ID, step: 'email' });
    expect(db.user.create).not.toHaveBeenCalled();
    expect(audit.catat).toHaveBeenCalledWith(null, expect.objectContaining({ action: 'auth.hrg_login', afterMasked: { step: 'email', role: 'ADMIN' } }));
  });

  it('step 3: phone and email pointing at two different users is refused as ambiguous', async () => {
    const db = makeDb([
      { id: CUSTOMER_ID, role: 'CUSTOMER', status: 'ACTIVE', phone: '+628123456789' },
      { id: OTHER_ID, role: 'CUSTOMER', status: 'ACTIVE', email: 'ayu@example.com' },
    ]);
    const { service, audit } = makeService(db);
    await expect(
      service.resolveUser(
        claims({ phone_number: '+628123456789', phone_number_verified: true, email: 'ayu@example.com', email_verified: true }),
        'c',
      ),
    ).rejects.toMatchObject({ code: 'ambiguous' });
    expect(audit.catat).toHaveBeenCalledWith(null, expect.objectContaining({ action: 'auth.hrg_ambiguous', objectId: SUB }));
    expect(db.akunGrupTautan.create).not.toHaveBeenCalled();
    expect(db.user.create).not.toHaveBeenCalled();
  });

  it('step 4: no match creates a CUSTOMER with verified claim data and links it', async () => {
    const db = makeDb([]);
    const { service, audit } = makeService(db);
    const result = await service.resolveUser(
      claims({ phone_number: '+628123456789', phone_number_verified: true, email: 'new@example.com', email_verified: true }),
      'c',
    );
    expect(result).toMatchObject({ step: 'created', linked: true });
    expect(db.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ role: 'CUSTOMER', status: 'ACTIVE', displayName: 'Ayu', phone: '+628123456789', email: 'new@example.com' }),
      }),
    );
    expect(audit.catat).toHaveBeenCalledWith(null, expect.objectContaining({ action: 'auth.hrg_customer_created' }));
  });

  it('staff are never auto-created: an unknown account always becomes CUSTOMER, unverified data is not copied', async () => {
    const db = makeDb([]);
    const { service } = makeService(db);
    await service.resolveUser({ ...claims({ email: 'boss@example.com', email_verified: false }), role: 'OWNER' } as HrgClaims, 'c');
    const data = db.user.create.mock.calls[0]![0].data;
    expect(data.role).toBe('CUSTOMER');
    expect(data.email).toBeNull();
  });

  it('a hrg_links id that does not exist locally falls through to the next steps', async () => {
    const db = makeDb([]);
    const { service } = makeService(db);
    await expect(service.resolveUser(claims({ hrg_links: { dailydose: OTHER_ID } }), 'c')).resolves.toMatchObject({ step: 'created' });
  });

  it('an inactive matched user is refused', async () => {
    const db = makeDb([{ id: CUSTOMER_ID, role: 'CUSTOMER', status: 'INACTIVE' }], [{ hrgSub: SUB, userId: CUSTOMER_ID }]);
    const { service } = makeService(db);
    await expect(service.resolveUser(claims(), 'c')).rejects.toMatchObject({ code: 'inactive' });
  });

  it('keeps login working when the link table does not exist yet', async () => {
    const { Prisma } = jest.requireActual('@prisma/client');
    const db = makeDb([{ id: CUSTOMER_ID, role: 'CUSTOMER', status: 'ACTIVE', email: 'ayu@example.com' }]);
    db.akunGrupTautan.findUnique.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('missing', { code: 'P2021', clientVersion: 'test' }),
    );
    const withRaw = Object.assign(db, { $queryRawUnsafe: jest.fn().mockResolvedValue([]) });
    const { service } = makeService(withRaw);
    await expect(
      service.resolveUser(claims({ email: 'ayu@example.com', email_verified: true }), 'c'),
    ).resolves.toMatchObject({ userId: CUSTOMER_ID, linked: false });
    expect(db.akunGrupTautan.create).not.toHaveBeenCalled();
  });
});

describe('HrGroupService.verifyCredentials (credential bridge)', () => {
  let passwordHash: string;
  beforeAll(async () => {
    passwordHash = await hashPassword('rahasia123');
  });

  const users = () => [
    { id: CUSTOMER_ID, role: 'CUSTOMER', status: 'ACTIVE', phone: '08123456789', email: 'ayu@example.com', passwordHash, displayName: 'Ayu' },
    { id: STAFF_ID, role: 'INSTRUCTOR', status: 'ACTIVE', phone: '+628999999999', email: 'coach@example.com', passwordHash, displayName: 'Coach' },
    { id: OTHER_ID, role: 'CUSTOMER', status: 'INACTIVE', email: 'old@example.com', passwordHash, displayName: 'Old' },
  ];

  it('answers an active customer by phone or email', async () => {
    const { service } = makeService(makeDb(users()));
    const expected = { userId: CUSTOMER_ID, name: 'Ayu', phone: '+628123456789', email: 'ayu@example.com', phoneVerified: false, emailVerified: false };
    await expect(service.verifyCredentials('+628123456789', 'rahasia123')).resolves.toEqual(expected);
    await expect(service.verifyCredentials('AYU@example.com', 'rahasia123')).resolves.toEqual(expected);
  });

  it('returns null for a wrong password, unknown identifier, staff, or inactive customer', async () => {
    const { service } = makeService(makeDb(users()));
    await expect(service.verifyCredentials('ayu@example.com', 'salah-sandi')).resolves.toBeNull();
    await expect(service.verifyCredentials('nobody@example.com', 'rahasia123')).resolves.toBeNull();
    await expect(service.verifyCredentials('coach@example.com', 'rahasia123')).resolves.toBeNull();
    await expect(service.verifyCredentials('+628999999999', 'rahasia123')).resolves.toBeNull();
    await expect(service.verifyCredentials('old@example.com', 'rahasia123')).resolves.toBeNull();
  });

  it('limits 10 attempts per identifier per 15 minutes', async () => {
    const { service } = makeService(makeDb(users()));
    const now = Date.UTC(2026, 10, 15, 3, 1);
    for (let i = 0; i < 10; i += 1) await service.verifyCredentials('limit@example.com', 'x', now);
    await expect(service.verifyCredentials('limit@example.com', 'x', now)).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    // Identifier lain tidak ikut terkunci.
    await expect(service.verifyCredentials('other-limit@example.com', 'x', now)).resolves.toBeNull();
  });
});

describe('HrGroupController', () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  function res() {
    const out: any = { statusCode: 200, body: undefined, location: undefined, cookies: [] as unknown[], cleared: [] as unknown[] };
    out.status = jest.fn((code: number) => ((out.statusCode = code), out));
    out.json = jest.fn((body: unknown) => ((out.body = body), out));
    out.redirect = jest.fn((code: number, url: string) => ((out.statusCode = code), (out.location = url), out));
    out.cookie = jest.fn((...args: unknown[]) => (out.cookies.push(args), out));
    out.clearCookie = jest.fn((...args: unknown[]) => (out.cleared.push(args), out));
    out.set = jest.fn(() => out);
    return out;
  }

  function req(body: unknown, headers: Record<string, string> = {}) {
    const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
    return { body, header: (name: string) => lower[name.toLowerCase()], correlationId: 'c' } as never;
  }

  const signed = (payload: object, secret = ENV.HRG_BRIDGE_SECRET, ts = String(Math.floor(Date.now() / 1000))) => {
    const raw = Buffer.from(JSON.stringify(payload));
    return req(raw, { 'X-HRG-Timestamp': ts, 'X-HRG-Signature': signHrg(secret, ts, raw) });
  };

  it('flag off: start answers 404 and verify-credentials 404', async () => {
    delete process.env.HRG_ENABLED;
    const controller = new HrGroupController({} as never);
    await expect(controller.start('/account', res())).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const out = res();
    await controller.verifyCredentials(signed({ identifier: 'a', password: 'b' }), out);
    expect(out.statusCode).toBe(404);
  });

  it('verify-credentials: valid signature returns the customer', async () => {
    Object.assign(process.env, ENV);
    const result = { userId: CUSTOMER_ID, name: 'Ayu', phone: null, email: null, phoneVerified: false, emailVerified: false };
    const service = { verifyCredentials: jest.fn().mockResolvedValue(result) };
    const out = res();
    await new HrGroupController(service as never).verifyCredentials(signed({ identifier: 'ayu@example.com', password: 'x' }), out);
    expect(out.statusCode).toBe(200);
    expect(out.body).toEqual(result);
    expect(service.verifyCredentials).toHaveBeenCalledWith('ayu@example.com', 'x');
  });

  it('verify-credentials: bad signature, stale timestamp, and wrong password share one generic 401', async () => {
    Object.assign(process.env, ENV);
    const service = { verifyCredentials: jest.fn().mockResolvedValue(null) };
    const controller = new HrGroupController(service as never);
    const stale = String(Math.floor(Date.now() / 1000) - 301);
    for (const request of [
      signed({ identifier: 'a@b.c', password: 'x' }, 'wrong-secret'),
      signed({ identifier: 'a@b.c', password: 'x' }, ENV.HRG_BRIDGE_SECRET, stale),
      signed({ identifier: 'a@b.c', password: 'x' }),
    ]) {
      const out = res();
      await controller.verifyCredentials(request, out);
      expect(out.statusCode).toBe(401);
      expect(out.body).toEqual({ error: 'invalid_credentials' });
    }
    // Hanya permintaan bertanda tangan valid yang sampai ke pemeriksaan password.
    expect(service.verifyCredentials).toHaveBeenCalledTimes(1);
  });

  it('verify-credentials: rate limit becomes 429', async () => {
    Object.assign(process.env, ENV);
    const { ApiProblem } = jest.requireActual('./security');
    const service = { verifyCredentials: jest.fn().mockRejectedValue(new ApiProblem('RATE_LIMITED', 429, true)) };
    const out = res();
    await new HrGroupController(service as never).verifyCredentials(signed({ identifier: 'a@b.c', password: 'x' }), out);
    expect(out.statusCode).toBe(429);
    expect(out.body).toEqual({ error: 'rate_limited' });
  });

  it('callback without a valid flow cookie or with a wrong state redirects with hrg_error=state', async () => {
    Object.assign(process.env, ENV);
    const service = { exchange: jest.fn() };
    const controller = new HrGroupController(service as never);
    const flow = sealFlow(
      { state: 'expected', nonce: 'n', verifier: 'v', returnTo: '/account', exp: Math.floor(Date.now() / 1000) + 60 },
      ENV.HRG_CLIENT_SECRET,
    );
    for (const request of [req(undefined), req(undefined, { cookie: `dd_hrg_flow=${flow}` })]) {
      const out = res();
      await controller.callback(request, out, 'code', 'other-state');
      expect(out.location).toBe('/sign-in?hrg_error=state');
    }
    const out = res();
    await controller.callback(req(undefined, { cookie: `dd_hrg_flow=${flow}` }), out, undefined, 'expected', 'access_denied');
    expect(out.location).toBe('/sign-in?hrg_error=cancelled');
    expect(service.exchange).not.toHaveBeenCalled();
  });

  it('callback success sets the session cookie, notifies HR Group, and redirects to returnTo', async () => {
    Object.assign(process.env, ENV);
    const service = {
      exchange: jest.fn().mockResolvedValue({ sub: SUB }),
      resolveUser: jest.fn().mockResolvedValue({ userId: CUSTOMER_ID, step: 'created', linked: true }),
      issueSession: jest.fn().mockResolvedValue({ webCookieToken: 'tok', webRefreshToken: 'ref' }),
      notifyLink: jest.fn().mockResolvedValue(undefined),
    };
    const flow = sealFlow(
      { state: 'expected', nonce: 'n', verifier: 'v', returnTo: '/classes', exp: Math.floor(Date.now() / 1000) + 60 },
      ENV.HRG_CLIENT_SECRET,
    );
    const out = res();
    await new HrGroupController(service as never).callback(req(undefined, { cookie: `dd_hrg_flow=${flow}` }), out, 'the-code', 'expected');
    expect(service.exchange).toHaveBeenCalledWith(expect.objectContaining({ clientId: 'dailydose' }), 'the-code', expect.objectContaining({ verifier: 'v' }));
    expect(out.cookies.map((c: unknown[]) => c[0])).toEqual(['dd_session', 'dd_refresh']);
    expect(service.notifyLink).toHaveBeenCalledWith(expect.anything(), SUB, CUSTOMER_ID);
    expect(out.location).toBe('/classes');
  });

  it('callback maps an ambiguous match to hrg_error=ambiguous without a session', async () => {
    Object.assign(process.env, ENV);
    const { HrgLoginError } = jest.requireActual('./hr-group.service');
    const service = {
      exchange: jest.fn().mockResolvedValue({ sub: SUB }),
      resolveUser: jest.fn().mockRejectedValue(new HrgLoginError('ambiguous')),
      issueSession: jest.fn(),
    };
    const flow = sealFlow(
      { state: 'expected', nonce: 'n', verifier: 'v', returnTo: '/account', exp: Math.floor(Date.now() / 1000) + 60 },
      ENV.HRG_CLIENT_SECRET,
    );
    const out = res();
    await new HrGroupController(service as never).callback(req(undefined, { cookie: `dd_hrg_flow=${flow}` }), out, 'c', 'expected');
    expect(out.location).toBe('/sign-in?hrg_error=ambiguous');
    expect(service.issueSession).not.toHaveBeenCalled();
    expect(out.cookies).toEqual([]);
  });
});
