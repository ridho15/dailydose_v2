import { test, expect } from '@playwright/test';

/**
 * SDLC ProMax UI Standards E2E Verification Suite
 * Enforces: UI/UX ProMax, Anti-Double Alert, Pagination/Search, Combobox, and Modal A11y
 */

const BASE_ROUTE = process.env.TEST_ROUTE_ITEMS || '/items';
const CREATE_ROUTE = process.env.TEST_ROUTE_CREATE || '/items/create';
// Security tests (11, 12): login endpoint, valid test credentials, and an endpoint that requires a session
const API_LOGIN = process.env.TEST_API_LOGIN || '/api/login';
const LOGIN_PAYLOAD = process.env.TEST_LOGIN_PAYLOAD || '{"username":"demo","password":"demo-pass"}';
const API_PROTECTED = process.env.TEST_API_PROTECTED || '/api/admin/users';
// Data-flow test (13): accessible label of the text field to type into on the create form
const CREATE_FIELD_LABEL = process.env.TEST_CREATE_FIELD_LABEL || 'Nama';
// Data-verification tests (9, 10): list endpoint returning { items, totalItems }, and a valid create payload
const API_ITEMS = process.env.TEST_API_ITEMS || '/api/items';
const CREATE_PAYLOAD = process.env.TEST_CREATE_PAYLOAD || '{"name":"{{unique}}","category":"Kategori A"}';

