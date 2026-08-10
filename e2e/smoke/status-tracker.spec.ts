import { test, expect } from '@playwright/test';
import { adminCredentials, loginWithCredentials } from '../helpers/auth';

const creds = adminCredentials();

test.describe('status tracker', () => {
  test.skip(!creds, 'Set VITE_TEST_ADMIN_EMAIL and VITE_TEST_ADMIN_PASSWORD');

  test('shows order table or loading skeleton', async ({ page }) => {
    await loginWithCredentials(page, creds!.email, creds!.password);
    await page.goto('/#/status-tracker');

    await expect(page).toHaveURL(/#\/status-tracker/);
    await expect(page.getByText('Access restricted')).not.toBeVisible();

    const searchInput = page.getByPlaceholder('Search style, PO, buyer...');
    const tableSkeleton = page.locator('.animate-pulse').first();
    await expect(searchInput.or(tableSkeleton)).toBeVisible({ timeout: 30_000 });
  });
});
