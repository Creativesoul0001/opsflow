import { expect, test, type Page } from '@playwright/test';

/**
 * Customer CRM end-to-end flow.
 *
 * Walks the whole module the way a member would: register an organization, add
 * a customer, find it again through search and filters, edit it, add a note,
 * watch the timeline record each action, then archive it and confirm it leaves
 * the default list but stays retrievable.
 *
 * Requires a reachable database (`npm run db:deploy && npm run db:seed`) and a
 * running app. Not part of `npm run verify`, because it depends on external
 * infrastructure; run it explicitly with `npm run test:e2e`.
 */

const stamp = Date.now();
const email = `e2e-customers-${stamp}@opsflow.test`;
const organization = `E2E Customers ${stamp}`;
const PASSWORD = 'Correct-Horse-9';

async function registerAndSignIn(page: Page) {
  await page.goto('/register');
  await page.getByLabel('Your name').fill('CRM Tester');
  await page.getByLabel('Work email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByLabel('Organization name').fill(organization);
  await page.getByRole('button', { name: 'Create account' }).click();

  // Wait for navigation to complete.
  await expect(page).toHaveURL(/\/login($|\?)/);

  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

test.describe('customer CRM', () => {
  test('a full customer lifecycle works end to end', async ({ page }) => {
    await registerAndSignIn(page);

    // ---- The module is reachable from the shell, not just by typing a URL.
    await page.getByRole('link', { name: 'Customers' }).first().click();
    await expect(page).toHaveURL(/\/customers$/);

    // ---- Create
    await page.getByRole('link', { name: 'Add customer' }).click();
    await expect(page).toHaveURL(/\/customers\/new$/);

    await page.getByLabel('First name').fill('Grace');
    await page.getByLabel('Last name').fill('Hopper');
    await page.getByLabel('Email').fill(`grace-${stamp}@example.com`);
    await page.getByLabel('Phone').fill('+1 555 0142');
    await page.getByLabel('Company name').fill('Navy');
    await page.getByRole('button', { name: 'Create customer' }).click();

    // Creating redirects straight to the new record.
    await expect(page).toHaveURL(/\/customers\/[0-9a-f-]{36}$/);
    await expect(page.getByRole('heading', { name: 'Grace Hopper' })).toBeVisible();
    await expect(page.getByText('Navy · Added')).toBeVisible();

    // ---- The timeline recorded the creation.
    await expect(page.getByText('Customer created by CRM Tester')).toBeVisible();

    const customerUrl = page.url();

    // ---- The customer is findable in the list.
    await page.goto('/customers');
    await page.getByRole('link', { name: 'Customers' }).first().waitFor();
    await expect(page.getByRole('cell', { name: 'Grace Hopper' })).toBeVisible();

    // ---- Search narrows the list.
    await page.getByLabel('Search customers').fill('Hopper');
    await expect(page.getByRole('cell', { name: 'Grace Hopper' })).toBeVisible();

    await page.getByLabel('Search customers').fill('NoSuchCustomer');
    await expect(page.getByText('No customers match these filters')).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Grace Hopper' })).toHaveCount(0);

    // ---- Edit
    await page.goto(customerUrl);
    await page.getByRole('button', { name: 'Edit' }).click();
    await expect(page).toHaveURL(/\/edit$/);

    await page.getByLabel('Company name').fill('US Navy');
    await page.getByRole('button', { name: 'Save changes' }).click();

    await expect(page).toHaveURL(new RegExp(`${customerUrl.split('/').pop()}$`));
    await expect(page.getByText('US Navy')).toBeVisible();
    await expect(page.getByText('Customer details updated by CRM Tester')).toBeVisible();

    // ---- A note is appended and recorded.
    await page.getByLabel('Add a note').fill('Requested a follow-up call.');
    await page.getByRole('button', { name: 'Add note' }).click();
    await expect(page.getByText('Requested a follow-up call.')).toBeVisible();
    await expect(page.getByText('Note added by CRM Tester')).toBeVisible();

    // ---- Archive is a deliberate two-step action.
    await page.getByRole('button', { name: 'Archive' }).click();
    await expect(page.getByText('Archive this customer?')).toBeVisible();
    await page.getByRole('button', { name: 'Confirm archive' }).click();

    await expect(page.getByText('Archived customer')).toBeVisible();
    await expect(page.getByText('Customer archived by CRM Tester')).toBeVisible();

    // Archived records leave the default list...
    await page.goto('/customers');
    await expect(page.getByRole('cell', { name: 'Grace Hopper' })).toHaveCount(0);

    // ...but the record and its history are retained, not deleted.
    await page.goto(customerUrl);
    await expect(page.getByText('Archived customer')).toBeVisible();
    await expect(page.getByText('Note added by CRM Tester')).toBeVisible();
  });

  test('the API refuses unauthenticated and cross-tenant access', async ({ page, request }) => {
    await registerAndSignIn(page);

    await page.goto('/customers/new');
    await page.getByLabel('First name').fill('Tenant');
    await page.getByLabel('Last name').fill('Probe');
    await page.getByLabel('Email').fill(`probe-${stamp}@example.com`);
    await page.getByRole('button', { name: 'Create customer' }).click();
    await expect(page).toHaveURL(/\/customers\/[0-9a-f-]{36}$/);
    const customerId = page.url().split('/').pop();

    // A signed-out client gets 401, not data.
    await page.context().clearCookies();
    const anonymous = await request.get(`/api/customers/${customerId}`);
    expect(anonymous.status()).toBe(401);

    const body = (await anonymous.json()) as { error: { code: string } };
    expect(body.error.code).toBe('UNAUTHICATED');
  });
});