test.describe('SDLC ProMax UI Standards Verification Suite', () => {
  test('1. Data List enforces pagination controls, debounced search, and filters', async ({ page }) => {
    await page.goto(BASE_ROUTE);
    
    const searchInput = page.locator('[data-testid="search-input"]');
    await expect(searchInput).toBeVisible();
    await expect(page.locator('[data-testid="pagination-controls"]')).toBeVisible();

    // Debounce: typing quickly must never send a request for a half-typed term like "Que"
    const searchTerms: string[] = [];
    page.on('request', (req) => {
      if (!['fetch', 'xhr'].includes(req.resourceType())) return;
      const term = new URL(req.url()).searchParams.get('search');
      if (term !== null) searchTerms.push(term);
    });
    await searchInput.pressSequentially('Query Test', { delay: 30 });
    await page.waitForTimeout(1000);
    expect(searchTerms.length, 'Search must reach the server as ?search=').toBeGreaterThan(0);
    expect(searchTerms.every((t) => t === 'Query Test'), `Undebounced requests: ${searchTerms.join(', ')}`).toBe(true);
  });

  test('2. Dynamic Select uses Async Searchable Combobox instead of raw select', async ({ page }) => {
    await page.goto(CREATE_ROUTE);
    
    // Combobox trigger must be present
    const combobox = page.locator('[data-testid="async-searchable-select"]');
    await expect(combobox).toBeVisible();
    await combobox.click();

    // Async search input inside dropdown must receive query
    const dropdownSearch = page.locator('[data-testid="async-select-search-input"]');
    await expect(dropdownSearch).toBeVisible();
    await dropdownSearch.fill('Kategori A');

    // Options container must display results
    const optionsList = page.locator('[data-testid="async-select-options"]');
    await expect(optionsList).toBeVisible();
  });

  test('3. Alert Manager prevents double alerts and displays explicit failure cause', async ({ page }) => {
    await page.goto(CREATE_ROUTE);
    
    // Submitting the empty form must fail; rapid double click must still yield exactly one alert
    const submitBtn = page.locator('button[type="submit"]');
    await expect(submitBtn, 'Create form must have a submit button').toBeVisible();
    await submitBtn.dblclick();

    const alerts = page.locator('[role="alert"]');
    await expect(alerts.first()).toBeVisible();
    // Wait for all in-flight requests so a late second alert cannot slip past the count check
    await page.waitForLoadState('networkidle');
    await expect(alerts).toHaveCount(1);
  });

  test('4. Destructive action triggers unified Confirmation Modal with Escape & Focus Trap', async ({ page }) => {
    await page.goto(BASE_ROUTE);
    
    // Requires at least one seeded row in the list
    const deleteBtn = page.locator('[data-testid="delete-item-btn"]').first();
    await expect(deleteBtn, 'List must render a delete button with data-testid="delete-item-btn"').toBeVisible();
    await deleteBtn.click();

    const modal = page.locator('[role="dialog"]');
    await expect(modal).toBeVisible();

    // Focus trap: tabbing many times must keep focus inside the dialog
    for (let i = 0; i < 5; i++) await page.keyboard.press('Tab');
    expect(await modal.evaluate((el) => el.contains(document.activeElement))).toBe(true);

    await page.keyboard.press('Escape');
    await expect(modal).toBeHidden();
  });

  test('5. Security: XSS payloads in search are rendered as text and never executed', async ({ page }) => {
    const dialogs: string[] = [];
    page.on('dialog', async (d) => { dialogs.push(d.message()); await d.dismiss(); });
    await page.addInitScript(() => { (window as any).__xss = 0; });

    const payload = '<img src=x onerror="window.__xss=1;alert(1)">';
    await page.goto(BASE_ROUTE);
    await page.locator('[data-testid="search-input"]').fill(payload);
    await page.waitForTimeout(1000); // debounce + response + any reflected render
    // Also covers payloads reflected from the URL (page.goto with ?search=)
    await page.goto(`${BASE_ROUTE}?search=${encodeURIComponent(payload)}`);
    await page.waitForTimeout(500);

    expect(await page.evaluate(() => (window as any).__xss), 'Payload executed script (XSS)').toBe(0);
    expect(dialogs, 'Payload opened a dialog (XSS)').toEqual([]);
    await expect(page.locator('img[src="x"]'), 'Payload was injected as a real <img>').toHaveCount(0);
  });

  test('6. Accessibility: touch targets are at least 44px and the page does not scroll sideways', async ({ page }) => {
    await page.goto(BASE_ROUTE);
    const targets = page.locator(
      '[data-testid="search-input"], [data-testid="pagination-controls"] button, [data-testid="pagination-controls"] select'
    );
    await expect(targets.first()).toBeVisible();
    const sizes = await targets.evaluateAll((els) =>
      els.map((el) => ({ name: el.getAttribute('aria-label') || el.tagName, h: el.getBoundingClientRect().height }))
    );
    const tooSmall = sizes.filter((s) => s.h < 43.5);
    expect(tooSmall, `Controls under 44px tall: ${JSON.stringify(tooSmall)}`).toEqual([]);

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, 'Page scrolls horizontally at this viewport').toBeLessThanOrEqual(0);
  });

  test('7. Accessibility: combobox is labelled and announces the highlighted option', async ({ page }) => {
    await page.goto(CREATE_ROUTE);
    const combobox = page.locator('[data-testid="async-searchable-select"]');
    await expect(combobox).toBeVisible();

    // The visible <label> must be programmatically linked to the trigger
    const id = await combobox.getAttribute('id');
    expect(id, 'Combobox trigger needs an id so <label htmlFor> can point at it').toBeTruthy();
    await expect(page.locator(`label[for="${id}"]`)).toHaveCount(1);

    await combobox.click();
    const option = page.locator('[role="option"]').first();
    await expect(option).toBeVisible();
    // aria-activedescendant must reference a real option so screen readers follow keyboard navigation
    const activeId = await page.locator('[data-testid="async-select-search-input"]').getAttribute('aria-activedescendant');
    expect(activeId, 'Search input must expose aria-activedescendant').toBeTruthy();
    await expect(page.locator(`[role="option"][id="${activeId}"]`)).toHaveCount(1);
  });

  test('8. Security: response carries baseline security headers', async ({ page }) => {
    const response = await page.goto(BASE_ROUTE);
    const headers = response!.headers();
    expect(headers['x-content-type-options'], 'Missing X-Content-Type-Options: nosniff').toBe('nosniff');
    expect(
      headers['content-security-policy'] || headers['x-frame-options'],
      'Missing Content-Security-Policy or X-Frame-Options (clickjacking/XSS hardening)'
    ).toBeTruthy();
  });

  test('9. Data verification: displayed totals and rows reconcile with the API and survive a reload', async ({ page }) => {
    const isListCall = (r: { url(): string; request(): { method(): string } }) =>
      new URL(r.url()).pathname === API_ITEMS && r.request().method() === 'GET';

    const [first] = await Promise.all([page.waitForResponse(isListCall), page.goto(BASE_ROUTE)]);
    const api = await first.json();
    expect(typeof api.totalItems, `API list must return a numeric "totalItems" (got ${JSON.stringify(Object.keys(api))})`).toBe('number');

    const shownTotal = () => page.locator('[data-testid="pagination-controls"] strong').first().textContent();
    await expect(page.locator('[data-testid="pagination-controls"]')).toBeVisible();
    expect(Number(await shownTotal()), 'Total shown on screen differs from the API totalItems').toBe(api.totalItems);

    // One delete button per row (also required by test 4): rendered rows must equal the rows the API returned
    await expect(page.locator('[data-testid="delete-item-btn"]')).toHaveCount(api.items.length);

    // Independent count: walking every page must yield exactly totalItems rows (catches a wrong total or skipped/duplicated rows)
    const seen = new Set<string>();
    let counted = 0;
    for (let p = 1; p <= 200; p++) {
      const res = await page.request.get(`${API_ITEMS}?page=${p}&limit=10`);
      expect(res.ok(), `Page ${p} of the list API failed with HTTP ${res.status()}`).toBe(true);
      const rows: Array<{ id?: unknown }> = (await res.json()).items ?? [];
      if (rows.length === 0) break;
      counted += rows.length;
      rows.forEach((r) => seen.add(JSON.stringify(r.id ?? r)));
    }
    expect(counted, 'Rows across all pages differ from totalItems').toBe(api.totalItems);
    expect(seen.size, 'Duplicate rows across pages (unstable ordering or paging bug)').toBe(counted);

    const [second] = await Promise.all([page.waitForResponse(isListCall), page.reload()]);
    const apiAfter = await second.json();
    expect(apiAfter.totalItems, 'Total changed after a plain reload').toBe(api.totalItems);
    expect(Number(await shownTotal()), 'Total on screen differs from the API after reload').toBe(apiAfter.totalItems);
  });

  test('10. Data verification: a record written through the API is read back correctly in the UI and persists', async ({ page, request }) => {
    const unique = `E2E-${Date.now()}`;
    const payload = JSON.parse(CREATE_PAYLOAD.replace('{{unique}}', unique));

    const created = await request.post(API_ITEMS, { data: payload });
    expect(created.ok(), `Create call failed with HTTP ${created.status()}`).toBe(true);

    const findInUi = async () => {
      await page.locator('[data-testid="search-input"]').fill(unique);
      await expect(page.getByText(unique, { exact: true }), 'Saved record is not shown by the UI').toBeVisible();
    };
    await page.goto(BASE_ROUTE);
    await findInUi();

    // Persistence: still there after a hard reload (not just kept in client state)
    await page.reload();
    await findInUi();

    // Clean up so repeated runs do not pollute the test database
    const list = await request.get(`${API_ITEMS}?search=${encodeURIComponent(unique)}`);
    const record = (await list.json()).items?.find((i: { name?: string }) => i.name === unique);
    if (record?.id !== undefined) await request.delete(`${API_ITEMS}/${record.id}`);
  });

  test('11. Security: session cookie is HttpOnly and SameSite, and JavaScript cannot read it', async ({ page, baseURL }) => {
    await page.goto(BASE_ROUTE);
    const login = await page.request.post(API_LOGIN, { data: JSON.parse(LOGIN_PAYLOAD) });
    expect(login.ok(), `Login failed with HTTP ${login.status()}; set TEST_LOGIN_PAYLOAD to valid test credentials`).toBe(true);

    const setCookie = login.headersArray().filter((h) => h.name.toLowerCase() === 'set-cookie').map((h) => h.value);
    expect(setCookie.length, 'Login must set a session cookie').toBeGreaterThan(0);
    for (const cookie of setCookie) {
      expect(cookie, `Cookie is readable by JavaScript (missing HttpOnly): ${cookie.split('=')[0]}`).toMatch(/;\s*HttpOnly/i);
      expect(cookie, `Cookie has no SameSite attribute (CSRF risk): ${cookie.split('=')[0]}`).toMatch(/;\s*SameSite=(Lax|Strict)/i);
      if (baseURL?.startsWith('https:')) expect(cookie, 'Cookie over HTTPS must be Secure').toMatch(/;\s*Secure/i);
    }

    // The browser must actually refuse to expose it to scripts
    const names = setCookie.map((c) => c.split('=')[0]);
    const visible = await page.evaluate(() => document.cookie);
    for (const name of names) expect(visible, `document.cookie exposes ${name}`).not.toContain(`${name}=`);
  });

  test('12. Security: protected endpoint rejects requests without a session and accepts them with one', async ({ playwright, baseURL }) => {
    const anonymous = await playwright.request.newContext({ baseURL });
    const denied = await anonymous.get(API_PROTECTED);
    expect([401, 403], `Endpoint ${API_PROTECTED} answered HTTP ${denied.status()} without a session (broken access control)`).toContain(denied.status());
    expect(await denied.text(), 'Denied response must not leak data').not.toMatch(/"items"\s*:\s*\[\s*\{/);

    const wrong = await anonymous.post(API_LOGIN, { data: { username: 'nobody', password: 'wrong-password' } });
    expect([400, 401, 403, 422, 429], `Bad credentials answered HTTP ${wrong.status()}`).toContain(wrong.status());

    // Control: the same endpoint works with a real session, so the 401 above is access control and not a broken route
    const login = await anonymous.post(API_LOGIN, { data: JSON.parse(LOGIN_PAYLOAD) });
    expect(login.ok(), `Login failed with HTTP ${login.status()}`).toBe(true);
    const allowed = await anonymous.get(API_PROTECTED);
    expect(allowed.status(), 'Endpoint must work with a valid session').toBe(200);
    await anonymous.dispose();
  });

  test('13. Data flow: a record entered in the UI is saved, listed, and counted identically end to end', async ({ page, request }) => {
    const unique = `FLOW-${Date.now()}`;

    // Input: type the value in the real form and submit it
    await page.goto(CREATE_ROUTE);
    await page.getByLabel(CREATE_FIELD_LABEL).fill(unique);
    const [saveResponse] = await Promise.all([
      page.waitForResponse((r) => new URL(r.url()).pathname === API_ITEMS && r.request().method() === 'POST'),
      page.locator('button[type="submit"]').click()
    ]);
    expect(saveResponse.ok(), `Saving from the UI failed with HTTP ${saveResponse.status()}`).toBe(true);

    // Saved: read the record back from the API (independent of what the screen shows)
    const apiList = await (await request.get(`${API_ITEMS}?search=${encodeURIComponent(unique)}`)).json();
    const matches = (apiList.items ?? []).filter((i: { name?: string }) => i.name === unique);
    expect(matches.length, 'Record typed in the UI must be stored exactly once with the same value').toBe(1);

    // Displayed: the list shows the same value and the same count as the API
    await page.goto(BASE_ROUTE);
    await page.locator('[data-testid="search-input"]').fill(unique);
    await expect(page.getByText(unique, { exact: true }), 'Stored record is not displayed in the list').toBeVisible();
    await expect(page.locator('[data-testid="pagination-controls"] strong').first()).toHaveText(String(apiList.totalItems));

    // Clean up so repeated runs do not pollute the test database
    if (matches[0].id !== undefined) await request.delete(`${API_ITEMS}/${matches[0].id}`);
  });
});
