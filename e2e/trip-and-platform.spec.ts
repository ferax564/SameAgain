import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import sampleProducts from '../lib/sample-products.json' with { type: 'json' };
import { createHousehold, openNav, person, signedIn, waitSynced } from './helpers';

test('finishing a trip with many product-linked items syncs', async ({ browser }) => {
  const { page } = await signedIn(browser, person('Trip'));
  await createHousehold(page, 'Big shop');
  await waitSynced(page);
  // Seed 30 checked, product-linked items through the same API the app uses.
  const seeded = await page.evaluate(
    async (products) => {
      const get = await (await fetch('/api/data')).json();
      const household = get.households[0].id as string;
      const data = await (await fetch('/api/data?household=' + household)).json();
      const list = data.records.find((r: { kind: string }) => r.kind === 'list');
      for (let i = 0; i < 30; i++) {
        const product = { ...products[i % products.length], id: 'e2e-' + i, barcode: undefined };
        const res = await fetch('/api/data', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            action: 'op',
            household,
            op: {
              id: crypto.randomUUID(),
              record: crypto.randomUUID(),
              kind: 'item',
              version: 0,
              data: {
                name: 'Product ' + i,
                quantity: 1,
                unit: 'pack',
                category: 'Other',
                notes: '',
                store: '',
                substitution: 'similar',
                actualPrice: null,
                done: true,
                list: list.id,
                product,
              },
            },
          }),
        });
        if (!res.ok) return 'seed failed: ' + res.status;
      }
      return 'ok';
    },
    sampleProducts as Record<string, unknown>[],
  );
  expect(seeded).toBe('ok');
  await page.reload();
  await expect(page.getByText('30 of 30 in basket')).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Finish trip', exact: true }).click();
  await waitSynced(page);
  await expect(page.getByText(/change needs attention/i)).toHaveCount(0);
  await expect(page.getByText('0 of 0 in basket')).toBeVisible({ timeout: 15_000 });
});

test('responses carry security headers', async ({ request }) => {
  const res = await request.get('/');
  const headers = res.headers();
  expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
  expect(headers['x-frame-options']).toBe('DENY');
  expect(headers['x-content-type-options']).toBe('nosniff');
  expect(headers['permissions-policy']).toContain('camera=(self)');
});

test('malformed API input is a client error, not a retryable outage', async ({ browser }) => {
  const { page } = await signedIn(browser, person('Bad'));
  const status = await page.evaluate(async () => {
    const res = await fetch('/api/data', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{bad',
    });
    return res.status;
  });
  expect(status).toBe(400);
});

async function expectAccessible(page: Page) {
  // Measure settled colours: toasts fade in over ~400ms, which axe would read as low contrast.
  await page
    .locator('[data-sonner-toast][data-mounted="false"]')
    .first()
    .waitFor({ state: 'detached', timeout: 2_000 })
    .catch(() => {});
  await page.waitForTimeout(600);
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  const serious = results.violations.filter((v) => ['serious', 'critical'].includes(v.impact!));
  expect(
    serious.flatMap((v) =>
      v.nodes.map(
        (n) => `${v.id}: ${n.target.join(' ')} — ${n.any[0]?.message ?? n.failureSummary}`,
      ),
    ),
  ).toEqual([]);
}

test('main screens have no serious accessibility violations', async ({ browser }) => {
  const { page } = await signedIn(browser, person('Axe'));
  await expectAccessible(page);
  await createHousehold(page, 'Accessible');
  await page.getByPlaceholder('What do we need?').fill('bread');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.locator('article.item-row').first().getByRole('checkbox').click();
  await expectAccessible(page);
  await openNav(page, 'Household');
  await expectAccessible(page);
});

test('the demo works without an account', async ({ page }) => {
  await page.route(/openfoodfacts\.org/, (route) => route.abort());
  await page.goto('/');
  await page.getByRole('button', { name: 'Explore the demo' }).first().click();
  await expect(page.getByText('Demo household')).toBeVisible();
  await expect(page.locator('article.item-row').first()).toBeVisible();
  await expectAccessible(page);
});

