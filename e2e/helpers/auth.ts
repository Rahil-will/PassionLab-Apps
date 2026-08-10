import { expect, type Page } from '@playwright/test';

export function adminCredentials(): { email: string; password: string } | null {
  const email = process.env.VITE_TEST_ADMIN_EMAIL;
  const password = process.env.VITE_TEST_ADMIN_PASSWORD;
  if (!email || !password) return null;
  return { email, password };
}

export function viewerCredentials(): { email: string; password: string } | null {
  const email = process.env.VITE_TEST_VIEWER_EMAIL;
  const password = process.env.VITE_TEST_VIEWER_PASSWORD;
  if (!email || !password) return null;
  return { email, password };
}

/** Order UUID for style-details viewer assertions (must exist in the test factory). */
export function testOrderId(): string | null {
  const id = process.env.VITE_TEST_ORDER_ID?.trim();
  return id || null;
}

export async function loginWithCredentials(
  page: Page,
  email: string,
  password: string,
): Promise<void> {
  await page.goto('/');
  await page.getByPlaceholder('name@company.com').fill(email);
  await page.getByPlaceholder('Password').fill(password);
  await page.getByRole('button', { name: 'Sign In' }).click();
  await expect(page.getByText('Access restricted')).not.toBeVisible({ timeout: 30_000 });
}
