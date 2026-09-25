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