test('a product shows its health score, breakdown and better alternatives', async ({ page }) => {
  await page.route(/openfoodfacts\.org/, (route) => route.abort());
  await page.goto('/');
  await page.getByRole('button', { name: 'Explore the demo' }).first().click();
  await expect(page.getByText('Demo household')).toBeVisible();
  await openNav(page, 'Discover');
  await page
    .locator('.product-card', { hasText: 'Nutella' })
    .first()
    .locator('.product-open')
    .click();
  const panel = page.locator('.health-panel');
  await expect(panel).toBeVisible();
  await expect(panel.getByText(/Nutri-Score E/)).toBeVisible();
  await expect(panel.locator('.score-verdict')).toContainText('/100');
  await expect(panel.locator('.alternative').first()).toBeVisible({ timeout: 20_000 });
  await panel.getByRole('button', { name: 'Migros' }).click();
  await expect(panel.getByRole('button', { name: 'Migros' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(panel.locator('.alternative, p.fine').first()).toBeVisible();
  await panel.screenshot({ path: test.info().outputPath('health-panel.png') });
  await expectAccessible(page);
});

const shot = (page: Page, name: string) =>
  page.screenshot({ path: test.info().outputPath(name + '.png') });

test('a receipt line can be linked to a catalogue product before adding it', async ({ page }) => {
  await page.route(/openfoodfacts\.org/, (route) => route.abort());
  await page.goto('/');
  await page.getByRole('button', { name: 'Explore the demo' }).first().click();
  await expect(page.getByText('Demo household')).toBeVisible();
  await page.getByRole('button', { name: 'Scan receipt' }).click();
  await page.getByText('Paste or type receipt text').click();
  await page
    .getByLabel('Item rows')
    .fill(
      'MIGROS\nChili-Chips M-Budget          1.95 1\nMCL VLM 1L                    1.60 1\nTotal CHF 3.55',
    );
  await page.getByRole('button', { name: 'Review text' }).click();
  await expect(page.getByText('2 rows to review')).toBeVisible();
  const chips = page.locator('.receipt-row').first();
  await expect(chips.getByText(/Possible match: .*Chili/i)).toBeVisible({ timeout: 20_000 });
  // An abbreviation matches nothing and stays a generic grocery.
  await expect(page.locator('.receipt-row').nth(1).getByText('Possible match')).toHaveCount(0);
  // Frame the suggestion above the dialog's sticky footer.
  await chips.getByText(/Possible match/).evaluate((e) => e.scrollIntoView({ block: 'center' }));
  await shot(page, 'receipt-suggestion');
  await chips.getByRole('button', { name: 'Link this product' }).click();
  await expect(chips.getByText(/Linked to .*Chili/i)).toBeVisible();
  await chips.getByText(/Linked to/).evaluate((e) => e.scrollIntoView({ block: 'center' }));
  await shot(page, 'receipt-linked');
  await page.getByRole('checkbox', { name: 'I checked the selected items' }).click();
  await page.getByRole('button', { name: /Add 2 to list/ }).click();
  await expect(page.getByText('2 items added')).toBeVisible();
  await expectAccessible(page);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const row = page.locator('article.item-row', { hasText: 'Chili-Chips M-Budget' });
  await expect(row).toBeVisible();
  // The linked row carries the product's brand and pack; the abbreviation stays generic.
  await expect(row.getByText(/^M-Budget · /)).toBeVisible();
  await expect(
    page.locator('article.item-row', { hasText: 'MCL VLM 1L' }).getByText(/^Other · /),
  ).toBeVisible();
  await row.scrollIntoViewIfNeeded();
  await page
    .locator('article.item-row', { hasText: /Chili-Chips M-Budget|MCL VLM 1L/ })
    .last()
    .scrollIntoViewIfNeeded();
  await shot(page, 'receipt-list');
});

test('Denner, Lidl and Aldi can be chosen as shops and searched', async ({ page }) => {
  await page.route(/openfoodfacts\.org/, (route) => route.abort());
  await page.goto('/');
  await page.getByRole('button', { name: 'Explore the demo' }).first().click();
  await expect(page.getByText('Demo household')).toBeVisible();
  await openNav(page, 'Discover');
  await page.getByRole('tab', { name: 'Stores & offers' }).click();
  for (const [option, label] of [
    ['Denner · Switzerland', 'Denner'],
    ['Lidl Switzerland · Switzerland', 'Lidl Switzerland'],
    ['Aldi Suisse · Switzerland', 'Aldi Suisse'],
  ]) {
    await page.getByRole('combobox', { name: 'Retailer and country' }).click();
    await page.getByRole('option', { name: option }).click();
    await page.getByLabel('Search selected retailer catalogue').fill('chips');
    await page.getByRole('button', { name: 'Search', exact: true }).last().click();
    await expect(page.locator('.store-hub .product-card').first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(new RegExp(`[\\d,’']+ ${label} records`))).toBeVisible();
    await page.locator('.store-hub .product-card').first().scrollIntoViewIfNeeded();
    await shot(page, 'shop-' + label.split(' ')[0].toLowerCase());
  }
  await expectAccessible(page);
});

test('the guide explains the health score and catalogue', async ({ page }) => {
  await page.goto('/guide');
  await expect(page.getByRole('heading', { name: 'How Same Again works' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Health score' })).toBeVisible();
  await expect(page.getByText(/98,179 products/)).toBeVisible();
  await expect(page.getByText(/Denner 1,672/)).toBeVisible();
  await page.getByRole('link', { name: 'Health score' }).click();
  await shot(page, 'guide');
  await expectAccessible(page);
});
