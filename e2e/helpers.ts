import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';

/** Unique per run so tests never collide with state left in the local D1 database. */
export const run = Date.now().toString(36);

export type Person = { id: string; email: string; name: string };

export function person(name: string): Person {
  const slug = name.toLowerCase();
  return { id: `e2e-${slug}-${run}`, email: `${slug}.${run}@example.com`, name };
}

/**
 * Local development has no hosting dispatcher, so tests supply the identity headers it would add.
 * (Production must never accept these from clients; see the identity assertion notes in README.)
 */
export function identityHeaders(p: Person): Record<string, string> {
  return {
    'oai-authenticated-user-id': p.id,
    'oai-authenticated-user-email': p.email,
    'oai-authenticated-user-full-name': encodeURIComponent(p.name),
    'oai-authenticated-user-full-name-encoding': 'percent-encoded-utf-8',
  };
}

export async function signedIn(
  browser: Browser,
  p: Person,
  options: Parameters<Browser['newContext']>[0] = {},
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ ...options, extraHTTPHeaders: identityHeaders(p) });
  // External product images are irrelevant to these flows and may be unreachable in CI.
  await context.route(/openfoodfacts\.org|migros|coop\.ch/, (route) => route.abort());
  const page = await context.newPage();
  await page.goto('/');
  return { context, page };
}

export async function createHousehold(page: Page, name: string) {
  await page.getByRole('button', { name: 'Create a household' }).click();
  await page.getByPlaceholder('e.g. The Sunday household').fill(name);
  await page
    .getByRole('dialog')
    .getByRole('button', { name: /Create household/ })
    .click();
  await expect(page.getByPlaceholder('What do we need?')).toBeVisible();
}

export async function addItem(page: Page, text: string) {
  await page.getByPlaceholder('What do we need?').fill(text);
  await page.getByRole('button', { name: 'Add', exact: true }).click();
}

export function itemRow(page: Page, name: string) {
  return page.locator('article.item-row').filter({ hasText: name }).first();
}

export async function openNav(page: Page, label: string) {
  // Navigation buttons may carry a count badge ("Lists 3").
  await page
    .getByRole('button', { name: new RegExp('^' + label) })
    .first()
    .click();
}

export async function waitSynced(page: Page) {
  await expect(page.getByRole('button', { name: /Sync status: Synced/ })).toBeVisible({
    timeout: 20_000,
  });
}

/** Creates an email-bound invitation from the Household view and returns its link. */
export async function invite(page: Page, email: string): Promise<string> {
  await openNav(page, 'Household');
  await page.getByRole('button', { name: 'Invite someone' }).click();
  await page.getByRole('dialog').locator('input[type=email]').fill(email);
  await page.getByRole('button', { name: 'Create private household invitation' }).click();
  await expect(page.getByRole('dialog')).toContainText('single-use');
  const href = await page
    .getByRole('dialog')
    .locator('input, a')
    .evaluateAll((els) =>
      els
        .map((e) => (e as HTMLAnchorElement).href || (e as HTMLInputElement).value || '')
        .find((v) => v.includes('invite=')),
    );
  if (!href) throw new Error('Invitation link not shown');
  await page.keyboard.press('Escape');
  return href;
}
