import { test, expect } from '@playwright/test';
import { adminCredentials, loginWithCredentials } from '../helpers/auth';

const creds = adminCredentials();

test.describe('admin login → dashboard', () => {
  test.skip(!creds, 'Set VITE_TEST_ADMIN_EMAIL and VITE_TEST_ADMIN_PASSWORD');

  test('admin can open dashboard without access restriction', async ({ page }) => {
    await loginWithCredentials(page, creds!.email, creds!.password);
    await page.goto('/#/dashboard');

    await expect(page).toHaveURL(/#\/dashboard/);
    await expect(page.getByText('Access restricted')).not.toBeVisible();
    await expect(page.getByRole('heading', { name: 'Sign in' })).not.toBeVisible();
  });
});
