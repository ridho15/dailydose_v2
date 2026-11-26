import { KeycloakJitService } from './keycloak-jit.service';

function jsonRes(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

describe('KeycloakJitService (DailyDose - HRG_* Service Account)', () => {
  const originalFetch = globalThis.fetch;
  const mutableEnv = process.env as Record<string, string | undefined>;
  const savedEnv = {
    HRG_ISSUER: mutableEnv.HRG_ISSUER,
    HRG_CLIENT_ID: mutableEnv.HRG_CLIENT_ID,
    HRG_CLIENT_SECRET: mutableEnv.HRG_CLIENT_SECRET,
    KEYCLOAK_ADMIN_USER: mutableEnv.KEYCLOAK_ADMIN_USER,
    KEYCLOAK_ADMIN_PASSWORD: mutableEnv.KEYCLOAK_ADMIN_PASSWORD,
  };

  beforeEach(() => {
    delete mutableEnv.KEYCLOAK_ADMIN_USER;
    delete mutableEnv.KEYCLOAK_ADMIN_PASSWORD;
    mutableEnv.HRG_ISSUER = 'http://localhost:8080/realms/hrgroup';
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

  it('migrates new user using client_credentials (HRG_* only) and opens active OIDC session', async () => {
    const db = {
      akunGrupTautan: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'lnk-dd-1' }),
      },
    } as any;

    let memberRoleAssigned = false;
    const grants: string[] = [];
    globalThis.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/realms/hrgroup/protocol/openid-connect/token')) {
        const params = new URLSearchParams(String(init?.body || ''));
        const gt = params.get('grant_type') || '';
        grants.push(gt);
        return jsonRes({ access_token: gt === 'client_credentials' ? 'sa-tok' : 'oidc-tok', expires_in: 60 });
      }
      if (url.includes('/admin/realms/hrgroup/users?')) return jsonRes([]);
      if (url.includes('/admin/realms/hrgroup/clients?clientId=dailydose')) {
        return jsonRes([{ id: 'client-dd-uuid', clientId: 'dailydose' }]);
      }
      if (url.endsWith('/admin/realms/hrgroup/clients/client-dd-uuid/roles/member')) {
        return jsonRes({ id: 'role-dd-member', name: 'member' });
      }
      if (url.endsWith('/role-mappings/clients/client-dd-uuid') && init?.method === 'POST') {
        memberRoleAssigned = true;
        return new Response(null, { status: 204 });
      }
      if (url.endsWith('/admin/realms/hrgroup/users') && init?.method === 'POST') {
        return new Response(null, {
          status: 201,
          headers: { Location: 'http://localhost:8080/admin/realms/hrgroup/users/kc-sub-dd-1' },
        });
      }
      throw new Error(`Unexpected URL: ${url}`);
    }) as any;

    const svc = new KeycloakJitService(db);
    const ok = await svc.migrateUserJit(
      { id: 'usr-dd-1', email: 'sarah@dailydose.local', displayName: 'Sarah Wijaya' },
      'Pass123!',
    );

    expect(ok).toBe(true);
    expect(memberRoleAssigned).toBe(true);
    expect(grants).toEqual(['client_credentials', 'password']);
  });

  it('recovers from invalid_grant on existing link via Service Account reset-password', async () => {
    const db = {
      akunGrupTautan: {
        findFirst: jest.fn().mockResolvedValue({ id: 'link-2', userId: 'usr-dd-2', hrgSub: 'kc-sub-dd-2' }),
        create: jest.fn(),
      },
    } as any;

    let passwordAttempt = 0;
    let resetCalled = false;
    globalThis.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/realms/hrgroup/protocol/openid-connect/token')) {
        const params = new URLSearchParams(String(init?.body || ''));
        if (params.get('grant_type') === 'client_credentials') {
          return jsonRes({ access_token: 'sa-tok', expires_in: 60 });
        }
        passwordAttempt++;
        if (passwordAttempt === 1) return jsonRes({ error: 'invalid_grant' }, 401);
        return jsonRes({ access_token: 'oidc-recovered' });
      }
      if (url.endsWith('/admin/realms/hrgroup/users/kc-sub-dd-2') && (!init?.method || init.method === 'GET')) {
        return jsonRes({ id: 'kc-sub-dd-2', username: 'sarah.dd', enabled: true });
      }
      if (url.includes('/admin/realms/hrgroup/clients?clientId=dailydose')) {
        return jsonRes([{ id: 'client-dd-uuid', clientId: 'dailydose' }]);
      }
      if (url.endsWith('/admin/realms/hrgroup/clients/client-dd-uuid/roles/member')) {
        return jsonRes({ id: 'role-dd-member', name: 'member' });
      }
      if (url.endsWith('/users/kc-sub-dd-2/role-mappings/clients/client-dd-uuid')) {
        return jsonRes([{ id: 'role-dd-member', name: 'member' }]);
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
    expect(passwordAttempt).toBe(2);
    expect(resetCalled).toBe(true);
  });

  it('fails safely without throwing when HRG_CLIENT_SECRET is missing', async () => {
    delete mutableEnv.HRG_CLIENT_SECRET;
    const db = { akunGrupTautan: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn() } } as any;
    const svc = new KeycloakJitService(db);
    await expect(
      svc.migrateUserJit({ id: 'usr-dd-3', email: 'x@dd.local', displayName: 'X' }, 'pw'),
    ).resolves.toBe(false);
  });

  it('returns blocked when user is disabled or app client role was revoked in Keycloak', async () => {
    const db = {
      akunGrupTautan: {
        findFirst: jest.fn().mockResolvedValue({ id: 'link-4', userId: 'usr-dd-4', hrgSub: 'kc-sub-dd-4' }),
        create: jest.fn(),
      },
    } as any;
    globalThis.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/realms/hrgroup/protocol/openid-connect/token')) {
        return jsonRes({ access_token: 'sa-tok', expires_in: 60 });
      }
      if (url.endsWith('/admin/realms/hrgroup/users/kc-sub-dd-4')) {
        return jsonRes({ id: 'kc-sub-dd-4', username: 'blocked.dd', enabled: true });
      }
      if (url.includes('/admin/realms/hrgroup/clients?clientId=dailydose')) {
        return jsonRes([{ id: 'client-dd-uuid', clientId: 'dailydose' }]);
      }
      if (url.endsWith('/admin/realms/hrgroup/clients/client-dd-uuid/roles/member')) {
        return jsonRes({ id: 'role-dd-member', name: 'member' });
      }
      if (url.endsWith('/users/kc-sub-dd-4/role-mappings/clients/client-dd-uuid')) {
        return jsonRes([]);
      }
      throw new Error(`Unexpected URL: ${url}`);
    }) as any;

    const svc = new KeycloakJitService(db);
    await expect(
      svc.checkAndSyncUser({ id: 'usr-dd-4', email: 'blocked@dd.local', displayName: 'Blocked' }, 'pw'),
    ).resolves.toBe('blocked');
  });
});
