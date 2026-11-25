import { KeycloakJitService } from './keycloak-jit.service';

function jsonRes(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

describe('KeycloakJitService (DailyDose)', () => {
  const originalFetch = globalThis.fetch;
  const mutableEnv = process.env as Record<string, string | undefined>;
  const savedEnv = {
    KEYCLOAK_BASE_URL: mutableEnv.KEYCLOAK_BASE_URL,
    KEYCLOAK_REALM: mutableEnv.KEYCLOAK_REALM,
    KEYCLOAK_ADMIN_USER: mutableEnv.KEYCLOAK_ADMIN_USER,
    KEYCLOAK_ADMIN_PASSWORD: mutableEnv.KEYCLOAK_ADMIN_PASSWORD,
    HRG_CLIENT_ID: mutableEnv.HRG_CLIENT_ID,
    HRG_CLIENT_SECRET: mutableEnv.HRG_CLIENT_SECRET,
  };

  beforeEach(() => {
    mutableEnv.KEYCLOAK_BASE_URL = 'http://localhost:8080';
    mutableEnv.KEYCLOAK_REALM = 'hrgroup';
    mutableEnv.KEYCLOAK_ADMIN_USER = 'admin';
    mutableEnv.KEYCLOAK_ADMIN_PASSWORD = 'admin_test_password';
    mutableEnv.HRG_CLIENT_ID = 'dailydose';
    mutableEnv.HRG_CLIENT_SECRET = 'dd_test_secret';
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete mutableEnv[k];
      else mutableEnv[k] = v;
    }
  });

  it('migrates new user, persists akun_grup_tautan, and opens active OIDC session via Direct Access Grant', async () => {
    const db = {
      akunGrupTautan: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'link-dd-1' }),
      },
    } as any;

    const calls: string[] = [];
    globalThis.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push(`${init?.method || 'GET'} ${url}`);
      if (url.endsWith('/realms/master/protocol/openid-connect/token')) {
        return jsonRes({ access_token: 'adm-tok', expires_in: 60 });
      }
      if (url.includes('/admin/realms/hrgroup/users?')) {
        return jsonRes([]);
      }
      if (url.endsWith('/admin/realms/hrgroup/users') && init?.method === 'POST') {
        return new Response(null, {
          status: 201,
          headers: { Location: 'http://localhost:8080/admin/realms/hrgroup/users/kc-sub-dd-1' },
        });
      }
      if (url.endsWith('/realms/hrgroup/protocol/openid-connect/token')) {
        return jsonRes({ access_token: 'oidc-tok', refresh_token: 'ref-tok' });
      }
      throw new Error(`Unexpected URL: ${url}`);
    }) as any;

    const svc = new KeycloakJitService(db);
    const ok = await svc.migrateUserJit(
      { id: 'usr-dd-1', email: 'sarah@dailydose.local', displayName: 'Sarah Wijaya' },
      'Pass123!',
    );

    expect(ok).toBe(true);
    expect(db.akunGrupTautan.create).toHaveBeenCalledTimes(1);
    expect(calls).toContain('POST http://localhost:8080/realms/hrgroup/protocol/openid-connect/token');
  });

  it('recovers from invalid_grant on existing link by resetting password via Keycloak sub', async () => {
    const db = {
      akunGrupTautan: {
        findFirst: jest.fn().mockResolvedValue({ id: 'link-2', userId: 'usr-dd-2', hrgSub: 'kc-sub-dd-2' }),
        create: jest.fn(),
      },
    } as any;

    let grantAttempt = 0;
    let resetCalled = false;
    globalThis.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/realms/hrgroup/protocol/openid-connect/token')) {
        grantAttempt++;
        if (grantAttempt === 1) return jsonRes({ error: 'invalid_grant' }, 401);
        return jsonRes({ access_token: 'oidc-recovered' });
      }
      if (url.endsWith('/realms/master/protocol/openid-connect/token')) {
        return jsonRes({ access_token: 'adm-tok', expires_in: 60 });
      }
      if (url.endsWith('/admin/realms/hrgroup/users/kc-sub-dd-2') && (!init?.method || init.method === 'GET')) {
        return jsonRes({ id: 'kc-sub-dd-2', username: 'sarah.dd', email: 'sarah@dailydose.local' });
      }
      if (url.endsWith('/admin/realms/hrgroup/users/kc-sub-dd-2/reset-password') && init?.method === 'PUT') {
        resetCalled = true;
        return new Response(null, { status: 204 });
      }
      throw new Error(`Unexpected URL: ${url}`);
    }) as any;

    const svc = new KeycloakJitService(db);
    const ok = await svc.migrateUserJit(
      { id: 'usr-dd-2', email: 'sarah@dailydose.local', displayName: 'Sarah Wijaya' },
      'PassBaru2026!',
    );

    expect(ok).toBe(true);
    expect(grantAttempt).toBe(2);
    expect(resetCalled).toBe(true);
  });

  it('fails safely without throwing when secrets are missing or Keycloak is unreachable', async () => {
    delete mutableEnv.KEYCLOAK_ADMIN_PASSWORD;
    delete mutableEnv.HRG_CLIENT_SECRET;

    const db = {
      akunGrupTautan: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn() },
    } as any;

    const svc = new KeycloakJitService(db);
    await expect(
      svc.migrateUserJit({ id: 'usr-dd-3', email: 'x@dd.local', displayName: 'X' }, 'pw'),
    ).resolves.toBe(false);
  });
});
