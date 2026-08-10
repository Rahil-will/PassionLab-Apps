import { test, expect } from '@playwright/test';
import { loginWithCredentials, testOrderId, viewerCredentials } from '../helpers/auth';

const creds = viewerCredentials();
const orderId = testOrderId();

test.describe('viewer read-only', () => {
  test.skip(!creds, 'Set VITE_TEST_VIEWER_EMAIL and VITE_TEST_VIEWER_PASSWORD');

  test('viewer cannot see a Save button on settings or work centers', async ({ page }) => {
    await loginWithCredentials(page, creds!.email, creds!.password);

    await page.goto('/#/settings');
    await expect(page.getByRole('button', { name: 'Save', exact: true })).toHaveCount(0);

    await page.goto('/#/work-centers');
    await expect(page.getByRole('button', { name: 'Save', exact: true })).toHaveCount(0);
  });

  test('viewer cannot see Edit Order on style details', async ({ page }) => {
    test.skip(!orderId, 'Set VITE_TEST_ORDER_ID to an order UUID the viewer can access');

    await loginWithCredentials(page, creds!.email, creds!.password);
    await page.goto(`/#/style-details/${orderId}`);

    await expect(page).toHaveURL(new RegExp(`#/style-details/${orderId}`));
    await expect(page.getByText('Access restricted')).not.toBeVisible();
    await expect(page.getByText('Style Information')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('button', { name: 'Edit Order' })).toHaveCount(0);
  });
});
