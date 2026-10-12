# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: smoke\fabric-v4-facilities.spec.ts >> fabric v4 facilities setup >> open Facilities & machines, add a vendor, save
- Location: e2e\smoke\fabric-v4-facilities.spec.ts:10:3

# Error details

```
Test timeout of 30000ms exceeded.
```

```
Error: expect(locator).toBeVisible() failed

Locator: getByText('Facilities & machines').first()
Expected: visible
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 30000ms
  - waiting for getByText('Facilities & machines').first()
  - Test timeout of 30000ms exceeded.

```

```yaml
- text: PRODIGI
- heading "Smart Factory Operating System" [level=1]
- paragraph: Production execution for apparel factories. Orders, planning, floor capture, and reports in one place.
- heading "Real-time Visibility" [level=3]
- heading "Actionable Insights" [level=3]
- heading "Full Traceability" [level=3]
- text: Secured by RBC Enterprise
- heading "Sign in" [level=2]
- paragraph: Use the credentials provided by your administrator.
- text: Email
- textbox "name@company.com": your-admin@email
- text: Password
- button "Forgot?"
- textbox "Password": your-password
- button "Sign In"
- paragraph: New factory setup? Contact RBC to provision your workspace. Self-service factory creation is not available in this app.
- button "Open Tanstack query devtools":
  - img
```

# Test source

```ts
  1  | import { test, expect } from '@playwright/test';
  2  | import { adminCredentials, loginWithCredentials } from '../helpers/auth';
  3  | 
  4  | const creds = adminCredentials();
  5  | const stamp = Date.now().toString(36);
  6  | 
  7  | test.describe('fabric v4 facilities setup', () => {
  8  |   test.skip(!creds, 'Set VITE_TEST_ADMIN_EMAIL and VITE_TEST_ADMIN_PASSWORD');
  9  | 
  10 |   test('open Facilities & machines, add a vendor, save', async ({ page }) => {
  11 |     await loginWithCredentials(page, creds!.email, creds!.password);
  12 | 
  13 |     await page.goto('/#/material-management');
> 14 |     await expect(page.getByText('Facilities & machines').first()).toBeVisible({ timeout: 30_000 });
     |                                                                   ^ Error: expect(locator).toBeVisible() failed
  15 |     await page.getByText('Facilities & machines', { exact: true }).first().click();
  16 | 
  17 |     await expect(page.getByText('Mills').first()).toBeVisible({ timeout: 20_000 });
  18 |     await expect(page.getByText('Processing units').first()).toBeVisible();
  19 |     await expect(page.getByText('Warehouses').first()).toBeVisible();
  20 |     await expect(page.getByText('Fabric vendors').first()).toBeVisible();
  21 | 
  22 |     // Add under Fabric vendors (last Add in that section)
  23 |     const vendorSection = page.locator('section').filter({ hasText: 'Fabric vendors' });
  24 |     await vendorSection.getByRole('button', { name: 'Add' }).click();
  25 | 
  26 |     await page.getByLabel('Code').fill(`V${stamp}`);
  27 |     await page.getByLabel('Name').fill(`Vendor ${stamp}`);
  28 |     await page.getByRole('button', { name: 'Save Changes' }).click();
  29 | 
  30 |     await expect(page.getByText(`Vendor ${stamp}`).first()).toBeVisible({ timeout: 30_000 });
  31 |   });
  32 | });
  33 | 
```