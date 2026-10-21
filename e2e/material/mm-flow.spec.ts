import { test, expect, type Locator, type Page } from '@playwright/test';
import { e2eCredentials, loginWithCredentials } from '../helpers/auth';

/**
 * Material Management end-to-end flow on the test factory ("abc" — the E2E
 * account must be scoped to it). One test.step per click-test row.
 * Login: E2E_EMAIL / E2E_PASSWORD (fallback VITE_TEST_ADMIN_*). When missing
 * or placeholder, the suite skips instead of failing.
 * Screenshots on failure come from the `material` project in playwright.config.ts.
 */
const creds = e2eCredentials();

const sfx = String(Date.now());
const baleUnit = `Bale-${sfx}`;
const rollCodes = [1, 2, 3].map((n) => `E2E-${sfx}-${n}`);
const dyeColour = 'Navy';
const GSTIN = '27ABCDE1234F1Z5';

/** SelectDropdown: <label htmlFor> points at the combobox button; options are role=option. */
async function pickSelect(page: Page, label: string, option: string): Promise<void> {
  const trigger = page.getByLabel(label).first();
  await trigger.click();
  await page.getByRole('option', { name: option, exact: true }).first().click();
}

/** Pick a dropdown option by the trigger's current text (unlabelled filter dropdowns). */
async function pickSelectByTriggerText(page: Page, triggerText: string, option: string): Promise<void> {
  await page.getByRole('combobox').filter({ hasText: triggerText }).first().click();
  await page.getByRole('option', { name: option, exact: true }).first().click();
}

async function openMaterialSection(page: Page, label: string): Promise<void> {
  await page.goto('/#/material-management');
  await page.getByText(label, { exact: true }).first().click();
}

async function saveSettingsPage(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Update in table' }).click();
  await page.getByRole('button', { name: 'Save Changes' }).click();
}

/** Header texts of the first table on the page, whitespace-normalised. */
async function firstTableHeaders(page: Page): Promise<string[]> {
  const texts = await page.locator('table').first().locator('thead th').allInnerTexts();
  return texts.map((t) => t.replace(/\s+/g, ' ').trim());
}

function headerIndex(headers: string[], pattern: RegExp): number {
  const idx = headers.findIndex((h) => pattern.test(h));
  if (idx === -1) throw new Error(`Column ${pattern} not found in: ${headers.join(' | ')}`);
  return idx;
}

/** MmSheetGrid cell edit: double-click, type, Enter commits. */
async function setSheetCell(table: Locator, row: number, col: number, value: string): Promise<void> {
  const td = table.locator('tbody tr').nth(row).locator('td').nth(col);
  await td.dblclick();
  const input = td.locator('input');
  await input.fill(value);
  await input.press('Enter');
}

/** Fill any still-empty required ("Label *") challan custom fields in the process-send card. */
async function fillRequiredChallanFields(page: Page): Promise<void> {
  const labels = page.locator('label').filter({ hasText: /\*\s*$/ });
  const count = await labels.count();
  for (let i = 0; i < count; i += 1) {
    const label = labels.nth(i);
    const text = (await label.innerText()).replace(/\*\s*$/, '').trim();
    if (/fabric|process|where/i.test(text)) continue;
    const forId = await label.getAttribute('for');
    if (!forId) continue;
    const control = page.locator(`[id="${forId}"]`);
    if ((await control.count()) === 0) continue;
    const tag = await control.evaluate((el) => el.tagName).catch(() => '');
    if (tag === 'INPUT') {
      if ((await control.inputValue()).trim() === '') {
        await control.fill(/colour|color/i.test(text) ? dyeColour : 'E2E');
      }
    } else if (tag === 'BUTTON') {
      const current = (await control.innerText()).trim();
      if (current === '' || /select/i.test(current)) {
        await control.click();
        const options = page.getByRole('option');
        const total = await options.count();
        for (let j = 0; j < total; j += 1) {
          const name = (await options.nth(j).innerText()).trim();
          if (name && name !== 'Select' && name !== '—') { await options.nth(j).click(); break; }
        }
      }
    }
  }
}

