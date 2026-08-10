import { test, expect } from '@playwright/test';
import { adminCredentials, loginWithCredentials } from '../helpers/auth';

const creds = adminCredentials();

test.describe('day report', () => {
  test.skip(!creds, 'Set VITE_TEST_ADMIN_EMAIL and VITE_TEST_ADMIN_PASSWORD');

  test('loads toolbar or department skeleton', async ({ page }) => {
    await loginWithCredentials(page, creds!.email, creds!.password);
    await page.goto('/#/reports/day');

    await expect(page).toHaveURL(/#\/reports\/day/);
    await expect(page.getByText('Access restricted')).not.toBeVisible();

    const searchInput = page.getByPlaceholder('Filter style, ref, PO, buyer…');
    const loadingDepartments = page.getByText('Loading departments…');
    const skeleton = page.locator('.animate-pulse').first();
    await expect(searchInput.or(loadingDepartments).or(skeleton)).toBeVisible({
      timeout: 30_000,
    });
  });
});
