import { test, expect } from '@playwright/test';
import { adminCredentials, loginWithCredentials } from '../helpers/auth';

const creds = adminCredentials();
const stamp = Date.now().toString(36);

test.describe('material config flow', () => {
  test.skip(!creds, 'Set VITE_TEST_ADMIN_EMAIL and VITE_TEST_ADMIN_PASSWORD');

  test('enable in Settings → configure in Material Management', async ({ page }) => {
    await loginWithCredentials(page, creds!.email, creds!.password);

    await page.goto('/#/settings?tab=material');
    await expect(page.getByRole('button', { name: 'Material' })).toBeVisible({ timeout: 30_000 });

    const enableBtn = page.getByRole('button', { name: 'Enable Material' });
    if (await enableBtn.isVisible().catch(() => false)) {
      await enableBtn.click();
      await expect(page.getByText('Enabled')).toBeVisible({ timeout: 30_000 });
    }

    await page.goto('/#/material-management');
    await expect(page.getByText('Groups & types').first()).toBeVisible({ timeout: 20_000 });

    await page.getByText('Groups & types', { exact: true }).first().click();
    await page.getByPlaceholder('New type name').fill(`Knit ${stamp}`);
    await page.getByRole('button', { name: 'Add type' }).click();
    await expect(page.getByText(`Knit ${stamp}`)).toBeVisible({ timeout: 20_000 });

    await page.getByText('Attributes', { exact: true }).click();
    await page.getByPlaceholder('Label').fill(`GSM ${stamp}`);
    await page.locator('select').nth(2).selectOption('test');
    await page.getByRole('button', { name: 'Add' }).click();
    await expect(page.getByText(`GSM ${stamp}`)).toBeVisible({ timeout: 20_000 });

    await page.getByText('Test templates', { exact: true }).click();
    await page.getByPlaceholder('Template name').fill(`Tmpl ${stamp}`);
    const firstAttr = page.locator('label').filter({ hasText: `GSM ${stamp}` }).locator('input[type="checkbox"]');
    if (await firstAttr.count()) await firstAttr.check();
    await page.getByRole('button', { name: 'Save template' }).click();
    await expect(page.getByText(`Tmpl ${stamp}`)).toBeVisible({ timeout: 20_000 });

    await page.getByText('Locations', { exact: true }).click();
    await page.getByPlaceholder('Code').fill(`Z${stamp}`);
    await page.getByPlaceholder('Name').fill(`Zone ${stamp}`);
    await page.locator('select').filter({ hasText: 'rack' }).first().selectOption('zone');
    await page.getByRole('button', { name: 'Add' }).click();
    await expect(page.getByText(`Z${stamp}`)).toBeVisible({ timeout: 20_000 });

    await page.getByText('Suppliers', { exact: true }).click();
    await page.getByPlaceholder('Code').fill(`S${stamp}`);
    await page.getByPlaceholder('Name').fill(`Supplier ${stamp}`);
    await page.getByRole('button', { name: 'Add' }).click();
    await expect(page.getByText(`S${stamp}`)).toBeVisible({ timeout: 20_000 });

    await page.getByText('Materials', { exact: true }).click();
    await page.getByPlaceholder('Code').fill(`M${stamp}`);
    await page.getByPlaceholder('Name').fill(`Material ${stamp}`);
    const typeSelect = page.locator('select').nth(1);
    const typeOptions = await typeSelect.locator('option').allTextContents();
    const pick = typeOptions.find((t) => t.includes(stamp)) ?? typeOptions.find((t) => t && !t.includes('Select'));
    if (pick) await typeSelect.selectOption({ label: pick });
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText(`M${stamp}`)).toBeVisible({ timeout: 20_000 });
  });
});