test.describe('material management flow (factory abc)', () => {
  test.skip(
    !creds,
    'Set E2E_EMAIL and E2E_PASSWORD (real credentials for the abc test factory) to run the material flow suite',
  );

  test('fabric types → inspection rules → vendors → processes → receive → inspection → dyeing → allocate → ITC-04', async ({ page }) => {
    test.setTimeout(900_000);
    await loginWithCredentials(page, creds!.email, creds!.password);

    let receiptUrl = '';
    let challanNo = '';
    let noteNo = '';

    await test.step('1. Fabric types: add Bale unit to Knit and save', async () => {
      await openMaterialSection(page, 'Fabric types');
      await page.getByText('Knit', { exact: true }).first().click();
      await page.getByLabel('Qty UOM').click();
      await page.getByRole('option', { name: '+ Add unit…' }).click();
      await page.getByLabel('Unit name').fill(baleUnit);
      await page.getByPlaceholder('0.00').fill('25');
      // Base defaults to KG in the add-unit modal.
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      await expect(page.getByText(baleUnit).first()).toBeVisible({ timeout: 20_000 });
      await saveSettingsPage(page);
      await expect(page.getByText('Fabric types saved')).toBeVisible({ timeout: 20_000 });
    });

    await test.step('2. Inspection rules: steps 10/20/100, Knit 40 / 28, reload shows same', async () => {
      await openMaterialSection(page, 'Fabric inspection rules');
      const stepInputs = page.getByLabel(/Step \d+ percent/);
      while ((await stepInputs.count()) < 3) await page.getByRole('button', { name: '+ Add step' }).click();
      while ((await stepInputs.count()) > 3) {
        const n = await stepInputs.count();
        await page.getByRole('button', { name: `Remove step ${n}` }).click();
      }
      await stepInputs.nth(0).fill('10');
      await stepInputs.nth(1).fill('20');
      await stepInputs.nth(2).fill('100');
      await page.getByLabel('Roll max for Knit').fill('40');
      await page.getByLabel('Lot average max for Knit').fill('28');
      await page.getByRole('button', { name: 'Save Changes' }).click();
      await expect(page.getByText('Fabric inspection rules saved')).toBeVisible({ timeout: 20_000 });

      await page.reload();
      await page.getByText('Fabric inspection rules', { exact: true }).first().click();
      await expect(page.getByLabel('Step 1 percent')).toHaveValue('10');
      await expect(page.getByLabel('Step 2 percent')).toHaveValue('20');
      await expect(page.getByLabel('Step 3 percent')).toHaveValue('100');
      await expect(page.getByLabel('Roll max for Knit')).toHaveValue('40');
      await expect(page.getByLabel('Lot average max for Knit')).toHaveValue('28');
    });

    await test.step('3. Fabric vendors: RK Mills GSTIN saves and shows in the column', async () => {
      await openMaterialSection(page, 'Fabric vendors');
      await page.getByText('RK Mills', { exact: true }).first().click();
      await page.getByLabel('GSTIN').fill(GSTIN);
      await saveSettingsPage(page);
      await expect(page.getByText(GSTIN).first()).toBeVisible({ timeout: 20_000 });
    });

    await test.step('4. Processes: Dyeing expected loss 10%', async () => {
      await page.goto('/#/material-management');
      await page.getByRole('button', { name: 'Processing' }).first().click();
      await page.getByText('Processes', { exact: true }).first().click();
      await page.getByText('Dyeing', { exact: true }).first().click();
      await page.getByLabel('Expected loss %').fill('10');
      await saveSettingsPage(page);
      const row = page.locator('tr').filter({ hasText: 'Dyeing' }).first();
      await expect(row.getByText('10%', { exact: true })).toBeVisible({ timeout: 20_000 });
    });

    await test.step('5. Receive 3 French Terry rolls at Greige from RK Mills', async () => {
      await page.goto('/#/material/warehouse/receive');
      await expect(page.getByText('Selected fabric')).toBeVisible({ timeout: 30_000 });
      // Fabric first (the vendor list filters by what the vendor supplies).
      await page.getByRole('combobox').filter({ hasText: 'Search fabric' }).click();
      await page.getByPlaceholder('Search fabric…').fill('French Terry');
      await page.locator('button').filter({ hasText: 'French Terry' })
        .filter({ hasNotText: 'New fabric' }).first().click();
      await pickSelect(page, 'Source', 'External');
      await pickSelect(page, 'From *', 'RK Mills');
      await pickSelect(page, 'Stage received', 'Greige');
      // Greige is not Finished (ready to cut): rolls can only be booked, not allocated.
      await expect(page.getByText(/not allocated/).first()).toBeVisible({ timeout: 20_000 });

      await page.getByLabel('Rolls').fill('3');
      await page.getByRole('button', { name: 'Generate', exact: true }).click();

      const grid = page.locator('table').first();
      const headers = await firstTableHeaders(page);
      const rollCol = headerIndex(headers, /Roll no/);
      const qtyCol = headerIndex(headers, /^Qty/);
      const widthCol = headers.findIndex((h) => /^Width/.test(h));
      for (let i = 0; i < rollCodes.length; i += 1) {
        await setSheetCell(grid, i, rollCol, rollCodes[i]);
        await setSheetCell(grid, i, qtyCol, '20');
        if (widthCol >= 0) await setSheetCell(grid, i, widthCol, '60');
      }
      await page.getByRole('button', { name: 'Save receipt' }).click();
      // Receipt opens.
      await expect(page.getByText('Receipt information').first()).toBeVisible({ timeout: 30_000 });
      await expect(page.getByText(rollCodes[0]).first()).toBeVisible({ timeout: 20_000 });
      receiptUrl = page.url();
    });

    await test.step('6. Staged inspection: fail at 10%, fail at next step, pass the rest at 100%', async () => {
      await page.getByRole('button', { name: 'Inspection', exact: true }).click();
      await expect(page.getByText('Sample 1 of 3 rolls')).toBeVisible({ timeout: 30_000 });

      const grid = page.locator('table').first();
      const headers = await firstTableHeaders(page);
      const sampleCol = headerIndex(headers, /^Sample/);
      const lengthCol = headerIndex(headers, /^Length/);
      const widthCol = headerIndex(headers, /^Width/);
      const pts4Col = headerIndex(headers, /^4 pt/);

      const selectedRows = async (): Promise<number[]> => {
        const rows: number[] = [];
        for (let i = 0; i < rollCodes.length; i += 1) {
          const box = grid.locator('tbody tr').nth(i).locator('td').nth(sampleCol).locator('input[type="checkbox"]');
          if ((await box.count()) > 0 && (await box.isChecked())) rows.push(i);
        }
        return rows;
      };
      const inspected = new Set<number>();
      const fillRow = async (row: number, fail: boolean) => {
        await setSheetCell(grid, row, lengthCol, '20');
        await setSheetCell(grid, row, widthCol, '60');
        if (fail) await setSheetCell(grid, row, pts4Col, '30');
        inspected.add(row);
      };
      const saveInspection = async () => {
        await page.getByRole('button', { name: 'Save', exact: true }).click();
      };

      // Step 1 (10%): fail the sampled roll → sample grows.
      let fresh = (await selectedRows()).filter((r) => !inspected.has(r));
      expect(fresh.length).toBeGreaterThan(0);
      for (const row of fresh) await fillRow(row, true);
      await saveInspection();
      await expect(page.getByText(/sample grown to \d+% \(\d+ rolls\)/).first()).toBeVisible({ timeout: 30_000 });

      // Next step: fail the new roll(s) → reaches 100%.
      fresh = (await selectedRows()).filter((r) => !inspected.has(r));
      expect(fresh.length).toBeGreaterThan(0);
      for (const row of fresh) await fillRow(row, true);
      await saveInspection();
      await expect(page.getByText(/sample grown to 100%/).first()).toBeVisible({ timeout: 30_000 });

      // 100%: pass the rest → every roll stands on its own result.
      fresh = (await selectedRows()).filter((r) => !inspected.has(r));
      expect(fresh.length).toBeGreaterThan(0);
      for (const row of fresh) await fillRow(row, false);
      await saveInspection();
      await expect(page.getByText(/All rolls inspected/).first()).toBeVisible({ timeout: 30_000 });
    });

    await test.step('7. Send to Dyeing (external), return as Dyed, loss vs norm 10% on challan list', async () => {
      await page.goto('/#/material/warehouse/process-send');
      await page.locator('button').filter({ hasText: 'French Terry' }).first().click();
      // Tick receipts (lots) until our rolls show up; then tick exactly our 3 rolls.
      const lotButtons = page.getByRole('button').filter({ hasText: /· \d+ rolls?/ });
      const lotCount = await lotButtons.count();
      let found = false;
      for (let i = 0; i < lotCount && !found; i += 1) {
        await lotButtons.nth(i).click();
        found = await page.getByText(rollCodes[0], { exact: true }).first()
          .isVisible({ timeout: 2_000 }).catch(() => false);
      }
      expect(found).toBe(true);
      for (const code of rollCodes) {
        const row = page.locator('tr').filter({ hasText: code }).first();
        await row.locator('input[type="checkbox"]').first().check();
      }

      await pickSelect(page, 'Process', 'Dyeing');
      // External vendor: RK Mills when offered, otherwise the first non in-house choice.
      await page.getByLabel('Where').click();
      const whereOptions = page.getByRole('option');
      const optionNames = (await whereOptions.allInnerTexts()).map((t) => t.trim());
      const external = optionNames.includes('RK Mills')
        ? 'RK Mills'
        : optionNames.find((n) => n && n !== 'In-house' && !/select|pick/i.test(n));
      expect(external).toBeTruthy();
      await page.getByRole('option', { name: external!, exact: true }).first().click();
      await fillRequiredChallanFields(page);

      await page.getByRole('button', { name: 'Create challan' }).click();
      const sentToast = page.getByText(/Challan\s+\S+\s+sent/).first();
      await expect(sentToast).toBeVisible({ timeout: 30_000 });
      challanNo = (await sentToast.innerText()).match(/Challan\s+(\S+)\s+sent/)?.[1] ?? '';
      expect(challanNo).not.toBe('');
      await expect(page.getByText('Process challan').first()).toBeVisible({ timeout: 30_000 });

      // Return all rolls as Dyed.
      await page.getByRole('button', { name: 'Quick receive' }).click();
      await page.getByLabel('Comes back as').selectOption({ label: 'Dyed' });
      const colourLabel = page.locator('label').filter({ hasText: 'Colour for all' });
      await colourLabel.locator('input').fill(dyeColour);
      await page.getByRole('button', { name: 'Same for all' }).first().click();
      await page.getByRole('button', { name: 'Receive', exact: true }).last().click();
      await expect(page.getByText(/rolls back/).first()).toBeVisible({ timeout: 30_000 });

      // Rolls now read Dyed, with Dyeing done, on the original receipt.
      await page.goto(receiptUrl);
      await expect(page.getByText('Dyeing done').first()).toBeVisible({ timeout: 30_000 });
      const rollRow = page.locator('tr').filter({ hasText: rollCodes[0] }).first();
      await expect(rollRow.getByText('Dyed', { exact: true }).first()).toBeVisible({ timeout: 20_000 });

      // Challan list: loss is shown against the 10% norm.
      await page.goto('/#/material/warehouse/process');
      await pickSelectByTriggerText(page, 'Still out', 'All');
      const challanRow = page.locator('tr').filter({ hasText: challanNo }).first();
      await expect(challanRow).toBeVisible({ timeout: 30_000 });
      await expect(challanRow.getByText(/\/ norm 10%/)).toBeVisible({ timeout: 20_000 });
    });

    await test.step('8. Allocate 2 Dyed rolls to the first style line, then cancel the note', async () => {
      await page.goto('/#/material/warehouse/expected');
      await page.locator('tbody tr').first().click();
      await page.getByRole('button', { name: 'Allocate rolls' }).click();
      await expect(page.getByText('Pick by receipt')).toBeVisible({ timeout: 30_000 });

      // Tick receipt groups until our rolls appear in the rolls table.
      const groups = page.locator('label').filter({ hasText: /rolls?/ });
      const groupCount = await groups.count();
      let found = false;
      for (let i = 0; i < groupCount && !found; i += 1) {
        await groups.nth(i).locator('input[type="checkbox"]').check();
        found = await page.getByText(rollCodes[0], { exact: true }).first()
          .isVisible({ timeout: 2_000 }).catch(() => false);
      }
      expect(found).toBe(true);
      // Group tick selects every tickable roll in it — keep only rolls 1 and 2.
      const thirdRow = page.locator('tr').filter({ hasText: rollCodes[2] }).first();
      const thirdBox = thirdRow.locator('input[type="checkbox"]').first();
      if (await thirdBox.isChecked().catch(() => false)) await thirdBox.uncheck();
      for (const code of [rollCodes[0], rollCodes[1]]) {
        const box = page.locator('tr').filter({ hasText: code }).first()
          .locator('input[type="checkbox"]').first();
        if (!(await box.isChecked().catch(() => false))) await box.check();
      }

      await page.getByRole('button', { name: /Assign 2 rolls/ }).click();
      // Colour/spec differences can ask for a confirm, then a reason.
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const toast = page.getByText(/AL-[\w-]+/).first();
        if (await toast.isVisible({ timeout: 3_000 }).catch(() => false)) break;
        const reason = page.getByLabel(/Reason for the colour difference/);
        if (await reason.isVisible().catch(() => false)) await reason.fill('E2E allocation');
        const anyway = page.getByRole('button', { name: 'Allocate anyway' });
        if (await anyway.isVisible().catch(() => false)) { await anyway.click(); continue; }
        const assign = page.getByRole('button', { name: /Assign|Book/ }).first();
        if (await assign.isVisible().catch(() => false)) await assign.click();
      }
      const toast = page.getByText(/AL-[\w-]+/).first();
      await expect(toast).toBeVisible({ timeout: 30_000 });
      noteNo = (await toast.innerText()).match(/AL-[\w-]+/)?.[0] ?? '';
      expect(noteNo).toContain('AL-');

      await page.goto('/#/material/warehouse/allocations');
      await page.getByPlaceholder('Search note, style, fabric').fill(noteNo);
      const noteRow = page.locator('tr').filter({ hasText: noteNo }).first();
      await expect(noteRow).toBeVisible({ timeout: 30_000 });
      await noteRow.click();
      await page.getByRole('button', { name: 'Cancel note' }).click();
      await page.getByLabel('Reason').fill('E2E cancel');
      await page.getByRole('button', { name: 'Cancel note' }).last().click();
      await expect(page.getByText('Closed', { exact: true }).first()).toBeVisible({ timeout: 30_000 });
    });

    await test.step('9. Reports: ITC-04 current quarter has the challan with RK Mills GSTIN', async () => {
      await page.goto('/#/material/warehouse/process');
      await page.getByRole('button', { name: 'Reports', exact: true }).click();
      await page.getByRole('button', { name: 'ITC-04 (job work)' }).click();
      const row = page.locator('tr').filter({ hasText: challanNo }).first();
      await expect(row).toBeVisible({ timeout: 30_000 });
      await expect(row.getByText(GSTIN)).toBeVisible({ timeout: 20_000 });
    });

    await test.step('10. Roll passport: History shows the received event', async () => {
      await page.goto('/#/material/fabrics');
      await page.getByText('French Terry', { exact: true }).first().click();
      const rollRow = page.locator('tr').filter({ hasText: rollCodes[0] }).first();
      await expect(rollRow).toBeVisible({ timeout: 30_000 });
      await rollRow.click();
      await expect(page.getByText('Roll passport').or(page.getByText(rollCodes[0])).first()).toBeVisible({ timeout: 30_000 });
      await expect(page.getByText('History', { exact: true }).first()).toBeVisible({ timeout: 30_000 });
      await expect(page.getByText('Received', { exact: true }).first()).toBeVisible({ timeout: 20_000 });
    });
  });
});
