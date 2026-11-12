import { test, expect } from '@playwright/test';

/**
 * SDLC ProMax UI Standards E2E Verification Suite
 * Enforces: UI/UX ProMax, Anti-Double Alert, Pagination/Search, Combobox, and Modal A11y
 */

const BASE_ROUTE = process.env.TEST_ROUTE_ITEMS || '/items';
const CREATE_ROUTE = process.env.TEST_ROUTE_CREATE || '/items/create';

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
});
