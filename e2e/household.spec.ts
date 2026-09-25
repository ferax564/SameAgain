import { expect, test } from '@playwright/test';
import { addItem, createHousehold, invite, itemRow, person, signedIn, waitSynced } from './helpers';

test('create a household, add and check an item, and keep it after reload', async ({ browser }) => {
  const alice = person('Alice');
  const { page } = await signedIn(browser, alice);
  await createHousehold(page, 'The E2E household');
  await addItem(page, '2 kg apples');
  const row = itemRow(page, 'apples');
  await expect(row).toBeVisible();
  // Quick-add understands quantity and unit.
  await expect(row).toContainText('2');
  await expect(row).toContainText('kg');
  await row.getByRole('checkbox').click();
  await expect(row.getByRole('checkbox')).toHaveAttribute('aria-checked', 'true');
  await waitSynced(page);
  await page.reload();
  await expect(itemRow(page, 'apples').getByRole('checkbox')).toHaveAttribute(
    'aria-checked',
    'true',
  );
});

test('quick-add warns about a duplicate instead of adding it twice', async ({ browser }) => {
  const { page } = await signedIn(browser, person('Dupe'));
  await createHousehold(page, 'Duplicates');
  await addItem(page, 'milk');
  await expect(itemRow(page, 'milk')).toBeVisible();
  await addItem(page, 'Milk');
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.locator('article.item-row').filter({ hasText: /^milk|Milk/i })).toHaveCount(1);
});

test('overlong names are limited in the input', async ({ browser }) => {
  const { page } = await signedIn(browser, person('Long'));
  await createHousehold(page, 'Long names');
  await page.getByPlaceholder('What do we need?').fill('a'.repeat(300));
  await expect(page.getByPlaceholder('What do we need?')).toHaveValue('a'.repeat(160));
});

test('email-bound invitations admit only the invited person, once', async ({ browser }) => {
  const owner = person('Owner');
  const bob = person('Bob');
  const carol = person('Carol');
  const { page } = await signedIn(browser, owner);
  await createHousehold(page, 'Invitations');
  await addItem(page, 'coffee');
  await waitSynced(page);
  const link = await invite(page, bob.email.toUpperCase());

  const c = await signedIn(browser, carol);
  await c.page.goto(link);
  await c.page.getByRole('button', { name: 'Join household' }).click();
  await expect(c.page.getByText(/email address this invitation was created for/)).toBeVisible();
  // The token is removed from the address bar once read.
  expect(new URL(c.page.url()).searchParams.get('invite')).toBeNull();

  const b = await signedIn(browser, bob);
  await b.page.goto(link);
  await b.page.getByRole('button', { name: 'Join household' }).click();
  await expect(itemRow(b.page, 'coffee')).toBeVisible();

  const again = await signedIn(browser, bob);
  await again.page.goto(link);
  await again.page.getByRole('button', { name: 'Join household' }).click();
  await expect(again.page.getByText(/already|expired|revoked|used/i).first()).toBeVisible();
});

test('changes reach another member and offline edits replay; conflicts need a decision', async ({
  browser,
}) => {
  const owner = person('Ann');
  const member = person('Ben');
  const a = await signedIn(browser, owner);
  await createHousehold(a.page, 'Sync');
  await addItem(a.page, 'tea');
  await waitSynced(a.page);
  const link = await invite(a.page, member.email);
  const b = await signedIn(browser, member);
  await b.page.goto(link);
  await b.page.getByRole('button', { name: 'Join household' }).click();
  await expect(itemRow(b.page, 'tea')).toBeVisible();

  // Propagation.
  await a.page
    .getByRole('button', { name: /^Lists/ })
    .first()
    .click();
  await addItem(a.page, 'honey');
  await expect(itemRow(b.page, 'honey')).toBeVisible({ timeout: 15_000 });

  // Offline replay.
  await b.context.setOffline(true);
  await itemRow(b.page, 'honey').getByRole('checkbox').click();
  await b.context.setOffline(false);
  await expect(itemRow(a.page, 'honey').getByRole('checkbox')).toHaveAttribute(
    'aria-checked',
    'true',
    { timeout: 20_000 },
  );

  // A net no-op offline (check then uncheck) must not raise a conflict.
  await b.context.setOffline(true);
  await itemRow(b.page, 'tea').getByRole('checkbox').click();
  await itemRow(b.page, 'tea').getByRole('checkbox').click();
  await itemRow(a.page, 'tea').getByRole('checkbox').click();
  await waitSynced(a.page);
  await b.context.setOffline(false);
  await expect(itemRow(b.page, 'tea').getByRole('checkbox')).toHaveAttribute(
    'aria-checked',
    'true',
    { timeout: 20_000 },
  );
  await expect(b.page.getByText('Two shoppers, one change.')).toHaveCount(0);

  // A real conflict needs an explicit choice.
  await b.context.setOffline(true);
  await itemRow(b.page, 'tea').getByRole('checkbox').click();
  await itemRow(a.page, 'tea').getByRole('checkbox').click();
  await a.page.waitForTimeout(300);
  await itemRow(a.page, 'tea').getByRole('checkbox').click();
  await waitSynced(a.page);
  await b.context.setOffline(false);
  const dialog = b.page.getByRole('dialog', { name: 'Two shoppers, one change.' });
  await expect(dialog).toBeVisible({ timeout: 20_000 });
  await b.page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Use shared version' }).click();
  await expect(dialog).toBeHidden();
});
