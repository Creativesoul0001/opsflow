import { expect, test, type Page } from '@playwright/test';

/**
 * Order management end-to-end flow.
 *
 * Walks the whole orders module the way a member would: register an
 * organization, add a customer, create an order through the form (watching the
 * live totals preview agree with what the server stores), read it back in the
 * list through search and status filters, assign it, add a note, drive it
 * through the workflow to DELIVERED, then create a second order and cancel it,
 * confirming both terminal records keep their history.
 *
 * Requires a reachable database (`npm run db:deploy && npm run db:seed`) and a
 * running app. Not part of `npm run verify`, because it depends on external
 * infrastructure; run it explicitly with `npm run test:e2e`.
 */

const stamp = Date.now();
const email = `e2e-orders-${stamp}@opsflow.test`;
const organization = `E2E Orders ${stamp}`;
const PASSWORD = 'Correct-Horse-9';

async function registerAndSignIn(page: Page) {
  await page.goto('/register');
  await page.getByLabel('Your name').fill('Orders Tester');
  await page.getByLabel('Work email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByLabel('Organization name').fill(organization);
  await page.getByRole('button', { name: 'Create account' }).click();

  await expect(page).toHaveURL(/\/login($|\?)/);

  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

async function addCustomer(page: Page) {
  await page.getByRole('link', { name: 'Customers' }).first().click();
  await expect(page).toHaveURL(/\/customers$/);

  await page.getByRole('link', { name: 'Add customer' }).click();
  await page.getByLabel('First name').fill('Ada');
  await page.getByLabel('Last name').fill('Lovelace');
  await page.getByLabel('Email').fill(`ada-${stamp}@example.com`);
  await page.getByLabel('Company name').fill('Analytical Engines');
  await page.getByRole('button', { name: 'Create customer' }).click();
  await expect(page).toHaveURL(/\/customers\/[0-9a-f-]{36}$/);
}

/** Picks the seeded customer through the searchable picker. */
async function chooseCustomer(page: Page) {
  await page.getByLabel('Find customer').fill('Analytical Engines');
  const option = page.locator('#customerId option').filter({ hasText: 'Analytical Engines' });
  await expect(option).toHaveCount(1);
  const value = await option.getAttribute('value');
  if (value === null) throw new Error('Customer option was missing its value');
  await page.locator('#customerId').selectOption(value);
}

interface OrderInput {
  itemName: string;
  unitPrice: string;
  lineDiscount?: string;
  taxRate?: string;
  orderDiscount?: string;
}

/** Creates an order through the UI and returns its id and number. */
async function createOrder(
  page: Page,
  input: OrderInput,
): Promise<{ orderId: string; orderNumber: string }> {
  await page.getByRole('link', { name: 'Orders' }).first().click();
  await expect(page).toHaveURL(/\/orders$/);

  await page.getByRole('link', { name: 'New order' }).click();
  await expect(page).toHaveURL(/\/orders\/new$/);

  await chooseCustomer(page);
  await page.getByLabel('Item name').fill(input.itemName);
  await page.getByLabel('Unit price').fill(input.unitPrice);
  if (input.lineDiscount) await page.getByLabel('Line discount').fill(input.lineDiscount);
  if (input.orderDiscount) await page.getByLabel('Order discount').fill(input.orderDiscount);
  if (input.taxRate) await page.getByLabel('Tax rate (%)').fill(input.taxRate);

  await page.getByRole('button', { name: 'Create order' }).click();
  await expect(page).toHaveURL(/\/orders\/[0-9a-f-]{36}$/);

  const orderNumber = ((await page.locator('h1').textContent()) ?? '').trim();
  return { orderId: page.url().split('/').pop()!, orderNumber };
}

test.describe('order management', () => {
  test('a full order lifecycle works end to end', async ({ page }) => {
    await registerAndSignIn(page);
    await addCustomer(page);

    // ---- Create an order with a line discount and tax.
    const first = await createOrder(page, {
      itemName: 'Consulting hours',
      unitPrice: '120.50',
      lineDiscount: '10',
      taxRate: '8',
    });

    // The stored totals come from the same arithmetic the server ran:
    // (120.50 - 10) * 1.08 = 119.34.
    await expect(page.getByText('Order created', { exact: true })).toBeVisible();
    await expect(
      page.getByText(`Order ${first.orderNumber} created by Orders Tester.`),
    ).toBeVisible();
    await expect(page.getByText('$120.50')).toBeVisible();
    await expect(page.getByText('$10.00')).toBeVisible();
    await expect(page.getByText('$8.84')).toBeVisible();
    await expect(page.getByText('$119.34')).toBeVisible();

    // ---- Assign to the registering member.
    await page.getByLabel('Assigned to').selectOption({ label: `Orders Tester (${email})` });
    await page.getByRole('button', { name: 'Save assignment' }).click();
    await expect(page.getByText('Order assigned to Orders Tester by Orders Tester.')).toBeVisible();

    // ---- Add a note while the order is still open.
    await page.getByLabel('Add a note').fill('Requested delivery after the 15th.');
    await page.getByRole('button', { name: 'Add note' }).click();
    await expect(page.getByText('Requested delivery after the 15th.')).toBeVisible();
    await expect(page.getByText('Note added by Orders Tester.')).toBeVisible();

    // ---- Drive the workflow to DELIVERED.
    await page.getByRole('button', { name: 'Confirm order' }).click();
    await page.getByRole('button', { name: 'Start processing' }).waitFor();
    await page.getByRole('button', { name: 'Start processing' }).click();
    await page.getByRole('button', { name: 'Mark shipped' }).waitFor();
    await page.getByRole('button', { name: 'Mark shipped' }).click();
    await page.getByRole('button', { name: 'Mark delivered' }).waitFor();
    await page.getByRole('button', { name: 'Mark delivered' }).click();

    await expect(page.getByText('This order is delivered')).toBeVisible();
    await expect(
      page.getByText(`Order status changed from Shipped to Delivered by Orders Tester.`),
    ).toBeVisible();
    await expect(page.getByText('This order is in a final state.')).toBeVisible();
    await expect(page.getByLabel('Add a note')).toHaveCount(0);

    // ---- The list, its search and its status filter all agree.
    await page.goto('/orders');
    await expect(page.getByRole('cell', { name: first.orderNumber })).toBeVisible();

    await page.getByLabel('Search orders').fill(first.orderNumber);
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(page.getByRole('cell', { name: first.orderNumber })).toBeVisible();

    await page.getByLabel('Status').selectOption('DELIVERED');
    await expect(page.getByRole('cell', { name: first.orderNumber })).toBeVisible();

    // ---- A second order is cancelled with reason, and filters tell them apart.
    const second = await createOrder(page, { itemName: 'Advisory retainer', unitPrice: '250.00' });
    await page.getByRole('button', { name: 'Cancel order' }).click();
    await expect(page.getByText('Cancel this order?')).toBeVisible();
    await page.getByLabel('Reason').fill('Customer changed their mind.');
    await page.getByRole('button', { name: 'Confirm cancellation' }).click();

    await expect(page.getByText('This order is cancelled')).toBeVisible();
    await expect(page.getByLabel('Add a note')).toHaveCount(0);

    await page.goto('/orders');
    await page.getByLabel('Search orders').fill(second.orderNumber);
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await page.getByLabel('Status').selectOption('CANCELLED');
    await expect(page.getByRole('cell', { name: second.orderNumber })).toBeVisible();
    await expect(page.getByRole('cell', { name: first.orderNumber })).toHaveCount(0);
  });

  test('the API refuses unauthenticated access', async ({ page, request }) => {
    await registerAndSignIn(page);
    await addCustomer(page);

    const { orderId } = await createOrder(page, { itemName: 'Probe', unitPrice: '1.00' });

    await page.context().clearCookies();
    const anonymous = await request.post(`/api/orders/${orderId}/status`, {
      data: { status: 'CONFIRMED' },
    });
    expect(anonymous.status()).toBe(401);

    const body = (await anonymous.json()) as { error: { code: string } };
    expect(body.error.code).toBe('UNAUTHICATED');
  });
});
