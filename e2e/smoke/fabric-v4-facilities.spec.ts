import { test, expect } from '@playwright/test';
import { adminCredentials, loginWithCredentials } from '../helpers/auth';

const creds = adminCredentials();
const stamp = Date.now().toString(36);
const credsUsable =
  Boolean(creds)
  && !/your-admin@email|example\.com|placeholder/i.test(creds!.email)
  && !/^your-password$/i.test(creds!.password);

test.describe('fabric v4 facilities setup', () => {
  test.skip(!credsUsable, 'Set real VITE_TEST_ADMIN_EMAIL and VITE_TEST_ADMIN_PASSWORD');

  test('open Facilities & machines, add a vendor, save', async ({ page }) => {
    test.setTimeout(90_000);
    await loginWithCredentials(page, creds!.email, creds!.password);

    await page.goto('/#/settings?tab=material');
    const enableBtn = page.getByRole('button', { name: 'Enable Material' });
    if (await enableBtn.isVisible().catch(() => false)) {
      await enableBtn.click();
      await expect(page.getByText('Enabled')).toBeVisible({ timeout: 30_000 });
    }

    await page.goto('/#/material-management');
    await expect(page.getByText('Select a section to configure').or(page.getByText('Fabric types').first())).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText('Facilities & machines').first()).toBeVisible({ timeout: 30_000 });
    await page.getByText('Facilities & machines', { exact: true }).first().click();

    await expect(page.getByText('Mills').first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('Processing units').first()).toBeVisible();
    await expect(page.getByText('Warehouses').first()).toBeVisible();
    await expect(page.getByText('Fabric vendors').first()).toBeVisible();

    // Add under Fabric vendors (last Add in that section)
    const vendorSection = page.locator('section').filter({ hasText: 'Fabric vendors' });
    await vendorSection.getByRole('button', { name: 'Add' }).click();

    await page.getByLabel('Code').fill(`V${stamp}`);
    await page.getByLabel('Name').fill(`Vendor ${stamp}`);
    await page.getByRole('button', { name: 'Save Changes' }).click();

    await expect(page.getByText(`Vendor ${stamp}`).first()).toBeVisible({ timeout: 30_000 });
  });
});
